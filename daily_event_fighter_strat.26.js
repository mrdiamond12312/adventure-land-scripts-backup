// Daily events and world bosses — the fighter's highest priority strategy.

/** Event fights in priority order; each claims the tick only while its event is on. */
const EVENT_FIGHTS = [
  () => fightSimpleBoss(["horseman"]),
  fightGoobrawl,
  fightGargoyle,
  fightLowestHpBoss,
  fightCrabxx,
  fightGraveyard,
  fightSnowman,
  fightAbtesting,
  () => fightSimpleBoss(["pinkgoo", "wabbit"]),
  // Last: every live boss above outranks the kiss
  takeAnniversaryVisit,
];

/**
 * Targets whatever live event outranks farming, walking there when it is out of
 * sight. A live event owns the tick even with nothing in reach: the field is
 * empty between waves, and going back to the farming spot loses the fight.
 * @returns {Promise<object|undefined>} the event outcome, if one owns this tick
 */
async function useEventStrategy() {
  for (const fight of EVENT_FIGHTS) {
    const outcome = await fight();
    if (outcome) return outcome;
  }
  return undefined;
}

// --- Hp-ranked bosses ---

/** Each of HP_RANKED_BOSSES (basic_function.7.js) through its own fight */
const HP_RANKED_FIGHTS = {
  icegolem: () => fightSimpleBoss(["icegolem"]),
  franky: fightFranky,
  dragold: () => fightSimpleBoss(["dragold"]),
  mrpumpkin: () => fightSimpleBoss(["mrpumpkin"]),
  mrgreen: () => fightSimpleBoss(["mrgreen"]),
};

/** @returns {Promise<object|undefined>} the outcome against the live hp-ranked boss with the least hp left */
async function fightLowestHpBoss() {
  for (const name of rankLiveBossesByHp()) {
    const outcome = await HP_RANKED_FIGHTS[name]();
    if (outcome) return outcome;
  }
  return undefined;
}

// --- Goobrawl ---

/** @returns {Promise<object|undefined>} the outcome, while goobrawl is on */
async function fightGoobrawl() {
  const isGoobrawlOn =
    server.status.goobrawl ||
    get_nearest_monster({ type: "bgoo" }) ||
    get_nearest_monster({ type: "rgoo" });
  if (!isGoobrawlOn || character.s["hopsickness"]) return;

  changeToPullStrategies();
  if (character.map !== "goobrawl") {
    await join("goobrawl");
    await sleep(character.ping);
  }

  const engagedGoo = ["bgoo", "rgoo"].includes(get_targeted_monster()?.mtype)
    ? get_targeted_monster()
    : undefined;

  return engage(
    get_nearest_monster({ type: "rgoo" }) ??
      engagedGoo ??
      get_nearest_monster({ type: "bgoo" }),
  );
}

// --- Simple bosses: walk up and hit ---

/**
 * Per-boss overrides; the default is the pull strategy at the usual kite distance.
 * @type {Object<string, {usePull?: boolean, rangeRate?: function(): number}>}
 */
const SIMPLE_BOSSES = {
  horseman: {},
  dragold: {},
  mrpumpkin: {},
  mrgreen: {},
  icegolem: { usePull: false },
  pinkgoo: {},
  wabbit: { rangeRate: () => (character.range < 100 ? 0.1 : 0.4) },
};

/**
 * Minions first while the boss is in sight, then the boss, walking to its last
 * known spot when out of sight.
 * @param {string[]} types - the bosses to pick from, lowest hp ratio first
 * @returns {Promise<object|undefined>} the outcome, while one of them is live
 */
async function fightSimpleBoss(types) {
  const hpRatio = (boss) => boss.hp / boss.max_hp;
  const bossToFight = types
    .filter((type) => server.status[type]?.live)
    .map((type) => ({ ...server.status[type], type }))
    .sort((lhs, rhs) => hpRatio(lhs) - hpRatio(rhs))[0];
  if (!bossToFight) return;

  const kaneOutcome = await waitOutBossAtKane(bossToFight.type);
  if (kaneOutcome) return kaneOutcome;

  const { usePull = true, rangeRate: bossRangeRate } =
    SIMPLE_BOSSES[bossToFight.type];
  if (usePull) changeToPullStrategies();
  else changeToNormalStrategies();
  if (bossRangeRate) rangeRate = bossRangeRate();

  let bossInstance = get_nearest_monster({ type: bossToFight.type });

  const risen = bossInstance && !isAssignedAsTanker() && getRisenOnAlly();
  if (risen) return engage(risen);

  const minion = bossInstance && getBossMinion(bossToFight.type);
  if (minion) return engage(minion);

  if (!bossInstance && bossToFight.x !== undefined) {
    await advanceSmartMove(bossToFight);
    bossInstance = get_nearest_monster({ type: bossToFight.type });
  }

  return engage(bossInstance);
}

/**
 * @param {string} bossType
 * @returns {string[]} the mtypes the boss spawns, from `G.monsters[].spawns`
 */
const getMinionTypes = (bossType) =>
  (parent.G.monsters[bossType]?.spawns ?? []).map(([, type]) => type);

/**
 * A visible add from the boss's `G.monsters[].spawns`, sticking with the one already targeted.
 * @param {string} bossType
 * @returns {object|undefined}
 */
function getBossMinion(bossType) {
  const minionTypes = getMinionTypes(bossType);
  if (!minionTypes.length) return undefined;

  const current = get_targeted_monster();
  if (minionTypes.includes(current?.mtype)) return current;

  return minionTypes.map((type) => get_nearest_monster({ type })).find(Boolean);
}

// --- Kane's luck ---

const KANE_LUCK_BOSSES = ["mrpumpkin"];
const KANE_ID = "$Kane";
const KANE_MIN_COOP_POINTS = 300_000;
const KANE_LEAVE_MS = 60_000;
const KANE_RETURN_MS = 120_000;
const KANE_STALL_MS = 60_000;
const KANE_MIN_OTHER_ATTACKERS = 3;
const KANE_ATTACKERS_TTL_MS = 10_000;
/** Inside Kane's 320px aura */
const KANE_FOLLOW_RANGE = 200;
const BOSS_HP_WINDOW_MS = 300_000;
const BOSS_HP_SAMPLE_MS = 1000;

/** Boss type -> its `[time, hp]` samples and the strangers last seen on it */
const bossTracks = {};

/** The boss we left to wait at Kane */
let kaneWaitBoss;

/** Samples the boss's hp and counts the strangers attacking it while in sight */
function trackBoss(type) {
  const now = Date.now();
  const track = (bossTracks[type] ??= {
    samples: [],
    lastDropAt: now,
    otherAttackers: 0,
    attackersSeenAt: 0,
  });

  const boss = get_nearest_monster({ type });
  const hp = boss?.hp ?? server.status[type]?.hp;
  if (hp === undefined) return track;

  const last = track.samples.at(-1);
  if (last && hp > last[1]) track.samples = [];
  if (!last || hp !== last[1]) track.lastDropAt = now;
  if (!last || hp !== last[1] || now - last[0] >= BOSS_HP_SAMPLE_MS)
    track.samples.push([now, hp]);
  track.samples = track.samples.filter(([at]) => now - at <= BOSS_HP_WINDOW_MS);

  if (boss) {
    track.otherAttackers = Object.values(parent.entities).filter(
      (entity) =>
        entity.type === "character" &&
        !entity.npc &&
        entity.target === boss.id &&
        !isOwnedCharacter(entity.name) &&
        !parent.party_list?.includes(entity.name),
    ).length;
    track.attackersSeenAt = now;
  }

  return track;
}

/** @returns {number} ms to the boss's death at its recent damage rate */
function getBossMsToDeath({ samples }) {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || last[0] === first[0]) return Infinity;

  const hpPerMs = (first[1] - last[1]) / (last[0] - first[0]);
  return hpPerMs > 0 ? last[1] / hpPerMs : Infinity;
}

function shouldLeaveForKane(track) {
  return (
    (character.s.coop?.p ?? 0) >= KANE_MIN_COOP_POINTS &&
    getBossMsToDeath(track) <= KANE_LEAVE_MS &&
    Date.now() - track.attackersSeenAt <= KANE_ATTACKERS_TTL_MS &&
    track.otherAttackers >= KANE_MIN_OTHER_ATTACKERS
  );
}

function shouldReturnFromKane(track) {
  return (
    Date.now() - track.lastDropAt > KANE_STALL_MS ||
    getBossMsToDeath(track) > KANE_RETURN_MS
  );
}

/** The mage waits out a dying coop boss inside Kane's luck aura */
async function waitOutBossAtKane(type) {
  if (character.name !== MAGE || !KANE_LUCK_BOSSES.includes(type)) return;

  const track = trackBoss(type);
  const isStaying =
    kaneWaitBoss === type
      ? !shouldReturnFromKane(track)
      : shouldLeaveForKane(track);
  const kane = isStaying && getRoamingNpcSpot(KANE_ID);

  kaneWaitBoss = kane ? type : undefined;
  if (!kane) return;

  if (distance(character, kane) > KANE_FOLLOW_RANGE) {
    await advanceSmartMove(kane);
    return travelling();
  }

  changeToNormalStrategies();
  const nearbyMob = getNearestFreeMobInReach();
  return nearbyMob ? engage(nearbyMob) : travelling();
}

/** @returns {Object|undefined} where the kite parks while waiting at Kane */
function getKaneParkSpot() {
  if (!server.status[kaneWaitBoss]?.live) return undefined;

  const kane = getRoamingNpcSpot(KANE_ID);
  return kane?.map === character.map ? kane : undefined;
}

function getNearestFreeMobInReach() {
  return Object.values(parent.entities)
    .filter(
      (mob) =>
        mob.type === "monster" &&
        !mob.dead &&
        (!mob.target || mob.target === character.name) &&
        is_in_range(mob, "attack"),
    )
    .sort((lhs, rhs) => distance(character, lhs) - distance(character, rhs))[0];
}

// --- Crabxx ---

const CRABXX_OFF_CENTER_DISTANCE = 100;
const CRABXX_FETCH_LEASH = 2000;
const CRABXX_RETURN_DISTANCE = 300;
const CRABXX_AGITATE_SLACK = 0.9;

const CRABXX_FETCH_MOVE_OPTIONS = {
  useScare: false,
  useBlink: false,
  useMagiport: false,
  useTown: false,
};

/**
 * @param {Object} [entity]
 * @returns {boolean} whether it is crabxx or one of its adds
 */
const isCrabxxMob = (entity) =>
  entity?.type === "monster" &&
  (entity.mtype === "crabxx" ||
    getMinionTypes("crabxx").includes(entity.mtype));

/** @returns {Object|undefined} the crabxx spawn center */
const getCrabxxCenter = () => getMonsterSpawns("crabxx")[0];

/**
 * @param {Object} crabxx - the boss
 * @returns {boolean} whether it is off its spawn center and not on us
 */
function isCrabxxOffCenter(crabxx) {
  const center = getCrabxxCenter();
  return (
    !!center &&
    crabxx.target !== character.name &&
    simple_distance(crabxx, center) > CRABXX_OFF_CENTER_DISTANCE
  );
}

/**
 * @param {Object} crabxx - the boss
 * @returns {boolean} whether agitate may take it back from whoever holds it
 */
const isCrabxxStolen = (crabxx) =>
  isCrabxxOffCenter(crabxx) &&
  !knownTankers.includes(crabxx.target) &&
  character.s.coop?.id === crabxx.id;

/**
 * @param {Object} crabxx - the boss
 * @returns {boolean} whether agitate can drag it back to its spawn center
 */
const isCrabxxDraggedOff = (crabxx) =>
  isCrabxxStolen(crabxx) &&
  distance(character, crabxx) < G.skills["agitate"].range;

/** How far inside his range the ranger keeps every crab */
const CRABXX_RANGER_REACH_MARGIN = 25;

/** Crabx spawn onto players within this of the boss; past it they chase someone away */
const CRABX_SPAWN_RADIUS = 400;

/**
 * Where the ranger stands at crabxx: the spawn center while it reaches every
 * crab of the fight, else where he stands if that does, else their centroid.
 * @param {Object} [crabxx] - the boss
 * @returns {{x: number, y: number}|undefined} the spot to park on
 */
function getRangerCrabxxSpot(crabxx) {
  const center = getCrabxxCenter();
  const anchor = crabxx ?? center;
  if (!anchor) return undefined;

  const fight = [
    ...getCrabsForCrabxx().crabxList.filter(
      (crabx) => simple_distance(crabx, anchor) <= CRABX_SPAWN_RADIUS,
    ),
    crabxx,
  ].filter(Boolean);
  if (!fight.length) return center;

  const reach = character.range - CRABXX_RANGER_REACH_MARGIN;
  const covers = (spot) =>
    !!spot && fight.every((mob) => simple_distance(spot, mob) <= reach);
  const here = { x: character.real_x, y: character.real_y };

  if (covers(center)) return center;
  if (covers(here)) return here;
  return {
    x: fight.reduce((sum, mob) => sum + mob.real_x, 0) / fight.length,
    y: fight.reduce((sum, mob) => sum + mob.real_y, 0) / fight.length,
  };
}

/** @returns {Promise<object|undefined>} the outcome, while crabxx is live */
async function fightCrabxx() {
  if (!server.status.crabxx?.live) return;

  if (character.range > 100) rangeRate = 0.3;

  let { crabxxInstance, crabxList } = getCrabsForCrabxx();

  if (!crabxxInstance) {
    if (character.s.hopsickness) {
      await advanceSmartMove(server.status.crabxx);
    } else {
      await join("crabxx");
      await sleep(character.ping);
    }
    ({ crabxxInstance, crabxList } = getCrabsForCrabxx());

    if (!crabxxInstance) return travelling();
  }

  if (
    character.ctype === "warrior" &&
    (!crabxxInstance.s.stunned ||
      crabxxInstance.s.stunned.ms < character.ping / 2) &&
    crabxList.length <= 1
  ) {
    await warriorStomp();
  }

  const targetCrab = pickCrabxxTarget(crabxxInstance, crabxList);
  await holdCrabxxAggro(crabxxInstance, crabxList);

  changeToPullStrategies();
  return engage(targetCrab, { isPinned: true });
}

/**
 * @param {Object} crabxx - the boss
 * @param {Object[]} crabxList - its adds
 * @returns {Object|undefined} the boss once its shell is down, else the crabx to hit
 */
function pickCrabxxTarget(crabxx, crabxList) {
  if (!crabxx["1hp"]) return crabxx;

  const inRange = (entity) =>
    distance(entity, character) < character.range + character.xrange * 0.8;
  const hpOf = (entity) => entity?.predictedHp ?? entity?.hp ?? 0;

  let bestCrabx;
  let bestClusteredCrabx;

  for (const crabx of crabxList) {
    if (!bestCrabx) {
      bestCrabx = crabx;
    } else {
      const isCurrentCrabxInRange = inRange(crabx);
      const isBestCrabxInRange = inRange(bestCrabx);

      if (isCurrentCrabxInRange && !isBestCrabxInRange) {
        bestCrabx = crabx;
      } else if (
        isCurrentCrabxInRange === isBestCrabxInRange &&
        hpOf(crabx) > hpOf(bestCrabx)
      ) {
        bestCrabx = crabx;
      }
    }

    if (
      distance(crabx, crabxx) <= BLAST_RADIUS &&
      (!bestClusteredCrabx || hpOf(crabx) > hpOf(bestClusteredCrabx))
    ) {
      bestClusteredCrabx = crabx;
    }
  }

  if (character.ctype === "warrior") return bestClusteredCrabx || crabxx;
  return bestCrabx || (crabxx.target ? crabxx : undefined);
}

/**
 * The tanker fetches the boss home; newborn crabx on us are scared off, the
 * tanker agitating back whatever the scare shed.
 * @param {Object} crabxx - the boss
 * @param {Object[]} crabxList - its adds
 */
async function holdCrabxxAggro(crabxx, crabxList) {
  const isTanker = isAssignedAsTanker();
  const canAgitate =
    isTanker &&
    !is_on_cooldown("agitate") &&
    character.mp > G.skills["agitate"].mp + 500;

  const hasCrabxSpawnedByCrabxx = crabxList.some(
    (entity) => entity.s?.young && entity.target === character.name,
  );

  if (isTanker) await fetchCrabxx(crabxx);

  const promisesToAwait = [];
  if (hasCrabxSpawnedByCrabxx && (!isTanker || canAgitate))
    promisesToAwait.push(scareAwayMobs());

  if (canAgitate && (hasCrabxSpawnedByCrabxx || isCrabxxDraggedOff(crabxx)))
    promisesToAwait.push(use_skill("agitate"));

  await Promise.all(promisesToAwait);
}

/** @param {Object} crabxx - the boss to fetch or lead home */
async function fetchCrabxx(crabxx) {
  const center = getCrabxxCenter();
  if (!center) return;

  const agitateRange = G.skills["agitate"].range;

  if (
    isCrabxxOffCenter(crabxx) &&
    simple_distance(crabxx, center) <= CRABXX_FETCH_LEASH &&
    distance(character, crabxx) >= agitateRange
  ) {
    await advanceSmartMove(
      { map: character.map, x: crabxx.x, y: crabxx.y },
      {
        ...CRABXX_FETCH_MOVE_OPTIONS,
        stopWatcher: () => {
          const boss = get_entity(crabxx.id);
          return (
            !boss ||
            boss.target === character.name ||
            distance(character, boss) < agitateRange * CRABXX_AGITATE_SLACK
          );
        },
      },
    ).catch((e) => console.warn(e));
    return;
  }

  if (
    crabxx.target === character.name &&
    simple_distance(character, center) > CRABXX_RETURN_DISTANCE
  ) {
    await advanceSmartMove(center, {
      ...CRABXX_FETCH_MOVE_OPTIONS,
      stopWatcher: () =>
        get_entity(crabxx.id)?.target !== character.name ||
        simple_distance(character, center) <= CRABXX_RETURN_DISTANCE,
    }).catch((e) => console.warn(e));
  }
}

// --- Franky ---

/** @returns {Promise<object|undefined>} the outcome, while franky is live */
async function fightFranky() {
  if (!server.status.franky?.live) return;

  if (character.ctype === "warrior") changeToPullStrategies();
  else changeToNormalStrategies();

  let frankyInstance = get_nearest_monster({ type: "franky" });
  if (!frankyInstance) {
    await join("franky").catch((e) => console.warn(e));
    await sleep(character.ping);
    await advanceSmartMove(server.status.franky);
    frankyInstance = get_nearest_monster({ type: "franky" });
  }

  if (frankyInstance) {
    rangeRate = 0.2;
    await scareAwayMobs();
  }

  return engage(frankyInstance);
}

// --- Graveyard Rising ---

const GRAVEYARD_RISEN = ["ghoul", "zombie", "gargoyle"];

/** Kill order; mummies last */
const GRAVEYARD_TARGET_ORDER = [...GRAVEYARD_RISEN, "mummy"];

const GRAVEYARD_RADIUS = 400;

const GRAVEYARD_ARRIVAL_DISTANCE = 100;

const getGraveyardSpot = () =>
  getMonsterSpawns("mummy").find(({ map }) => map === "spookytown");

/** @param {Object} rising - server.status.graveyard */
function pickGraveyardTarget(rising) {
  const isInRound = (mob) =>
    !!mob &&
    !mob.dead &&
    character.map === rising.map &&
    simple_distance(mob, rising) <= GRAVEYARD_RADIUS;
  const current = get_targeted_monster();

  for (const type of GRAVEYARD_TARGET_ORDER) {
    if (current?.mtype === type && isInRound(current)) return current;

    const mob = get_nearest_monster({ type });
    if (isInRound(mob)) return mob;
  }
}

/** @returns {Object|undefined} a risen mob on one of ours, fought before a boss */
function getRisenOnAlly() {
  if (!server.status.graveyard?.live) return;

  const allies = getAlliedNames();
  const isOnAlly = (mob) =>
    !!mob &&
    !mob.dead &&
    GRAVEYARD_RISEN.includes(mob.mtype) &&
    allies.has(mob.target);

  const current = get_targeted_monster();
  if (isOnAlly(current)) return current;

  const rank = (mob) => GRAVEYARD_RISEN.indexOf(mob.mtype);
  return Object.values(parent.entities)
    .filter((mob) => mob.type === "monster" && isOnAlly(mob))
    .sort(
      (lhs, rhs) =>
        rank(lhs) - rank(rhs) ||
        distance(character, lhs) - distance(character, rhs),
    )[0];
}

const GARGOYLE_OUTRANKED_BY = ["icegolem", "franky"];

/** Graveyard fight once the Gargoyle wakes */
async function fightGargoyle() {
  if (!server.status.graveyard?.gargoyle) return;
  if (GARGOYLE_OUTRANKED_BY.some((name) => server.status[name]?.live)) return;

  return fightGraveyard();
}

async function fightGraveyard() {
  const rising = server.status.graveyard;
  if (!rising?.live) return;

  changeToPullStrategies();

  const target = pickGraveyardTarget(rising);
  if (target) return engage(target);

  if (character.map !== rising.map && !character.s.hopsickness) {
    await join("graveyard").catch((e) => console.warn(e));
    await sleep(character.ping);
  }

  const spot = getGraveyardSpot() ?? rising;
  if (distance(character, spot) > GRAVEYARD_ARRIVAL_DISTANCE)
    await advanceSmartMove(spot).catch((e) => console.warn(e));

  return travelling();
}

/**
 * @param {Object} boss
 * @param {Object} [route] - its BOSS_DRAG_ROUTES entry
 * @returns {Object|undefined} who holds it when the tanker should take it back:
 *   a stranger other than a leech on our bait, or with `takeBackFromParty` also
 *   a party member of ours
 */
function getBossThief(boss, route) {
  const holderName = boss?.target;
  if (
    !holderName ||
    holderName === character.name ||
    knownTankers.includes(holderName)
  )
    return;

  const isOurs = getMyCharacters().includes(holderName);
  if (isOurs && !(route?.takeBackFromParty && partyMems.includes(holderName)))
    return;

  const holder = get_player(holderName);
  if (isBossLeech(holder) && getBaitedBoss()?.id === boss.id) return;

  return holder ?? undefined;
}

/** @returns {{boss: Object, thief: Object}|undefined} a live dragged boss the tanker may take back */
function getStolenDragBoss() {
  if (!isAssignedAsTanker()) return;

  for (const bossType of Object.keys(BOSS_DRAG_ROUTES)) {
    if (!server.status[bossType]?.live) continue;

    const boss = get_nearest_monster({ type: bossType });
    const thief = boss && getBossThief(boss, BOSS_DRAG_ROUTES[bossType]);
    if (thief && isCoopFriendly(thief, boss)) return { boss, thief };
  }
}

/** @returns {Object|undefined} the thief of a dragged boss the priest can absorb back right now */
function getBossThiefToAbsorb() {
  if (character.mp < G.skills["absorb"].mp) return;

  const thief = getStolenDragBoss()?.thief;
  return thief && is_in_range(thief, "absorb") ? thief : undefined;
}

/** @returns {boolean} whether the warrior can agitate a stolen dragged boss back right now */
function shouldAgitateBossBack() {
  if (is_on_cooldown("agitate") || character.mp < G.skills["agitate"].mp)
    return false;

  const boss = getStolenDragBoss()?.boss;
  return !!boss && distance(character, boss) < G.skills["agitate"].range;
}

// --- Snowman ---

/** @returns {Promise<object|undefined>} the outcome, while snowman is live */
async function fightSnowman() {
  if (!server.status.snowman?.live) return;

  changeToPullStrategies();

  let snowmanInstance = get_nearest_monster({ type: "snowman" });

  if (!snowmanInstance) {
    await advanceSmartMove(server.status.snowman);
    snowmanInstance = get_nearest_monster({ type: "snowman" });
  }

  const currentTarget = get_target();
  const grinchInstance = get_nearest_monster({ type: "grinch" });
  const beeToAttack =
    currentTarget && currentTarget.mtype === "arcticbee"
      ? currentTarget
      : get_nearest_monster({ type: "arcticbee" });

  // The shielded snowman takes nothing, so its bees are the way in
  return engage(
    grinchInstance ??
      (snowmanInstance?.s?.fullguardx ? beeToAttack : snowmanInstance),
  );
}

// --- Witch's Cipher ---

const WITCH_GATHER_ARRIVAL_DISTANCE = 150;

/** How near the gathering spot a mob on one of ours is worth stopping for: the spawn area plus kiting room */
const WITCH_GATHER_DEFEND_DISTANCE = 400;

/** @returns {Object|undefined} near the gathering spot, the mob on one of ours; else the targeted or nearest gathering mob */
function getWitchGatherTarget({ mtype, spot }) {
  const isAlive = (mob) => !!mob && !mob.dead && mob.type === "monster";

  if (distance(character, spot) <= WITCH_GATHER_DEFEND_DISTANCE) {
    const allies = getAlliedNames();
    const onAlly = Object.values(parent.entities).find(
      (mob) => isAlive(mob) && allies.has(mob.target),
    );
    if (onAlly) return onAlly;
  }

  const current = get_targeted_monster();
  if (isAlive(current) && current.mtype === mtype) return current;

  return get_nearest_monster({ type: mtype });
}

/** @returns {Promise<object|undefined>} the outcome, while the Cipher is gathering */
async function useWitchGatheringStrategy() {
  if (get("cryptInstance") || (USE_CAVE_STRATEGY && isCaveUnderway())) return;

  const plan = getWitchGatherPlan();
  if (!plan) return;

  set(`witchBag:${character.name}`, countBagWitchIngredients());
  adaptStrategyToParty();

  const target = getWitchGatherTarget(plan);
  if (target) return engage(target);

  if (distance(character, plan.spot) > WITCH_GATHER_ARRIVAL_DISTANCE)
    await advanceSmartMove(plan.spot).catch((e) => console.warn(e));

  return travelling();
}

// --- Trick or Treat ---

async function useTrickOrTreatStrategy() {
  if (USE_CAVE_STRATEGY && isCaveUnderway()) return;
  if (await knockNextDoor()) return travelling();
}

// --- Anniversary ---

/** @returns {Promise<object|undefined>} travelling, while the anniversary visit owns the tick */
async function takeAnniversaryVisit() {
  if (await visitAnniversaryPlayer()) return travelling();
}

// --- A/B Testing ---

/** @returns {Promise<object|undefined>} the outcome, while abtesting is on */
async function fightAbtesting() {
  if (!server.status.abtesting || character.s.hopsickness) return;

  if (character.map !== "abtesting") {
    await join("abtesting").catch((e) => console.warn(e));
    return travelling();
  }

  changeToNormalStrategies();

  const pvpTarget = selectAbtestingTarget();
  if (pvpTarget) {
    abtestingLastSighting = {
      x: pvpTarget.real_x,
      y: pvpTarget.real_y,
      time: Date.now(),
    };
    return engage(pvpTarget);
  }

  await roamAbtesting();
  return travelling();
}

/** Kill-priority bonus by class: healers first, then the squishy damage dealers. */
const ABTESTING_ROLE_WEIGHT = {
  priest: 30,
  mage: 22,
  ranger: 20,
  rogue: 16,
  paladin: 12,
  warrior: 10,
  merchant: 5,
};

/** A loop around the central room, dipping into both corridor mouths. */
const ABTESTING_PATROL = [
  { x: -250, y: -150 },
  { x: 250, y: -150 },
  { x: 480, y: 0 },
  { x: 250, y: 150 },
  { x: -250, y: 150 },
  { x: -480, y: 0 },
];

const ABTESTING_SIGHTING_TTL = 20000;

/** @type {{x: number, y: number, time: number}|undefined} */
let abtestingLastSighting;
let abtestingPatrolIndex;

/** @returns {object[]} visible teammates, me included */
function getAbtestingAllies() {
  return [
    character,
    ...Object.values(parent.entities).filter(
      (entity) =>
        entity.type === "character" &&
        entity.team === character.team &&
        !entity.rip,
    ),
  ];
}

/** @returns {object[]} visible enemies that can take damage right now */
function getAbtestingEnemies() {
  return Object.values(parent.entities).filter(
    (entity) =>
      entity.type === "character" &&
      entity.team &&
      entity.team !== character.team &&
      !entity.rip &&
      entity.hp > 0 &&
      !entity.s?.invincible &&
      !entity.s?.stoned,
  );
}

/**
 * Scores every visible enemy on how fast the team can burst it, how much it
 * matters, whether allies already focus it and whether it is hurting one of us.
 * @returns {object|undefined} the enemy to hit
 */
function selectAbtestingTarget() {
  const enemies = getAbtestingEnemies();
  if (!enemies.length) return undefined;

  const allies = getAbtestingAllies();
  const currentTarget = get_target();

  let best;
  let bestScore = -Infinity;

  for (const enemy of enemies) {
    const teamDps = allies.reduce(
      (sum, ally) => sum + (calculateDamage(ally, enemy) || 0),
      0,
    );
    const secondsToKill = enemy.hp / Math.max(teamDps, 1);
    const focusCount = allies.filter(
      (ally) => ally !== character && ally.target === enemy.id,
    ).length;
    const victim = allies.find((ally) => ally.name === enemy.target);

    let score = ABTESTING_ROLE_WEIGHT[enemy.ctype] ?? 10;
    score += 40 * (1 - enemy.hp / enemy.max_hp);
    score += 30 / (1 + secondsToKill);
    score += 20 * Math.min(focusCount, 3);

    if (victim) {
      score += 20;
      if (victim.ctype === "priest") score += 15;
      if (victim.hp < 0.5 * victim.max_hp) score += 15;
    }

    if (currentTarget?.id === enemy.id) score += 15;

    score -= distance(character, enemy) / 20;
    if (!can_move_to(enemy.real_x, enemy.real_y)) score -= 25;

    if (score > bestScore) {
      bestScore = score;
      best = enemy;
    }
  }

  return best;
}

/**
 * Keeps moving with nothing in sight: toward a teammate's fight, then the last
 * enemy seen, then behind the tanker, else around the patrol loop.
 */
async function roamAbtesting() {
  if (isTripHeld()) return;

  const allies = getAbtestingAllies().filter((ally) => ally !== character);

  const allyInFight = allies
    .filter((ally) => ally.target && !parent.entities[ally.target])
    .sort((lhs, rhs) => distance(character, lhs) - distance(character, rhs))[0];
  if (allyInFight) {
    return moveInAbtesting(allyInFight.real_x, allyInFight.real_y);
  }

  if (
    abtestingLastSighting &&
    Date.now() - abtestingLastSighting.time < ABTESTING_SIGHTING_TTL
  ) {
    if (distance(character, abtestingLastSighting) > 50) {
      return moveInAbtesting(abtestingLastSighting.x, abtestingLastSighting.y);
    }
    abtestingLastSighting = undefined;
  }

  const tanker = allies.find((ally) => ally.name === TANKER);
  if (tanker && character.name !== TANKER) {
    if (distance(character, tanker) > 80) {
      await moveInAbtesting(tanker.real_x, tanker.real_y);
    }
    return;
  }

  if (abtestingPatrolIndex === undefined) {
    abtestingPatrolIndex = ABTESTING_PATROL.reduce(
      (nearest, point, index) =>
        distance(character, point) <
        distance(character, ABTESTING_PATROL[nearest])
          ? index
          : nearest,
      0,
    );
  }

  if (distance(character, ABTESTING_PATROL[abtestingPatrolIndex]) < 40) {
    abtestingPatrolIndex = (abtestingPatrolIndex + 1) % ABTESTING_PATROL.length;
  }

  const waypoint = ABTESTING_PATROL[abtestingPatrolIndex];
  return moveInAbtesting(waypoint.x, waypoint.y);
}

/**
 * Walks straight when the line is clear, otherwise paths around the walls,
 * dropping the walk the moment an enemy comes into sight.
 */
async function moveInAbtesting(x, y) {
  if (can_move_to(x, y)) return move(x, y);

  await advanceSmartMove(
    { map: "abtesting", x, y },
    {
      useScare: false,
      useBlink: false,
      useMagiport: false,
      useTown: false,
      stopWatcher: () => getAbtestingEnemies().length > 0,
    },
  ).catch((e) => console.warn(e));
}
