// Grow spawn groups: permanent vs temp spawns, and group live counts

const GROWTH_INSTANT_WINDOW_MS = 1500;
const GROWTH_TIMER_JITTER_MS = 900;
const GROWTH_TIMER_SLACK_MS = 1500;
const GROWTH_SCAN_MS = 100;
const GROWTH_LETHAL_MARGIN = 1.35;
const GROWTH_SURE_MARGIN = 0.9;
const GROWTH_SPAWN_TOLERANCE = 10;
const GROWTH_SPLASH_SLACK = 10;

var growthDebug = true;

/**
 * @typedef {Object} GrowthGroup
 * @property {number} index
 * @property {Object} def - G.maps spawn definition
 * @property {{windows: {from: number, to: number}[]}[]} expected - one per respawn due
 */

/**
 * @param {{windows: {from: number, to: number}[]}} expectation
 * @param {number} now
 * @returns {boolean}
 */
const isDue = ({ windows }, now) =>
  windows.some(({ from, to }) => from <= now && now <= to);

/** @type {{map?: string, groups: GrowthGroup[], members: Object<string, {group?: number, kind?: string}>, noCleanSwingAt: number}} */
const growthTracker = {
  map: undefined,
  groups: [],
  members: {},
  noCleanSwingAt: 0,
};

/** @returns {GrowthGroup[]} the current map's grow groups */
function getGrowthGroups() {
  if (growthTracker.map !== character.map) {
    growthTracker.map = character.map;
    growthTracker.members = {};
    growthTracker.groups = (G.maps[character.map]?.monsters ?? [])
      .filter((def) => def.grow && def.boundary)
      .map((def, index) => ({ index, def, expected: [] }));
  }

  return growthTracker.groups;
}

/**
 * @param {Object} entity
 * @returns {GrowthGroup|undefined}
 */
function getGrowthGroupOf(entity) {
  const member = growthTracker.members[entity?.id];
  return member?.group === undefined
    ? undefined
    : growthTracker.groups[member.group];
}

/**
 * @param {Object} def - G.maps spawn definition
 * @param {Object} entity
 * @returns {boolean}
 */
function isInSpawnBoundary(def, entity) {
  const [left, top, right, bottom] = def.boundary;
  return (
    entity.x >= left - GROWTH_SPAWN_TOLERANCE &&
    entity.x <= right + GROWTH_SPAWN_TOLERANCE &&
    entity.y >= top - GROWTH_SPAWN_TOLERANCE &&
    entity.y <= bottom + GROWTH_SPAWN_TOLERANCE
  );
}

/**
 * @param {Object} mob
 * @returns {boolean} whether hits in the air or its burn finish it
 */
function isDoomedByIncoming(mob) {
  return getHpAfterPending(mob) <= 0;
}

/**
 * @param {GrowthGroup} group
 * @param {Object[]} [subjects] - counted even if doomed
 * @returns {{min: number, max: number}} live count, doomed mobs excluded
 */
function getGroupLive(group, subjects = []) {
  let known = 0;
  let unknown = 0;

  for (const entity of Object.values(parent.entities)) {
    if (
      entity.type !== "monster" ||
      entity.mtype !== group.def.type ||
      (!subjects.includes(entity) &&
        (entity.dead || isDoomedByIncoming(entity)))
    )
      continue;

    const member = growthTracker.members[entity.id];
    if (member?.group === group.index) known++;
    else if (member?.group === undefined) unknown++;
  }

  return { min: known, max: known + unknown };
}

/** @returns {number} live count at or below which a kill respawns at once */
const instantRespawnCap = (group) => (group.def.count * 2) / 3;

/**
 * @param {Object} entity - the mob that just died
 * @param {Object} data - the killing hit
 */
function onGrowthKill(entity, data) {
  const member = growthTracker.members[entity.id];
  const group = getGrowthGroupOf(entity);
  const killer = `by ${data.hid} ${data.source}${data.splash ? " splash" : ""}`;
  const isLogged = growthDebug && mobsToFarm.includes(entity.mtype);

  if (!group || member.kind === "temp") {
    if (isLogged && member)
      console.warn(
        `[growth] ${entity.mtype} #${group?.index ?? "?"} ${member.kind ?? "?"} died ${killer}`,
      );
    return;
  }

  const live = getGroupLive(group, [entity]);
  const cap = instantRespawnCap(group);
  const now = Date.now();
  const respawnS = G.monsters[group.def.type].respawn;
  const [timerFrom, timerTo] =
    respawnS > 200
      ? [respawnS * 720, respawnS * 1200]
      : [respawnS * 1000, respawnS * 1000 + GROWTH_TIMER_JITTER_MS];

  const windows = [];
  if (live.min <= cap)
    windows.push({ from: now, to: now + GROWTH_INSTANT_WINDOW_MS });
  if (live.max > cap)
    windows.push({
      from: now + timerFrom,
      to: now + timerTo + GROWTH_TIMER_SLACK_MS,
    });
  group.expected.push({ windows });

  if (isLogged)
    console.warn(
      `[growth] ${entity.mtype} #${group.index} ${member.kind ?? "?"} died at ` +
        `${live.min}-${live.max}/${group.def.count} ${killer}` +
        (live.min > cap ? ` (${getWasteCause(data)})` : ""),
    );
}

/**
 * @param {Object} data - the killing hit
 * @returns {string} why a wasted kill went through
 */
function getWasteCause(data) {
  if (data.hid !== character.name) return "other bot";
  if (!USE_GROWTH_TARGETING) return "growth off";
  if (data.source === "cleave") return "cleave";
  if (currentStrategy !== usePullStrategies) return "normal strategy";

  return Date.now() - growthTracker.noCleanSwingAt < GROWTH_INSTANT_WINDOW_MS
    ? "no clean swing"
    : "mispredicted";
}

/** @param {number} bestRank - growth rank of the best target in reach */
function noteGrowthOptions(bestRank) {
  if (bestRank > 0) growthTracker.noCleanSwingAt = Date.now();
}

/**
 * @param {GrowthGroup} group
 * @returns {number} its permanents alive in view or due to respawn
 */
function getAccountedPermanents(group) {
  let alive = 0;
  for (const [id, member] of Object.entries(growthTracker.members)) {
    const entity = parent.entities[id];
    if (
      entity &&
      !entity.dead &&
      member.group === group.index &&
      member.kind === "permanent"
    )
      alive++;
  }

  return alive + group.expected.length;
}

/**
 * @param {Object[]} burst
 * @returns {GrowthGroup|undefined} the group the burst spawned into
 */
function placeBurst(burst) {
  const now = Date.now();
  const candidates = growthTracker.groups.filter(
    (group) =>
      group.def.type === burst[0].mtype &&
      burst.every((mob) => isInSpawnBoundary(group.def, mob)),
  );
  if (candidates.length <= 1) return candidates[0];

  const open = candidates.filter(
    (group) => getAccountedPermanents(group) < group.def.count,
  );
  if (open.length === 1) return open[0];

  const due = (open.length ? open : candidates).filter((group) =>
    group.expected.some((expectation) => isDue(expectation, now)),
  );
  return due.length === 1 ? due[0] : undefined;
}

/** @param {Object[]} burst - consecutive ids, ascending */
function classifyBurst(burst) {
  const group = placeBurst(burst);
  const permanentIds = new Set([burst[0].id]);
  if (burst.length % 2 === 0) permanentIds.add(burst[burst.length - 1].id);

  for (const mob of burst)
    growthTracker.members[mob.id] = {
      group: group?.index,
      kind: permanentIds.has(mob.id) ? "permanent" : "temp",
    };

  if (group) {
    const now = Date.now();
    for (let i = 0; i < permanentIds.size; i++) {
      const dueIndex = group.expected.findIndex((expectation) =>
        isDue(expectation, now),
      );
      if (dueIndex !== -1) group.expected.splice(dueIndex, 1);
    }
  }

  if (growthDebug && mobsToFarm.includes(burst[0].mtype))
    console.warn(
      `[growth] ${burst[0].mtype} #${group?.index ?? "?"} spawned ` +
        `${permanentIds.size}P+${burst.length - permanentIds.size}T`,
    );
}

function scanGrowthSpawns() {
  const groups = getGrowthGroups();
  if (!groups.length) return;

  const types = new Set(groups.map((group) => group.def.type));
  const visible = new Set();
  const fresh = [];

  for (const entity of Object.values(parent.entities)) {
    if (entity.type !== "monster" || !types.has(entity.mtype)) continue;

    visible.add(entity.id);
    if (growthTracker.members[entity.id]) continue;

    if (entity.s?.young) fresh.push(entity);
    else growthTracker.members[entity.id] = {};
  }

  for (const id of Object.keys(growthTracker.members))
    if (!visible.has(id)) delete growthTracker.members[id];

  const now = Date.now();
  for (const group of groups)
    group.expected = group.expected.filter(({ windows }) =>
      windows.some(({ to }) => to >= now),
    );

  fresh.sort((lhs, rhs) => Number(lhs.id) - Number(rhs.id));
  let burst = [];
  for (const mob of fresh) {
    const last = burst[burst.length - 1];
    if (
      last &&
      (last.mtype !== mob.mtype || Number(mob.id) !== Number(last.id) + 1)
    ) {
      classifyBurst(burst);
      burst = [];
    }
    burst.push(mob);
  }
  if (burst.length) classifyBurst(burst);
}

/**
 * @param {Object} target
 * @param {number} margin - on our hit
 * @param {number} radiusSlack - on our splash radius
 * @returns {Object[]} mobs our next swing at the target kills, in server order
 */
function getSwingKills(target, margin, radiusSlack) {
  const hit = character.attack * mitigation(character, target);
  const kills = getHpAfterPending(target) <= hit * margin ? [target] : [];

  const splash =
    typeof projectileManager !== "undefined" &&
    projectileManager.getSplash("attack", character);
  if (!splash) return kills;

  const splashKills = Object.values(parent.entities)
    .filter(
      (mob) =>
        mob !== target &&
        mob.type === "monster" &&
        !mob.dead &&
        distance(target, mob) <
          splash.intensity / BLAST_DIVISOR + radiusSlack &&
        getHpAfterPending(mob) <=
          ((hit * damage_multiplier(mob[splash.defense] ?? 0) *
            splash.intensity) /
            100) *
            margin,
    )
    .sort((lhs, rhs) => Number(lhs.id) - Number(rhs.id));

  return [...kills, ...splashKills];
}

/**
 * @param {number} live
 * @param {number} count - the group's count
 * @param {{temps: number}} tally
 * @returns {number} live count after one spawn and its temps
 */
function spawnInto(live, count, tally) {
  live++;
  if (live <= count / 2)
    for (let i = 0; i < 2; i++) {
      tally.temps++;
      live = spawnInto(live, count, tally);
    }

  return live;
}

/**
 * @param {Object[]} kills - in server order
 * @param {"min"|"max"} bound - end of each group's live range to start from
 * @returns {{wasted: number, temps: number}} permanents sent to timers, temps spawned
 */
function playOutKills(kills, bound) {
  let wasted = 0;
  const tally = { temps: 0 };

  for (const group of growthTracker.groups) {
    const dying = kills.filter(
      (mob) => growthTracker.members[mob.id]?.group === group.index,
    );
    if (!dying.length) continue;

    let live = getGroupLive(group, dying)[bound];
    let instants = 0;
    for (const mob of dying) {
      if (growthTracker.members[mob.id].kind !== "temp") {
        if (live <= instantRespawnCap(group)) instants++;
        else wasted++;
      }
      live--;
    }

    for (let i = 0; i < instants; i++)
      live = spawnInto(live, group.def.count, tally);
  }

  return { wasted, temps: tally.temps };
}

/**
 * @param {Object} mob
 * @returns {number} 1 when our swing at it may waste a kill, else minus the temps it surely spawns
 */
function growthKillRank(mob) {
  if (!USE_GROWTH_TARGETING) return 0;

  const mayKill = getSwingKills(mob, GROWTH_LETHAL_MARGIN, GROWTH_SPLASH_SLACK);
  if (playOutKills(mayKill, "min").wasted) return 1;

  const sureKill = getSwingKills(mob, GROWTH_SURE_MARGIN, 0);
  return -playOutKills(sureKill, "max").temps;
}

/**
 * @param {Object} mob
 * @returns {number} -1 to wear it down now, 1 to spare it, else 0
 */
function growthDamageRank(mob) {
  if (!USE_GROWTH_TARGETING) return 0;

  const group = getGrowthGroupOf(mob);
  const kind = growthTracker.members[mob.id]?.kind;
  if (!group || !kind) return 0;

  const live = getGroupLive(group);
  const cap = instantRespawnCap(group);
  if (live.min > cap) return kind === "temp" ? -1 : 1;
  if (live.max <= cap && kind === "permanent") return -1;

  return 0;
}

/** @param {{id: string, hid?: string, source?: string, splash?: boolean, kill?: boolean}} data */
function onGrowthHit(data) {
  if (!data?.kill) return;

  const entity = parent.entities[data.id];
  if (entity) onGrowthKill(entity, data);
}
if (parent.onGrowthHit) parent.socket.off("hit", parent.onGrowthHit);
parent.onGrowthHit = onGrowthHit;
parent.socket.on("hit", onGrowthHit);

setInterval(scanGrowthSpawns, GROWTH_SCAN_MS);
