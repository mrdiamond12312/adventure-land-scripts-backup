// Daily events and world bosses — the fighter's highest priority strategy.

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

/**
 * Targets whatever live event outranks farming, walking there when it is out of
 * sight. A live event owns the tick even with nothing in reach: the field is
 * empty between waves, and going back to the farming spot loses the fight.
 * @returns {Promise<object|undefined>} the event outcome, if one owns this tick
 */
async function useEventStrategy() {
  if (
    (server.status.goobrawl ||
      get_nearest_monster({ type: "bgoo" }) ||
      get_nearest_monster({ type: "rgoo" })) &&
    !character.s["hopsickness"]
  ) {
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

  if (server.status.dragold?.live) {
    changeToPullStrategies();

    let dragoldInstance = get_nearest_monster({ type: "dragold" });
    if (!dragoldInstance) {
      await advanceSmartMove(server.status.dragold);
      dragoldInstance = get_nearest_monster({ type: "dragold" });
    }

    return engage(dragoldInstance);
  }

  const activeBosses = [];

  if (server.status.mrpumpkin?.live) {
    activeBosses.push({
      ...server.status.mrpumpkin,
      type: "mrpumpkin",
      strategy: changeToPullStrategies,
    });
  }

  if (server.status.mrgreen?.live) {
    activeBosses.push({
      ...server.status.mrgreen,
      type: "mrgreen",
      strategy: changeToPullStrategies,
    });
  }

  if (server.status.icegolem?.live) {
    activeBosses.push({
      ...server.status.icegolem,
      type: "icegolem",
      strategy: changeToNormalStrategies,
    });
  }

  if (activeBosses.length) {
    const bossToFight = activeBosses
      .sort(
        (lhs, rhs) =>
          lhs.hp / parent.G.monsters[lhs.type].hp -
          rhs.hp / parent.G.monsters[rhs.type].hp,
      )
      .shift();

    if (bossToFight) {
      bossToFight.strategy();

      const minion = getBossMinion(bossToFight.type);
      if (minion) return engage(minion);

      let bossInstance = get_nearest_monster({ type: bossToFight.type });
      if (!bossInstance) {
        await advanceSmartMove(bossToFight);
        bossInstance = get_nearest_monster({ type: bossToFight.type });
      }

      return engage(bossInstance);
    }
  }

  if (server.status.crabxx?.live) {
    if (character.range > 100) rangeRate = 0.3;

    const inRange = (entity) =>
      distance(entity, character) < character.range + character.xrange * 0.8;

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

    let bestCrabx;
    let bestClusteredCrabx;

    for (const crabx of crabxList) {
      const isCurrentCrabxInRange = inRange(crabx);
      const currentCrabxHp = crabx.predictedHp ?? crabx.hp ?? 0;
      const bestCrabxHp = bestCrabx?.predictedHp ?? bestCrabx?.hp ?? 0;

      if (!bestCrabx) {
        bestCrabx = crabx;
      } else {
        const isBestCrabxInRange = inRange(bestCrabx);

        if (isCurrentCrabxInRange && !isBestCrabxInRange) {
          bestCrabx = crabx;
        } else if (isCurrentCrabxInRange === isBestCrabxInRange) {
          if (currentCrabxHp > bestCrabxHp) {
            bestCrabx = crabx;
          }
        }
      }

      if (distance(crabx, crabxxInstance) <= BLAST_RADIUS) {
        const bestClusteredCrabxHp =
          bestClusteredCrabx?.predictedHp ?? bestClusteredCrabx?.hp ?? 0;
        if (!bestClusteredCrabx || currentCrabxHp > bestClusteredCrabxHp) {
          bestClusteredCrabx = crabx;
        }
      }
    }

    if (
      character.ctype === "warrior" &&
      (!crabxxInstance.s.stunned ||
        crabxxInstance.s.stunned.ms < character.ping / 2) &&
      crabxList.length <= 1
    ) {
      await warriorStomp();
    }

    let targetCrab;

    // The shell ("1hp") is what decides the target, not whether crabx happen to
    // be standing around: while it is up every hit on the boss lands for 1, and
    // the moment it drops the boss is worth more than any crabx.
    if (!crabxxInstance["1hp"]) {
      targetCrab = crabxxInstance;
    } else if (character.ctype === "warrior") {
      targetCrab = bestClusteredCrabx || crabxxInstance;
    } else {
      targetCrab =
        bestCrabx || (crabxxInstance?.target ? crabxxInstance : undefined);
    }

    const isTanker = isAssignedAsTanker();
    const canAgitate =
      isTanker &&
      !is_on_cooldown("agitate") &&
      character.mp > G.skills["agitate"].mp + 500;

    const hasCrabxSpawnedByCrabxx = crabxList.some(
      (entity) => entity.s?.young && entity.target === character.name,
    );

    // A ready cleave aggros every untargeted crabx it hits, sparing agitate's mp
    const agitateGain = crabxList.filter(
      (crabx) =>
        crabx.target !== character.name && is_in_range(crabx, "agitate"),
    );
    const cleaveCoversGain =
      agitateGain.length > 0 &&
      agitateGain.every(
        (crabx) =>
          !crabx.target &&
          distance(character, crabx) <
            G.skills["cleave"].range + character.xrange,
      ) &&
      ms_to_next_skill("cleave") < character.ping &&
      character.mp > 1720;

    if (isTanker) await fetchCrabxx(crabxxInstance);

    const promisesToAwait = [];
    if (hasCrabxSpawnedByCrabxx && (!isTanker || canAgitate))
      promisesToAwait.push(scareAwayMobs());

    if (
      canAgitate &&
      ((hasCrabxSpawnedByCrabxx && !cleaveCoversGain) ||
        isCrabxxDraggedOff(crabxxInstance))
    )
      promisesToAwait.push(use_skill("agitate"));

    await Promise.all(promisesToAwait);

    changeToPullStrategies();
    return engage(targetCrab);
  }

  if (server.status.franky?.live) {
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

  if (server.status.pinkgoo?.live) {
    changeToPullStrategies();

    let pinkgooInstance = get_nearest_monster({ type: "pinkgoo" });
    if (!pinkgooInstance && server.status.pinkgoo?.x) {
      await advanceSmartMove(server.status.pinkgoo);
      pinkgooInstance = get_nearest_monster({ type: "pinkgoo" });
    }

    return engage(pinkgooInstance);
  }

  if (server.status.snowman?.live) {
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

  if (server.status.abtesting && !character.s.hopsickness) {
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

  if (server.status.wabbit?.live) {
    changeToPullStrategies();
    if (character.range < 100) rangeRate = 0.1;
    else rangeRate = 0.4;

    let wabbitInstance = get_nearest_monster({ type: "wabbit" });
    if (!wabbitInstance && server.status.wabbit?.x) {
      await advanceSmartMove(server.status.wabbit);
      wabbitInstance = get_nearest_monster({ type: "wabbit" });
    }

    return engage(wabbitInstance);
  }

  // Last: every live boss above outranks the kiss
  if (await visitAnniversaryPlayer()) return travelling();

  return undefined;
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

  return minionTypes
    .map((type) => get_nearest_monster({ type }))
    .find(Boolean);
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
