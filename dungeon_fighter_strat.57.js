// Keyed dungeons: shared run bookkeeping, boss model and fight moves

/** Merchant opening per dungeon; autoOpen 0 opens none */
const DUNGEON_OPENING = {
  crypt: { autoOpen: 2, ageMs: 0 * 3_600_000, clearMs: 3_600_000 },
  spider: { autoOpen: 0, ageMs: 0 },
  tomb: { autoOpen: 0, ageMs: 0 },
  darkMage: { autoOpen: 0, ageMs: 0, needs: { fieldgen0: 10 } },
};

/** Fight tunables; distances in px */
const DUNGEON = {
  debug: true,
  holdShare: 0.9, // of party hps
  burstShare: 0.6, // of max hp per hit
  maxKillS: 900,
  reach: 200, // follow gap
  arrival: 100,
  planStaleMs: 2000,
  keepAwayMargin: 40,
  keepAwayRangeRate: 0.95,
  snowballUptime: 0.8,
  snowballGapMs: 1500,
  fieldReach: 200,
  fieldMargin: 60,
  fieldGapMs: 3000,
  fieldHealAt: 0.8, // of its max hp
  stompRadius: 160, // server-hardcoded
  stompStunMs: 1500, // server-hardcoded
  handOverRange: 350,
  freeSlots: 6, // kept free on the tanker
  requestGapMs: 60_000,
  supplyPatienceMs: 300_000,
  supplyGraceMs: 10_000, // with none left in stock
  supplyRetryMs: 1_800_000,
  giveUpAfterMs: 15_000,
  goalStaleMs: 30_000, // a gather point, or the tanker's live info, older than this is ignored
};

const DUNGEON_MAPS = {
  crypt: "crypt",
  spider: "spider_instance",
  tomb: "tomb",
  darkMage: "winter_instance",
};

/** @returns {Object|undefined} the dungeon as G describes it, none without a keyed door */
function describeDungeon(id, map) {
  const [from, door] =
    Object.entries(G.maps).flatMap(([name, def]) =>
      (def.doors ?? [])
        .filter((door) => door[4] === map && door[7] === "key")
        .map((door) => [name, door]),
    )[0] ?? [];
  const doorSpot = G.maps[from]?.spawns?.[door?.[6]];
  const spawns = G.maps[map]?.spawns ?? [];
  const entrance = spawns[door?.[5]] ?? spawns[0];
  if (!doorSpot || !entrance) {
    console.warn(`dungeon ${id}: no keyed door to ${map} in G, left out`);
    return undefined;
  }
  const [doorX, doorY] = doorSpot;
  const [x, y] = entrance;
  const packs = G.maps[map].monsters ?? [];
  const phasesOf = (mtype) =>
    mtype ? [mtype, ...phasesOf(G.monsters[mtype].respawn_as)] : [];
  const isBoss = (mtype) =>
    G.monsters[mtype].respawn === -1 || !!G.monsters[mtype].respawn_as;

  return {
    id,
    map,
    key: door[8],
    door: { map: from, x: doorX, y: doorY },
    entrance: { map, x, y },
    types: [...new Set(packs.flatMap(({ type }) => phasesOf(type)))],
    bosses: packs
      .filter(({ type, count }) => count > 0 && isBoss(type))
      .map(({ type, boundary: [x1, y1, x2, y2] = [x, y, x, y] }) => ({
        phases: phasesOf(type),
        spot: { map, x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
      })),
  };
}

const DUNGEONS = Object.fromEntries(
  Object.entries(DUNGEON_MAPS)
    .map(([id, map]) => [id, describeDungeon(id, map)])
    .filter(([, dungeon]) => dungeon),
);

/** Our state in the current instance */
let dungeonState = freshDungeonState();

function freshDungeonState(instance) {
  return {
    instance,
    seenTypes: {}, // monster id -> mtype
    publishedAt: 0,
    snowballAt: {}, // boss id -> time
    fieldAt: 0,
    plan: undefined, // { target, dragTo, at }
    requestAt: 0,
    supplyWaitSince: undefined,
    giveUpSince: 0,
    giveUpSeenAt: 0,
    lastLogs: {}, // stage -> line
  };
}

/** Debug warn, once per stage until the line changes */
function dungeonLog(stage, line) {
  if (!DUNGEON.debug || dungeonState.lastLogs[stage] === line) return;
  dungeonState.lastLogs[stage] = line;
  console.warn(`dungeon ${stage}: ${line}`);
}

const DUNGEON_NEED_ITEMS = [
  ...new Set(
    Object.values(DUNGEON_OPENING).flatMap(({ needs = {} }) =>
      Object.keys(needs),
    ),
  ),
];

/** @returns {string[]} our online characters */
const getOnlineCharacters = () =>
  parent.caracAL
    ? parent.caracAL.siblings ?? []
    : Object.keys(get_active_characters());

/** @returns {number} what our other online characters carry */
const getCarriedByOthers = (itemId) =>
  getOnlineCharacters()
    .filter((name) => name !== character.name)
    .reduce(
      (total, name) =>
        total + (getCharacterInfo(name)?.dungeonStock?.[itemId] ?? 0),
      0,
    );

/** @returns {number} the bank's count plus every online character's */
function getDungeonStock(itemId) {
  const banked = Object.values(get("bankCache") ?? {})
    .filter(Array.isArray)
    .flat()
    .reduce(
      (total, item) => total + (item?.name === itemId ? item.q ?? 1 : 0),
      0,
    );
  return banked + getTotalQuantityOf(itemId) + getCarriedByOthers(itemId);
}

/** @returns {number} the most any dungeon needs of the item */
const getDungeonNeed = (itemId) =>
  Math.max(
    0,
    ...Object.values(DUNGEON_OPENING).map(({ needs }) => needs?.[itemId] ?? 0),
  );

const hasDungeonNeeds = (id) =>
  Object.entries(DUNGEON_OPENING[id].needs ?? {}).every(
    ([itemId, count]) => getDungeonStock(itemId) >= count,
  );

const isDungeonMap = (map) =>
  Object.values(DUNGEONS).some((dungeon) => dungeon.map === map);

const getDungeonOfMap = (map) =>
  Object.values(DUNGEONS).find((dungeon) => dungeon.map === map);

/** @returns {{instance: string, openedAt: number, realm: string, startedAt?: number, leftAt?: number}[]} */
const getDungeonVisits = (id) => get(`${id}Visits`) ?? [];

const getDungeonInstance = (id) => get(`${id}Instance`);

/** @returns {string|undefined} the dungeon whose run is under way */
const getRunningDungeonId = () =>
  Object.keys(DUNGEONS).find((id) => getDungeonInstance(id));

const getActiveDungeonVisit = (id) =>
  getDungeonVisits(id).find(
    (visit) => visit.instance === getDungeonInstance(id),
  );

/** @returns {boolean} whether a run, any by default, is open on this realm */
function isDungeonRunHere(id = getRunningDungeonId()) {
  if (!id || !getDungeonInstance(id)) return false;
  const realm = getActiveDungeonVisit(id)?.realm;
  return !realm || realm === getCurrentServer();
}

/** Starts the oldest ready visit, one run at a time */
function startNextDungeonRun() {
  if (getRunningDungeonId()) return;

  const [id, visit] =
    Object.keys(DUNGEONS)
      .flatMap((id) =>
        getDungeonVisits(id)
          .filter(
            (visit) =>
              !visit.leftAt &&
              visit.realm === getCurrentServer() &&
              Date.now() - visit.openedAt >= DUNGEON_OPENING[id].ageMs &&
              Date.now() - (visit.shelvedAt ?? 0) >= DUNGEON.supplyRetryMs,
          )
          .map((visit) => [id, visit]),
      )
      .filter(([id]) => hasDungeonNeeds(id))
      .sort(([, lhs], [, rhs]) => lhs.openedAt - rhs.openedAt)[0] ?? [];
  if (!visit) return;
  if (!partyMems.every((name) => get_entity(name) || parent.party?.[name]))
    return;

  set(
    `${id}Visits`,
    getDungeonVisits(id).map((other) =>
      other.instance === visit.instance
        ? { ...other, startedAt: Date.now() }
        : other,
    ),
  );
  set(`${id}Instance`, visit.instance);
}

/** Puts the run back among the waiting visits, retried after supplyRetryMs */
function shelveDungeonRun(id) {
  const instance = getDungeonInstance(id);
  set(
    `${id}Visits`,
    getDungeonVisits(id).map((visit) =>
      visit.instance === instance
        ? { ...visit, startedAt: undefined, shelvedAt: Date.now() }
        : visit,
    ),
  );
  set(`${id}Instance`, undefined);
}

/** @returns {boolean} whether the instance is gone from this realm */
function isDungeonGone(id, error) {
  const realm = getActiveDungeonVisit(id)?.realm;
  return (
    (!realm || realm === getCurrentServer()) &&
    /invalid/.test(`${error?.response} ${error?.reason}`)
  );
}

/** @returns {{killed: Object<string, string>}} the party's merged ledger and flags */
function readDungeonRun(id) {
  const instance = getDungeonInstance(id);
  const records = [
    getActiveDungeonVisit(id),
    ...partyMems
      .map((name) => get(`${id}Run:${name}`))
      .filter((record) => record?.instance === instance),
  ];
  const run = { killed: {} };

  for (const record of records) {
    if (!record) continue;
    Object.assign(run.killed, record.killed);
    for (const [key, value] of Object.entries(record))
      if (typeof value === "boolean") run[key] ||= value;
  }
  return run;
}

/** @param {(record: Object) => void} change - applied to our own record */
function writeDungeonRun(id, change) {
  const key = `${id}Run:${character.name}`;
  const instance = getDungeonInstance(id);
  const stored = get(key);
  const record =
    stored?.instance === instance ? stored : { instance, killed: {} };

  change(record);
  set(key, record);
}

/**
 * @param {Object} [options]
 * @param {boolean} [options.isGone]
 * @param {Object} [options.kept] - record fields kept for mobs left
 */
function closeDungeonRun(id, { isGone = false, kept } = {}) {
  const instance = getDungeonInstance(id);
  const visit = getActiveDungeonVisit(id);

  if (visit?.startedAt && !visit.leftAt && !isGone && !kept) {
    const took = Date.now() - visit.startedAt;
    const average = get(`${id}ClearMs`);
    set(`${id}ClearMs`, average ? average * 0.7 + took * 0.3 : took);
  }

  const keptVisits =
    visit && kept && !isGone
      ? [
          {
            instance,
            openedAt: visit.openedAt,
            realm: visit.realm,
            leftAt: Date.now(),
            ...kept,
          },
        ]
      : [];
  set(`${id}Visits`, [
    ...getDungeonVisits(id).filter((other) => other.instance !== instance),
    ...keptVisits,
  ]);
  set(`${id}Instance`, undefined);
}

/** Remembers a mob's type for deaths out of view */
function noteDungeonMob(mob) {
  if (dungeonState.instance !== character.in)
    dungeonState = freshDungeonState(character.in);
  dungeonState.seenTypes[mob.id] = mob.mtype;
}

game.on("death", ({ id }) => {
  const dungeon = getDungeonOfMap(character.map);
  if (!dungeon || character.in !== getDungeonInstance(dungeon.id)) return;

  const mtype = parent.entities[id]?.mtype ?? dungeonState.seenTypes[id];
  if (!dungeon.types.includes(mtype)) return;

  writeDungeonRun(dungeon.id, (record) => (record.killed[id] = mtype));
});

/**
 * @param {string} mtype
 * @param {number} ageMs - since the instance opened
 * @returns {Object} the boss at its server-levelled stats
 */
function agedBoss(mtype, ageMs) {
  const def = G.monsters[mtype];
  let level = 1;
  let hp = def.hp;

  for (let left = def.stationary ? 0 : ageMs; level < 100; level++) {
    const stepMs = Math.max(180_000, hp * 30) * 2 ** ((level - 1) * 0.3);
    if (left < stepMs) break;
    left -= stepMs;
    hp += def.hp / 2;
  }

  const scale = level > 1 ? Math.min(level, 12) : 0;
  return {
    ...def,
    type: "monster",
    mtype,
    level,
    hp,
    max_hp: hp,
    attack: def.attack * (1 + scale * 0.125),
    frequency: def.frequency + scale * 0.034,
  };
}

/** @returns {number} share of the time we alone keep a boss frozen */
function getOwnFreezeUptime() {
  if (locate_item("snowball") !== -1) return DUNGEON.snowballUptime;

  const chance = Math.max(
    0,
    ...[...character.items, ...Object.values(character.slots)]
      .filter((item) => item && G.items[item.name]?.ability === "freeze")
      .map(({ name, level = 0 }) => {
        const { attr0, upgrade } = G.items[name];
        return (attr0 + (upgrade?.attr0 ?? 0) * level) / 100;
      }),
  );
  if (!chance) return 0;

  const frozenS = G.conditions.frozen.duration / 1000;
  return frozenS / (frozenS + 1 / (chance * character.frequency));
}

/** Publishes our kit, once a second */
function publishDungeonKit() {
  if (Date.now() - dungeonState.publishedAt < 1000) return;
  dungeonState.publishedAt = Date.now();

  publishCharacterInfo({
    freezeUptime: getOwnFreezeUptime(),
    hasFieldgen: locate_item("fieldgen0") !== -1,
    dungeonStock: Object.fromEntries(
      DUNGEON_NEED_ITEMS.map((itemId) => [itemId, getTotalQuantityOf(itemId)]),
    ),
  });
}

/** @returns {boolean} whether the tanker waits for supplies */
function supplyDungeonNeeds(dungeon) {
  const needs = Object.entries(DUNGEON_OPENING[dungeon.id].needs ?? {});
  let isWaiting = false;

  for (const [itemId, count] of needs) {
    if (!isAssignedAsTanker()) {
      const tanker = get_entity(TANKER);
      const slot = locate_item(itemId);
      if (
        slot !== -1 &&
        tanker &&
        distance(character, tanker) < DUNGEON.handOverRange
      )
        send_item(TANKER, slot, character.items[slot].q ?? 1);
      continue;
    }

    const missing = Math.min(
      count - getTotalQuantityOf(itemId),
      character.esize - DUNGEON.freeSlots,
    );
    if (missing <= 0 || character.map === dungeon.map) continue;

    dungeonState.supplyWaitSince ??= Date.now();
    isWaiting = true;
    const isStockLeft = getDungeonStock(itemId) > getTotalQuantityOf(itemId);
    const patienceMs = isStockLeft
      ? DUNGEON.supplyPatienceMs
      : DUNGEON.supplyGraceMs;
    if (Date.now() - dungeonState.supplyWaitSince >= patienceMs) {
      dungeonLog(
        dungeon.id,
        isStockLeft
          ? `no ${itemId} came, shelving the run`
          : `no ${itemId} left in stock, shelving the run`,
      );
      shelveDungeonRun(dungeon.id);
      break;
    }
    if (Date.now() - dungeonState.requestAt < DUNGEON.requestGapMs) continue;

    dungeonState.requestAt = Date.now();
    dungeonLog(dungeon.id, `asking the merchant for ${missing} ${itemId}`);
    send_cm(partyMerchant, {
      msg: "dungeon_item",
      item: itemId,
      count: missing,
      map: character.map,
      x: character.x,
      y: character.y,
    });
  }
  return isWaiting;
}

/** @returns {{holder: Object, healer?: Object, party: Object[], hps: number, isReady: boolean, freezeUptime: number, canDampen: boolean}} */
function getDungeonFight() {
  const isAlive = (entity) => !!entity && !entity.rip;
  const tanker = get_entity(TANKER);
  const healer = get_entity(HEALER);
  const holder = isAlive(tanker) ? tanker : character;
  const party = partyMems.map((name) => get_entity(name)).filter(isAlive);

  return {
    holder,
    healer: isAlive(healer) ? healer : undefined,
    party,
    freezeUptime: Math.max(
      0,
      ...party.map(
        (member) => getCharacterInfo(member.name)?.freezeUptime ?? 0,
      ),
    ),
    canDampen: !!getCharacterInfo(holder.name)?.hasFieldgen,
    hps:
      ((isAlive(healer) ? healerHps(healer) : 0) + hpot1Regen()) *
      DUNGEON.holdShare,
    isReady: isAlive(tanker) && isAlive(healer),
  };
}

/** @returns {number} its anger, deepfreeze or undampened warpstomp radius; 0 for none */
function getRetargetRadius(mtype, fight) {
  const { anger, deepfreeze, warpstomp } = G.monsters[mtype].abilities ?? {};
  return Math.max(
    0,
    ...[anger, deepfreeze, !fight.canDampen && warpstomp]
      .filter(Boolean)
      .map(({ radius }) => radius),
  );
}

/** @returns {boolean} whether the member works from outside the retarget radius */
function canKeepAway(member, mtype, fight) {
  const radius = getRetargetRadius(mtype, fight);
  if (!radius) return true;
  if (member.name === fight.holder.name) return false;

  const reach =
    member.range * DUNGEON.keepAwayRangeRate -
    (member.name === fight.healer?.name ? G.monsters[mtype].range : 0);
  return reach >= radius + DUNGEON.keepAwayMargin;
}

/** @returns {Object[]} the holder and whoever it can turn on */
function getBossVictims(boss, fight) {
  return [
    fight.holder,
    ...fight.party.filter(
      (member) =>
        member.name !== fight.holder.name &&
        !canKeepAway(member, boss.mtype, fight),
    ),
  ];
}

const resistShare = (entity, stat) => Math.min((entity?.[stat] ?? 0) / 100, 1);

/** @returns {number} steady burn per second on the victim */
function burnDps(boss, victim) {
  const burn = G.monsters[boss.mtype]?.abilities?.burn;
  if (!burn) return 0;

  const hit = calculateDamage(boss, victim, false) / boss.frequency;
  const scale = 1 - resistShare(victim, "firesistance");
  const kept = scale / (burn.unlimited ? 1.5 : 3);
  return (hit * Math.min(burn.attr0 / 100, 1) * scale) / (1 - kept);
}

/** @returns {number} its dps to heal, volleys included */
function dungeonBossDps(boss, fight) {
  const def = G.monsters[boss.mtype];
  const frozenShare = def.immune
    ? 0
    : fight.freezeUptime * (1 - G.conditions.frozen.frequencym);
  const hits = Math.max(
    ...getBossVictims(boss, fight).map(
      (victim) => calculateDamage(boss, victim) + burnDps(boss, victim),
    ),
  );
  const volleys = ["multi_burn", "multi_freeze"]
    .map((name) => def.abilities?.[name])
    .filter((volley) => volley?.damage)
    .reduce(
      (total, { damage, cooldown }) =>
        total +
        fight.party.reduce(
          (sum, member) =>
            sum + ((damage * 1000) / cooldown) * mitigation(boss, member),
          0,
        ),
      0,
    );
  const { deepfreeze } = def.abilities ?? {};
  const freezeHits = deepfreeze
    ? (G.skills.deepfreeze.damage * 1000) / deepfreeze.cooldown
    : 0;

  return hits * (1 - frozenShare) + volleys + freezeHits;
}

/** @returns {number} share of the party's healing that lands */
function getHealShare(boss, fight) {
  const def = G.monsters[boss.mtype];
  const { deepfreeze, warpstomp } = def.abilities ?? {};
  const { healer, holder } = fight;
  const poisonResist = resistShare(holder, "pnresistance");
  const poisonShare = def.poisonous
    ? poisonResist + (1 - poisonResist) * G.conditions.poisoned.healm
    : 1;
  if (!healer) return poisonShare;

  const frozenShare =
    deepfreeze && !canKeepAway(healer, boss.mtype, fight)
      ? (G.conditions.deepfreezed.duration /
          deepfreeze.cooldown /
          getBossVictims(boss, fight).length) *
        (1 - resistShare(healer, "fzresistance"))
      : 0;

  const healerReach =
    healer.name === holder.name
      ? 0
      : healer.range * DUNGEON.keepAwayRangeRate - def.range;
  const isStompable =
    !!warpstomp &&
    !fight.canDampen &&
    healerReach <
      warpstomp.radius + DUNGEON.stompRadius + DUNGEON.keepAwayMargin;
  const stunnedShare = isStompable
    ? (DUNGEON.stompStunMs / warpstomp.cooldown) *
      (1 - resistShare(healer, "phresistance"))
    : 0;

  return (
    poisonShare *
    Math.max(0, 1 - Math.min(frozenShare, 1) - Math.min(stunnedShare, 1))
  );
}

/**
 * @param {Object[]} bosses - on us at once
 * @returns {boolean} whether the party heals through them
 */
function canHoldDungeonBosses(bosses, fight) {
  const isBurstSafe = bosses.every((boss) =>
    getBossVictims(boss, fight).every(
      (victim) =>
        calculateDamage(boss, victim, false) / boss.frequency <
        victim.max_hp * DUNGEON.burstShare,
    ),
  );
  const dps = bosses.reduce(
    (total, boss) => total + dungeonBossDps(boss, fight),
    0,
  );
  const healShare = Math.min(
    1,
    ...bosses.map((boss) => getHealShare(boss, fight)),
  );
  return isBurstSafe && dps < fight.hps * healShare;
}

/** @returns {number} seconds to kill it, Infinity if its self heal keeps up */
function getDungeonKillS(boss, party) {
  const healing = G.monsters[boss.mtype].abilities?.self_healing;
  const net =
    party.reduce(
      (total, member) => total + calculateDamage(member, boss, false),
      0,
    ) - (healing ? (healing.heal * 1000) / healing.cooldown : 0);
  return net > 0 ? boss.hp / net : Infinity;
}

/** @returns {{mtype: string, spot: Object, entity?: Object, boss: Object, killS: number}[]} each live boss */
function judgeDungeonBosses(dungeon, fight) {
  const killed = Object.values(readDungeonRun(dungeon.id).killed);
  const openedAt = getActiveDungeonVisit(dungeon.id)?.openedAt ?? Date.now();

  return dungeon.bosses
    .map(({ phases, spot }) => ({
      mtype: phases.find((mtype) => !killed.includes(mtype)),
      spot,
    }))
    .filter(({ mtype }) => mtype)
    .map(({ mtype, spot }) => {
      const entity = get_nearest_monster({ type: mtype });
      const boss = entity ?? agedBoss(mtype, Date.now() - openedAt);
      return {
        mtype,
        spot,
        entity,
        boss,
        killS: getDungeonKillS(boss, fight.party),
      };
    });
}

/** @returns {boolean} whether the party holds and kills the group */
const canFightDungeonGroup = (group, fight) =>
  canHoldDungeonBosses(
    group.map(({ boss }) => boss),
    fight,
  ) && group.every(({ killS }) => killS < DUNGEON.maxKillS);

/** @returns {boolean} whether the boss targets one of us */
const isDungeonBossOnUs = ({ entity }) =>
  !!entity && partyMems.includes(entity.target);

/** @returns {Object[]} the bosses in view */
function noteDungeonBosses(dungeon) {
  const bossTypes = dungeon.bosses.flatMap(({ phases }) => phases);
  return Object.values(parent.entities).filter((mob) => {
    if (mob.type !== "monster" || mob.dead) return false;
    if (dungeon.types.includes(mob.mtype)) noteDungeonMob(mob);
    return bossTypes.includes(mob.mtype);
  });
}

/** @returns {Object|undefined} a non-boss mob on one of us */
const getDungeonAdd = (bosses) =>
  Object.values(parent.entities).find(
    (mob) =>
      mob.type === "monster" &&
      !mob.dead &&
      !bosses.includes(mob) &&
      partyMems.includes(mob.target),
  );

/** @returns {Promise<Object>|undefined} travelling while backing off, else the tanker closes the run */
function giveUpDungeonFight(dungeon, isBossOnUs) {
  if (isBossOnUs)
    return leaveDungeonFight(dungeon, "can't hold what is on us, backing off");

  const now = Date.now();
  if (now - dungeonState.giveUpSeenAt > DUNGEON.planStaleMs)
    dungeonState.giveUpSince = now;
  dungeonState.giveUpSeenAt = now;
  if (
    !isAssignedAsTanker() ||
    now - dungeonState.giveUpSince < DUNGEON.giveUpAfterMs
  )
    return leaveDungeonFight(dungeon, "nothing we can hold, waiting it out");

  dungeonLog(dungeon.id, "nothing left we can hold, closing the run");
  closeDungeonRun(dungeon.id, {
    kept: { killed: readDungeonRun(dungeon.id).killed },
  });
  return undefined;
}

/** Where we head of our own accord: the party's gather point, any role */
let dungeonGoal; // { instance, map, x, y, at }
let dungeonGoalPublishedAt = 0;

/** Sets our goal; a move past DUNGEON.reach is published at once, a refresh once a second */
function setDungeonGoal(spot) {
  const isMoved =
    !dungeonGoal ||
    dungeonGoal.instance !== character.in ||
    distance(dungeonGoal, spot) > DUNGEON.reach;
  dungeonGoal = {
    instance: character.in,
    map: character.map,
    x: spot.x,
    y: spot.y,
    at: Date.now(),
  };
  if (!isMoved && Date.now() - dungeonGoalPublishedAt < 1000) return;
  dungeonGoalPublishedAt = Date.now();
  publishCharacterInfo({ dungeonGoal });
}

function clearDungeonGoal() {
  if (!dungeonGoal) return;
  dungeonGoal = undefined;
  publishCharacterInfo({ dungeonGoal: undefined });
}

/** @returns {Object|undefined} the freshest goal another of us has published in this instance */
function getDungeonGatherPoint() {
  const goal = partyMems
    .filter((name) => name !== character.name)
    .map((name) => getCharacterInfo(name)?.dungeonGoal)
    .filter(
      (goal) =>
        goal?.instance === character.in &&
        Date.now() - goal.at < DUNGEON.goalStaleMs,
    )
    .sort((lhs, rhs) => rhs.at - lhs.at)[0];
  return goal && { map: goal.map, x: goal.x, y: goal.y };
}

/**
 * Walks to the party's gather point, dropping our own goal for it.
 * @param {() => boolean} [isStop] - ends the walk early
 * @returns {boolean} whether there is a gather point to go by
 */
function gatherInDungeon(isStop = () => false) {
  const point = getDungeonGatherPoint();
  if (!point) return false;
  clearDungeonGoal();
  if (distance(character, point) <= DUNGEON.reach) return true;

  const isPointMoved = () => {
    const now = getDungeonGatherPoint();
    return !now || distance(now, point) > DUNGEON.reach;
  };
  advanceSmartMove(point, {
    useScare: true,
    stopWatcher: () => isStop() || isPointMoved(),
  }).catch(() => {});
  return true;
}

/** @returns {boolean} whether the tanker is dead, gone from the instance or silent */
function isDungeonTankerDown() {
  const tanker = get_entity(TANKER);
  if (tanker) return !!tanker.rip;
  const info = getCharacterInfo(TANKER);
  return (
    !info ||
    !!info.rip ||
    info.in !== character.in ||
    Date.now() - info.at > DUNGEON.goalStaleMs
  );
}

/**
 * The tanker or the healer out of view: we go by the gather point, else walk
 * to the nearest boss box left and wait there in sight of it.
 * @returns {Promise<Object>} travelling
 */
async function waitForDungeonParty(dungeon) {
  if (isDungeonTankerDown()) return leaveDungeonFight(dungeon);
  changeToNormalStrategies();
  if (listOfMonsterAttacking(character).length) await scareAwayMobs();
  if (gatherInDungeon(() => listOfMonsterAttacking(character).length > 0)) {
    dungeonLog(dungeon.id, "going to the gather point");
    return travelling();
  }

  const killed = Object.values(readDungeonRun(dungeon.id).killed);
  const box = dungeon.bosses
    .map(({ phases, spot }) => ({
      mtype: phases.find((mtype) => !killed.includes(mtype)),
      spot,
    }))
    .filter(({ mtype }) => mtype)
    .sort((lhs, rhs) => distance(character, lhs.spot) - distance(character, rhs.spot))[0];
  if (!box) return leaveDungeonFight(dungeon, "no boss left, meeting at the entrance");
  if (!get_nearest_monster({ type: box.mtype }))
    return walkToDungeonBoss(dungeon, box);

  dungeonLog(dungeon.id, `waiting for the party at ${box.mtype}`);
  setDungeonGoal(box.spot);
  return travelling();
}

/**
 * Everyone walks to the boss's box on its own.
 * @param {Object} entry - a judged boss
 * @returns {Object} travelling
 */
function walkToDungeonBoss(dungeon, entry) {
  changeToNormalStrategies();
  dungeonLog(dungeon.id, `walking to ${entry.mtype}`);
  setDungeonGoal(entry.spot);
  advanceSmartMove(
    { ...entry.spot },
    { stopWatcher: () => !!get_nearest_monster({ type: entry.mtype }) },
  ).catch(() => {});
  return travelling();
}

/** Shakes off a boss on us and waits at the entrance */
async function leaveDungeonFight(
  dungeon,
  line = "holding off at the entrance",
) {
  changeToNormalStrategies();
  dungeonLog(dungeon.id, line);
  if (listOfMonsterAttacking(character).length) await scareAwayMobs();
  if (distance(character, dungeon.entrance) > DUNGEON.arrival)
    advanceSmartMove({ ...dungeon.entrance }).catch(() => {});
  return travelling();
}

/** Snowballs the boss on us unless immune */
function freezeDungeonBoss(boss) {
  if (G.monsters[boss.mtype].immune || !partyMems.includes(boss.target)) return;
  if (locate_item("snowball") === -1) return;
  if (character.mp < G.skills.snowball.mp || is_on_cooldown("snowball")) return;
  if ((boss.s?.frozen?.ms ?? 0) >= DUNGEON.snowballGapMs) return;
  if (
    Date.now() - (dungeonState.snowballAt[boss.id] ?? 0) <
    DUNGEON.snowballGapMs
  )
    return;
  if (!is_in_range(boss, "snowball")) return;

  dungeonState.snowballAt[boss.id] = Date.now();
  use_skill("snowball", boss);
}

/** @returns {Object[]} field generators in view */
const getFieldGenerators = () =>
  Object.values(parent.entities).filter(
    (mob) => mob.type === "monster" && mob.mtype === "fieldgen0" && !mob.dead,
  );

/** @returns {Object|undefined} a field generator needing a heal */
function getFieldToHeal() {
  if (!isDungeonMap(character.map)) return undefined;
  return getFieldGenerators().find(
    (field) =>
      field.hp < field.max_hp * DUNGEON.fieldHealAt &&
      is_in_range(field, "heal"),
  );
}

/** Keeps a field generator by a warpstomper on the tanker */
function dampenDungeonBoss(boss) {
  if (!G.monsters[boss.mtype].abilities?.warpstomp) return;
  if (boss.target !== character.name || !isAssignedAsTanker()) return;
  if (distance(character, boss) > DUNGEON.fieldReach) return;

  const slot = locate_item("fieldgen0");
  if (slot === -1) return;

  const reach =
    G.monsters.fieldgen0.abilities.dampening_aura.radius - DUNGEON.fieldMargin;
  const isCovered = getFieldGenerators().some(
    (field) => distance(field, boss) < reach,
  );
  if (isCovered || Date.now() - dungeonState.fieldAt < DUNGEON.fieldGapMs)
    return;

  dungeonState.fieldAt = Date.now();
  equip(slot);
}

/** @returns {Object|undefined} where the tanker drags the target */
function getDungeonKiteAnchor(target) {
  const { plan } = dungeonState;
  if (!plan?.dragTo || !isAssignedAsTanker()) return undefined;
  if (Date.now() - plan.at > DUNGEON.planStaleMs) return undefined;
  if (character.map !== plan.dragTo.map || target?.id !== plan.target.id)
    return undefined;
  return plan.dragTo;
}

/**
 * @param {Object} [dragTo] - where the tanker drags it
 * @returns {Object} the engage, or travelling while one of its hits would nearly kill us
 */
function engageDungeonBoss(dungeon, target, fight, dragTo) {
  const isHitTooHeavy =
    calculateDamage(target, character, false) / target.frequency >=
    character.max_hp * DUNGEON.burstShare;
  if (
    !isAssignedAsTanker() &&
    !partyMems.includes(target.target) &&
    isHitTooHeavy
  ) {
    dungeonLog(dungeon.id, `waiting for the tanker to open on ${target.mtype}`);
    return travelling();
  }
  dungeonState.plan = { target, dragTo, at: Date.now() };
  setDungeonGoal(dragTo ?? target);
  dungeonLog(
    dungeon.id,
    dragTo
      ? `hitting ${target.mtype}, dragging it to ${Math.round(
          dragTo.x,
        )},${Math.round(dragTo.y)}`
      : `hitting ${target.mtype}`,
  );

  const radius = getRetargetRadius(target.mtype, fight);
  if (radius && canKeepAway(character, target.mtype, fight))
    rangeRate = Math.min(
      DUNGEON.keepAwayRangeRate,
      Math.max(rangeRate, (radius + DUNGEON.keepAwayMargin) / character.range),
    );

  freezeDungeonBoss(target);
  dampenDungeonBoss(target);
  return engage(target);
}

/** @returns {boolean} whether this dungeon's run is under way here */
function isOurDungeonRun(id) {
  publishDungeonKit();
  startNextDungeonRun();
  dungeonState.plan = undefined;

  const runningId = getRunningDungeonId();
  if (!runningId) dungeonState.supplyWaitSince = undefined;
  return runningId === id && isDungeonRunHere(id);
}

/** @returns {Object} travelling to the door, or in */
function approachDungeon(dungeon) {
  changeToNormalStrategies();
  const isWaitingForSupply = supplyDungeonNeeds(dungeon);
  const isPartyHere = partyMems.every(
    (name) => get_entity(name) || parent.party?.[name],
  );
  const isTankerIn =
    parent.party?.[TANKER]?.in === getDungeonInstance(dungeon.id);
  const isHeld = isAssignedAsTanker()
    ? isWaitingForSupply || !isPartyHere
    : !isTankerIn;
  dungeonLog(
    dungeon.id,
    !isHeld
      ? "going in"
      : isWaitingForSupply
      ? "waiting at the door for supplies"
      : isAssignedAsTanker()
      ? "waiting at the door for the party"
      : "waiting at the door for the tanker",
  );
  const spot = isHeld ? dungeon.door : dungeon.entrance;
  if (distance(character, spot) > DUNGEON.arrival)
    advanceSmartMove({ ...spot }).catch(() => {});
  return travelling();
}

/** @returns {boolean} whether the priest heals through the ally's attackers too */
function canAbsorbInDungeon(ally) {
  if (character.map === "crypt") return canAbsorbInCrypt(ally);
  if (!isDungeonMap(character.map)) return true;

  const fight = { ...getDungeonFight(), holder: character };
  const pile = [
    ...listOfMonsterAttacking(character),
    ...listOfMonsterAttacking(ally),
  ];
  return (
    pile.reduce(
      (total, mob) =>
        total + calculateDamage(mob, character) + burnDps(mob, character),
      0,
    ) <
    fight.hps * Math.min(...pile.map((mob) => getHealShare(mob, fight)), 1)
  );
}

/** @returns {Object[]} each live boss's odds alone */
function getDungeonOdds(id) {
  const fight = getDungeonFight();
  return judgeDungeonBosses(DUNGEONS[id], fight).map(
    ({ mtype, boss, killS }) => ({
      mtype,
      level: boss.level,
      isHoldable: canHoldDungeonBosses([boss], fight),
      dps: Math.round(dungeonBossDps(boss, fight)),
      hps: Math.round(fight.hps * getHealShare(boss, fight)),
      killS: Math.round(killS),
      victims: getBossVictims(boss, fight).map(({ name }) => name),
    }),
  );
}
