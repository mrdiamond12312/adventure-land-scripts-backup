// Daily events and world bosses — the fighter's highest priority strategy.

/** Event fights in priority order; each claims the tick only while its event is on. */
const EVENT_FIGHTS = [
  fightGoobrawl,
  () => fightSimpleBoss(["dragold", "mrpumpkin", "mrgreen", "icegolem"]),
  fightCrabxx,
  fightFranky,
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
  dragold: {},
  mrpumpkin: {},
  mrgreen: {},
  icegolem: { usePull: false },
  pinkgoo: {},
  wabbit: { rangeRate: () => (character.range < 100 ? 0.1 : 0.4) },
};

/**
 * Minions first, then the boss, walking to its last known spot when out of sight.
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

  const { usePull = true, rangeRate: bossRangeRate } =
    SIMPLE_BOSSES[bossToFight.type];
  if (usePull) changeToPullStrategies();
  else changeToNormalStrategies();
  if (bossRangeRate) rangeRate = bossRangeRate();

  const minion = getBossMinion(bossToFight.type);
  if (minion) return engage(minion);

  let bossInstance = get_nearest_monster({ type: bossToFight.type });
  if (!bossInstance && bossToFight.x !== undefined) {
    await advanceSmartMove(bossToFight);
    bossInstance = get_nearest_monster({ type: bossToFight.type });
  }

  return engage(bossInstance);
}

/**
 * A visible add from the boss's `G.monsters[].spawns`, sticking with the one already targeted.
 * @param {string} bossType
 * @returns {object|undefined}
 */
function getBossMinion(bossType) {
  const minionTypes = (parent.G.monsters[bossType].spawns ?? []).map(
    ([, type]) => type,
  );
  if (!minionTypes.length) return undefined;

  const current = get_targeted_monster();
  if (minionTypes.includes(current?.mtype)) return current;

  return minionTypes.map((type) => get_nearest_monster({ type })).find(Boolean);
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
  return engage(targetCrab);
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

/**
 * @param {Object} franky - the boss
 * @returns {Object|undefined} the stranger holding it, when the tanker should take it back
 */
function getFrankyThief(franky) {
  const holderName = franky?.target;
  if (
    !holderName ||
    getMyCharacters().includes(holderName) ||
    knownTankers.includes(holderName)
  )
    return;
  return get_player(holderName) ?? undefined;
}

/**
 * @param {Object} holder - the player holding franky
 * @param {Object} franky - the boss
 * @returns {boolean} whether absorb treats the holder as friendly, at its normal cost
 */
const isAbsorbFriendly = (holder, franky) =>
  parent.party_list.includes(holder.name) ||
  (character.s.coop?.id === franky.id && holder.s?.coop?.id === franky.id);

/** @returns {Object|undefined} the franky thief the tanker can absorb back right now */
function getFrankyThiefToAbsorb() {
  if (
    !server.status.franky?.live ||
    !isAssignedAsTanker() ||
    character.mp < G.skills["absorb"].mp
  )
    return;

  const franky = get_nearest_monster({ type: "franky" });
  const thief = franky && getFrankyThief(franky);
  return thief &&
    isAbsorbFriendly(thief, franky) &&
    is_in_range(thief, "absorb")
    ? thief
    : undefined;
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
