// Grow spawn groups: permanent vs temp spawns, and group live counts

const GROWTH_INSTANT_WINDOW_MS = 1500;
const GROWTH_TIMER_JITTER_MS = 900;
const GROWTH_TIMER_SLACK_MS = 1500;
const GROWTH_SCAN_MS = 100;
const GROWTH_LETHAL_MARGIN = 1.35;
const GROWTH_SPAWN_TOLERANCE = 10;

var growthDebug = false;

/**
 * @typedef {Object} GrowthGroup
 * @property {number} index
 * @property {Object} def - G.maps spawn definition
 * @property {{from: number, to: number}[]} expected - respawns due
 */

/** @type {{map?: string, groups: GrowthGroup[], members: Object<string, {group?: number, kind?: string}>}} */
const growthTracker = { map: undefined, groups: [], members: {} };

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
 * @returns {boolean} whether hits in the air finish it
 */
function isDoomedByIncoming(mob) {
  if (typeof projectileManager === "undefined") return false;
  return mob.hp + projectileManager.getIncomingNumber(mob.id) <= 0;
}

/**
 * @param {GrowthGroup} group
 * @param {Object} [subject] - counted even if doomed
 * @returns {{min: number, max: number}} live count, doomed mobs excluded
 */
function getGroupLive(group, subject) {
  let known = 0;
  let unknown = 0;

  for (const entity of Object.values(parent.entities)) {
    if (
      entity.type !== "monster" ||
      entity.mtype !== group.def.type ||
      (entity !== subject && (entity.dead || isDoomedByIncoming(entity)))
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

/** @param {Object} entity - the mob that just died */
function onGrowthKill(entity) {
  const member = growthTracker.members[entity.id];
  const group = getGrowthGroupOf(entity);
  if (!group || member.kind === "temp") return;

  const live = getGroupLive(group, entity);
  const cap = instantRespawnCap(group);
  const now = Date.now();
  const respawnS = G.monsters[group.def.type].respawn;
  const [timerFrom, timerTo] =
    respawnS > 200
      ? [respawnS * 720, respawnS * 1200]
      : [respawnS * 1000, respawnS * 1000 + GROWTH_TIMER_JITTER_MS];

  if (live.max <= cap)
    group.expected.push({ from: now, to: now + GROWTH_INSTANT_WINDOW_MS });
  if (live.min > cap)
    group.expected.push({
      from: now + timerFrom,
      to: now + timerTo + GROWTH_TIMER_SLACK_MS,
    });

  if (growthDebug)
    console.warn(
      `[growth] ${entity.mtype} #${group.index} ${member.kind ?? "?"} died at ` +
        `${live.min}-${live.max}/${group.def.count}`,
    );
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

  const due = candidates.filter((group) =>
    group.expected.some(({ from, to }) => from <= now && now <= to),
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
      const dueIndex = group.expected.findIndex(
        ({ from, to }) => from <= now && now <= to,
      );
      if (dueIndex !== -1) group.expected.splice(dueIndex, 1);
    }
  }

  if (growthDebug)
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
    group.expected = group.expected.filter(({ to }) => to >= now);

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
 * @param {Object} mob
 * @returns {boolean} whether killing it sends a permanent spawn to its timer
 */
function isWastedGrowthKill(mob) {
  const group = getGrowthGroupOf(mob);
  if (!group || growthTracker.members[mob.id].kind === "temp") return false;

  return getGroupLive(group, mob).min > instantRespawnCap(group);
}

/**
 * @param {Object} mob
 * @returns {boolean} whether our next hit may kill it
 */
function mayDieToOurHit(mob) {
  const incoming =
    typeof projectileManager === "undefined"
      ? 0
      : projectileManager.getIncomingNumber(mob.id);
  const hit = character.attack * mitigation(character, mob);

  return mob.hp + incoming <= hit * GROWTH_LETHAL_MARGIN;
}

/**
 * @param {Object} mob
 * @returns {number} 1 for a wasted kill within our next hit, else 0
 */
function growthKillRank(mob) {
  return isWastedGrowthKill(mob) && mayDieToOurHit(mob) ? 1 : 0;
}

/** @param {{id: string, kill?: boolean}} data */
function onGrowthHit(data) {
  if (!data?.kill) return;

  const entity = parent.entities[data.id];
  if (entity) onGrowthKill(entity);
}
if (parent.onGrowthHit) parent.socket.off("hit", parent.onGrowthHit);
parent.onGrowthHit = onGrowthHit;
parent.socket.on("hit", onGrowthHit);

setInterval(scanGrowthSpawns, GROWTH_SCAN_MS);
