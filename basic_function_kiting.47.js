// basic_function part: getTarget, boss drags, and the kite/orbit movement of hitAndRun

//  run and hit
const movementHistory = [];
var flipRotation = 1;
var flipRotationCooldown = 0;
var angle; // Your desired angle from the monster, in radians
var flipCooldown = 0;
var stuckThreshold = 2;

function getMonstersOnDeclares() {
  // if (character.name === partyMems[0]) arrayShuffle(mobsToFarm);
  for (const monster of PRIORITY_MOB_IDS) {
    if (get_nearest_monster({ type: monster })) {
      return get_nearest_monster({ type: monster });
    }
  }

  const luringMobType = get("luringMobType");

  for (const monster of mobsToFarm) {
    if (monster === luringMobType) continue;
    if (get_nearest_monster({ type: monster })) {
      return get_nearest_monster({ type: monster });
    }
  }
}

function isMelee() {
  return character.range < 75;
}

/**
 * @param {Object} [mob]
 * @returns {boolean}
 */
function isInMerchantDrag(mob) {
  return (
    !!mob?.target &&
    mob.mtype === get("luringMobType") &&
    get_player(mob.target)?.ctype === "merchant"
  );
}

function getTarget() {
  const leader = get_entity(TANKER) ?? get_entity(partyMems[0]);
  const declared = getMonstersOnDeclares();
  const party = getAlliedNames();

  let target =
    declared && declared.cooperative ? declared : get_targeted_monster();
  if (target && (!get_entity(target.id) || isInMerchantDrag(target)))
    target = undefined;

  if (!target) {
    const isLeader = character.name === (leader?.name ?? partyMems[0]);

    if (isLeader) {
      target = declared ?? undefined;

      const mobsHittingParty = Object.values(parent.entities)
        .filter(
          (entity) =>
            entity.type === "monster" &&
            !isCaveFriendly(entity) &&
            entity.target &&
            party.has(entity.target) &&
            entity.target !== character.name &&
            !isInMerchantDrag(entity) &&
            (!isMelee() || !MELEE_IGNORE_LIST.includes(entity.mtype)),
        )
        .sort(
          (lhs, rhs) => distance(rhs, character) - distance(lhs, character),
        );
      if (
        mobsHittingParty.length &&
        (!target || target.target === character.name || !target.cooperative)
      ) {
        target = mobsHittingParty[0];
      }
    } else {
      const declaredMob = declared;
      const aggroed = Object.values(parent.entities)
        .filter(
          (entity) =>
            entity.type === "monster" &&
            !isCaveFriendly(entity) &&
            entity.target &&
            party.has(entity.target) &&
            !isInMerchantDrag(entity) &&
            distance(entity, character) < character.range + character.xrange,
        )
        .sort(
          (lhs, rhs) => distance(rhs, character) - distance(lhs, character),
        );

      if (leader) {
        let leaderTarget =
          get_target_of(leader) ?? get_nearest_monster({ target: leader.name });
        if (
          leaderTarget &&
          (party.has(leaderTarget.name) || isInMerchantDrag(leaderTarget))
        )
          leaderTarget = undefined;

        target =
          leaderTarget ??
          aggroed[0] ??
          (declaredMob && declaredMob.attack < 200 ? declaredMob : undefined);
      } else {
        target = aggroed[0] ?? declaredMob;
      }
    }

    if (target) {
      change_target(target);
      return target;
    }

    set_message("No Monsters");

    if (
      !character.moving &&
      character.map !== "crypt" &&
      leader &&
      !smart.moving &&
      !isAdvanceSmartMoving &&
      character.cc < 125
    ) {
      const dist = distance(character, leader);
      if (dist > spacial) {
        const midX = character.x + (leader.x - character.x) / 2;
        const midY = character.y + (leader.y - character.y) / 2;
        if (can_move_to(midX, midY)) move(midX, midY);
      }
    }

    return;
  }

  return target;
}

async function leaveJail() {
  if (character.map === "jail" && !smart.moving && !isAdvanceSmartMoving) {
    log("Jail escape plan!");
    return smart_move(find_npc("jailer")).then(() => {
      parent.socket.emit("leave");
    });
  }
}

var lastKitingTargetId = undefined;

/**
 * Bosses the tank drags to a spot
 * @type {Object<string, {spot: Object, mtypes: string[], releaseAtSpot?: boolean, takeBackFromParty?: boolean, dragWhileLive?: string}>}
 */
const BOSS_DRAG_ROUTES = {
  franky: {
    spot: { map: "level2w", x: 11, y: 8 },
    mtypes: ["franky", "nerfedmummy"],
    takeBackFromParty: true,
  },
  // Mr. Pumpkin's spot
  horseman: {
    spot: { map: "halloween", x: -243, y: 680 },
    mtypes: ["horseman", "jackowalker"],
    dragWhileLive: "mrpumpkin",
  },
  // Between the xscorpion and minimush spawns
  mrpumpkin: {
    spot: { map: "halloween", x: -243, y: 680 },
    mtypes: ["mrpumpkin", "jr"],
  },
  // The mummy spawn
  mrgreen: {
    spot: { map: "spookytown", x: 255, y: -1432 },
    mtypes: ["mrgreen", "greenjr"],
    releaseAtSpot: true,
  },
};

/** How close to its spot a dragged boss counts as arrived */
const DRAG_ARRIVAL_DISTANCE = 75;

/** Ids of dragged bosses that reached their spot; arrival sticks once seen */
const arrivedDragBossIds = new Set();

/**
 * @param {[string, Object]} [dragRoute] - from getBossDragRoute
 * @returns {boolean} whether its boss reached the spot and the drag let go of it
 */
function isDragReleased(dragRoute) {
  const [bossType, route] = dragRoute ?? [];
  if (!route?.releaseAtSpot) return false;

  const boss = get_nearest_monster({ type: bossType });
  if (!boss) return false;
  if (distance(boss, route.spot) <= DRAG_ARRIVAL_DISTANCE)
    arrivedDragBossIds.add(boss.id);
  return arrivedDragBossIds.has(boss.id);
}

function isDragWanted(route) {
  return !route.dragWhileLive || !!server.status[route.dragWhileLive]?.live;
}

/** @returns {Object|undefined} a dragged boss in view held by one of our allies, not us */
function getDragBossOnAlly() {
  const allies = getAlliedNames();
  for (const bossType of Object.keys(BOSS_DRAG_ROUTES)) {
    const boss = get_nearest_monster({ type: bossType });
    if (boss && boss.target !== character.name && allies.has(boss.target))
      return boss;
  }
}

function withFixedSpot(target, spot) {
  return {
    ...target,
    x: spot.x,
    y: spot.y,
    real_x: spot.x,
    real_y: spot.y,
    going_x: spot.x,
    going_y: spot.y,
  };
}

/** A kite target hitAndRun stands on instead of orbiting */
function withParkSpot(target, spot) {
  return { ...withFixedSpot(target, spot), isParkSpot: true };
}

/** Steps onto the spot, along the taut path if a wall is in the way */
function parkAt(spot) {
  const step = can_move_to(spot.x, spot.y) ? spot : getTautStep(spot) ?? spot;
  moveTowardDestination(step);
}

/**
 * @param {Object} target
 * @returns {[string, Object]|undefined} the boss type and drag route this target belongs to
 */
function getBossDragRoute(target) {
  if (target?.type !== "monster") return undefined;
  return Object.entries(BOSS_DRAG_ROUTES).find(([, route]) =>
    route.mtypes.includes(target.mtype),
  );
}

/** @returns {boolean} whether a living known tanker is in sight */
function isKnownTankerAround() {
  return knownTankers.some((name) => {
    const player = get_player(name);
    return !!player && !player.rip;
  });
}

/** How far the dragged boss may trail before the drag stops for it */
const DRAG_LEASH = 200;

/** How close a trailing boss must come before the drag walks on */
const DRAG_CLOSE = 80;

/** Set while the drag waits for its boss to catch up */
let isDragWaiting = false;

/**
 * Walks to the spot fighting on the way, so whatever is on us follows. Stops
 * once the boss trails past DRAG_LEASH and kites at it until it is back within
 * DRAG_CLOSE, which also wins back a boss that lost interest.
 * @param {Object} target - the kite target
 * @param {Object} spot - where to drag it
 * @param {Object} [boss] - the dragged boss
 * @returns {Promise<Object>} the target anchored at the spot, or at the boss while waiting
 */
async function dragToSpot(target, spot, boss) {
  if (distance(spot, character) <= 100) return withFixedSpot(target, spot);

  const isTrailing = () => !!boss && distance(character, boss) > DRAG_LEASH;
  if (isTrailing()) isDragWaiting = true;
  else if (!boss || distance(character, boss) <= DRAG_CLOSE)
    isDragWaiting = false;

  if (!isDragWaiting) {
    smartmoveDebug = true;
    try {
      await advanceSmartMove(spot, {
        speed: 1000,
        useTown: false,
        useScare: false,
        useMagiport: false,
        useBlink: false,
        useTautPath: true,
        smartmoveDebug: true,
        stopWatcher: isTrailing,
      }).catch((e) => console.warn(e));
    } finally {
      smartmoveDebug = false;
    }
    if (isTrailing()) isDragWaiting = true;
  }

  return withFixedSpot(target, isDragWaiting ? boss : spot);
}

// Per-mtype overrides: some mobs get kited around a fixed spot instead of their own
// (moving) position — a BOSS_DRAG_ROUTES spot, or the boss or its spawn center for CRABXX.
async function resolveKiteTarget(target) {
  const kaneSpot = typeof getKaneParkSpot === "function" && getKaneParkSpot();
  if (kaneSpot) return withParkSpot(target, kaneSpot);

  const dragRoute = isAssignedAsTanker() && getBossDragRoute(target);
  if (dragRoute && !isDragReleased(dragRoute)) {
    const [bossType, route] = dragRoute;
    const boss = get_nearest_monster({ type: bossType });

    // Take a stolen boss back: the priest absorbs the thief, the warrior agitates
    // at the boss; either hits the boss first so the take-back is friendly
    const thief =
      ["priest", "warrior"].includes(character.ctype) &&
      getBossThief(boss, route);
    if (thief) {
      const isAbsorbReady =
        character.ctype === "priest" && isCoopFriendly(thief, boss);
      return withFixedSpot(target, isAbsorbReady ? thief : boss);
    }

    const isBaited = !!boss && getBaitedBoss()?.id === boss.id;
    if (
      partyMems.includes(PRIEST) &&
      !isKnownTankerAround() &&
      !isBaited &&
      isDragWanted(route)
    )
      return dragToSpot(target, route.spot, boss);
  }

  if (character.ctype !== "merchant" && isCrabxxMob(target)) {
    const boss = get_nearest_monster({ type: "crabxx" });
    const center = getMonsterSpawns("crabxx")[0];
    if (isAssignedAsTanker())
      return withFixedSpot(
        target,
        boss && isCrabxxOffCenter(boss) ? boss : center,
      );
    if (character.ctype === "ranger")
      return boss?.target === character.name
        ? withFixedSpot(target, boss)
        : withParkSpot(target, getRangerCrabxxSpot(boss) ?? center);
  }

  return target;
}

const HOLD_POSITION_CLASSES = ["warrior", "rogue"];

/** Hold still facing the target while nothing aggros us and no ally can stack */
function shouldHoldMeleePosition(target, radiusTotal) {
  if (!HOLD_POSITION_CLASSES.includes(character.ctype)) return false;

  const dist = distance(character, target);
  if (dist <= character.range * 0.35 || dist >= radiusTotal) return false;

  const allEntities = Object.values(parent.entities);
  const noAggro = allEntities
    .filter((entity) => entity.type === "monster")
    .every((mob) => mob.target !== character.name || mob["1hp"]);
  const noStackRisk = allEntities
    .filter((entity) => entity.type === "character")
    .every((char) => !canStackWith(char));

  return noAggro && noStackRisk;
}

// Combo hits splash onto related players (party/team/account/coop, or anyone in
// PvP) sharing the victim's 6x6px grid cell. Box instead of raw cell hash so we
// don't sit on a boundary.
const STACK_CELL = 6;
function canStackWith(other) {
  if (other.id === character.id || other.rip || other.hp <= 0) return false;
  if (Math.abs(character.real_x - other.real_x) >= STACK_CELL) return false;
  if (Math.abs(character.real_y - other.real_y) >= STACK_CELL) return false;

  // PvP zone: relation is ignored, any overlapping player can stack.
  if (typeof is_pvp === "function" && is_pvp()) return true;

  return (
    (other.owner && other.owner === character.owner) ||
    (other.team && other.team === character.team) ||
    other.cooperative ||
    prioritizedNames().includes(other.name)
  );
}

function faceTarget(target) {
  const dx = character.real_x - target.real_x;
  const dy = character.real_y - target.real_y;
  angle = Math.atan2(dy, dx);
}

// Resets/initializes the kiting angle when the target changed (or on first tick).
function updateKitingAngle(target) {
  const lastTarget = parent.entities[lastKitingTargetId];
  const targetChanged =
    !lastTarget ||
    lastKitingTargetId !== target.id ||
    distance(lastTarget, target) > 30;
  if (targetChanged) angle = undefined;

  lastKitingTargetId = target.id;

  if (!angle) faceTarget(target);
}

// Flips the orbit direction if we haven't actually moved much over the last
// few ticks (e.g. wedged against a wall) — nudges the angle by 90° to break out.
function trackStuckMovement() {
  movementHistory.push({ x: character.real_x, y: character.real_y });
  if (movementHistory.length > 5) movementHistory.shift();

  let totalMovement = 0;
  for (let i = 1; i < movementHistory.length; i++) {
    const dx = movementHistory[i].x - movementHistory[i - 1].x;
    const dy = movementHistory[i].y - movementHistory[i - 1].y;
    totalMovement += Math.sqrt(dx * dx + dy * dy);
  }

  const averageMovement = totalMovement / movementHistory.length;
  if (averageMovement < stuckThreshold && flipRotationCooldown <= 0) {
    flipRotation *= -1;
    flipRotationCooldown = 4;
    angle += (flipRotation * Math.PI) / 2; // turn 90°
  }
}

// Tanker holding a farmed mob near the default spot orbits the spot itself rather
// than the (moving) mob; far from the spot, it instead walks the mob home, with a
// lead distance that widens the faster the mob outpaces the tanker's own speed.
function getFarmMobOrbit(target) {
  const isTankerHoldingFarmMob =
    (isAssignedAsTanker() ||
      (character.ctype === "warrior" &&
        !!warriorHeldMobs?.includes(target.mtype))) &&
    target.type === "monster" &&
    target.target === character.name &&
    mobsToFarm.includes(target.mtype);
  const isNearDefaultSpot =
    (isTankerHoldingFarmMob ||
      (isAssignedAsTanker() &&
        character.ctype === "priest" &&
        character.map === map)) &&
    distance(target, { x: mapX, y: mapY }) <=
      character.range + character.xrange;
  const orbitCenter = isNearDefaultSpot ? { x: mapX, y: mapY } : target;
  const speedRate =
    isTankerHoldingFarmMob && !isNearDefaultSpot
      ? Math.max(
          1,
          (target.charge ?? target.speed ?? character.speed) / character.speed,
        )
      : 1;

  return { isTankerHoldingFarmMob, isNearDefaultSpot, orbitCenter, speedRate };
}

function getOrbitDestination(target, orbit, radiusTotal, cosA, sinA) {
  if (orbit.isTankerHoldingFarmMob && !orbit.isNearDefaultSpot) {
    const holdRadius = radiusTotal * orbit.speedRate;
    return { x: target.x + holdRadius * cosA, y: target.y + holdRadius * sinA };
  }
  return {
    x: orbit.orbitCenter.x + radiusTotal * cosA,
    y: orbit.orbitCenter.y + radiusTotal * sinA,
  };
}

// Subtle orbit shift applied every ~10 ticks while right on top of the target,
// so the kite doesn't settle into a perfectly static holding pattern.
function applyMicroRotation(target, rangeRateFn) {
  if (flipCooldown > 9) {
    const closeToTarget =
      distance(character, target) <=
      (character.range + character.xrange) * 0.1 * rangeRateFn;

    if (closeToTarget) angle += (flipRotation * Math.PI) / 16;

    flipCooldown = 0;
  }

  flipCooldown++;
  flipRotationCooldown--;
}

/** Least time between two smart moves the kite falls back to around a wall */
const KITE_WALL_SMART_MOVE_COOLDOWN_MS = 3000;
var lastKiteWallSmartMoveAt = 0;

/**
 * Smart-moves to a point the taut planner could not reach, as a kite step
 * rather than a trip.
 * @param {{x: number, y: number}} position
 * @param {Object} options - advanceSmartMove options on top of the kite's own
 */
async function smartMoveAroundWall(position, options = {}) {
  if (Date.now() - lastKiteWallSmartMoveAt < KITE_WALL_SMART_MOVE_COOLDOWN_MS)
    return;
  lastKiteWallSmartMoveAt = Date.now();

  smartmoveDebug = true;
  try {
    await advanceSmartMove(
      { x: position.x, y: position.y, map: character.map },
      {
        speed: 200,
        useTown: false,
        // A run refuses magiport both ways
        useMagiport: !character.cave,
        useTautPath: true,
        smartmoveDebug: true,
        ...options,
      },
    );
  } finally {
    smartmoveDebug = false;
  }
}

// Returns the actual point to move to: the desired orbit spot if reachable, an
// alternative point swept around the same radius if not, else the next corner
// of the taut path toward the spot (flagged isDetour). Null after falling back
// to a smart move, or when nothing is reachable.
async function resolveDestination(desired, orbit, radiusTotal, target) {
  if (can_move_to(desired.x, desired.y)) return desired;

  if (!orbit.isTankerHoldingFarmMob) {
    if (flipRotationCooldown < 0) {
      flipRotation *= -1;
      flipRotationCooldown = 6;
    }
    for (let i = 1; i <= 48; i++) {
      const adjustedAngle = angle + (flipRotation * Math.PI) / (48 / i);
      const alt = {
        x: orbit.orbitCenter.x + radiusTotal * Math.cos(adjustedAngle),
        y: orbit.orbitCenter.y + radiusTotal * Math.sin(adjustedAngle),
      };
      if (can_move_to(alt.x, alt.y)) {
        angle = adjustedAngle;
        return alt;
      }
    }
  }

  const detour = getTautStep(desired) ?? getTautStep(target);
  if (detour) return { x: detour.x, y: detour.y, isDetour: true };

  if (orbit.isTankerHoldingFarmMob) {
    await smartMoveAroundWall(desired, { useScare: false });
    return null;
  }

  // The cave strategy owns movement while gathering at Dorr
  const isOutOfReach =
    target.type === "monster" &&
    distance(target, character) > character.range + character.xrange * 0.9;
  if (isOutOfReach && !isPreparingCave) {
    await smartMoveAroundWall(target, {
      useScare: ![TANKER, PRIEST].includes(character.name),
    });
  }
  return null;
}

// Steps toward the destination (clamped to one loop's worth of travel) and returns
// the point actually moved to, or null if already close enough to skip the move().
function moveTowardDestination(destination) {
  const maxStep = (character.speed * 500) / 1000;
  const dx = destination.x - character.real_x;
  const dy = destination.y - character.real_y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 3) return null;

  let { x, y } = destination;
  if (dist > maxStep) {
    const scale = maxStep / dist;
    x = character.real_x + dx * scale;
    y = character.real_y + dy * scale;
  }

  move(x, y);
  return { x, y };
}

// Advances the orbit angle for next tick — walks straight home while far with a
// farmed mob in tow, otherwise keeps sweeping around the orbit center as usual.
function advanceOrbitAngle(target, orbit, radiusTotal, loopInterval) {
  if (orbit.isTankerHoldingFarmMob && !orbit.isNearDefaultSpot) {
    angle = Math.atan2(mapY - target.y, mapX - target.x);
    return;
  }

  const rotationStep =
    flipRotation *
    Math.asin((character.speed * loopInterval) / 1000 / 2 / radiusTotal) *
    2;
  angle += rotationStep;
}

async function hitAndRun(target = get_target(), rangeRateFn = rangeRate) {
  const loopInterval = Math.max(200, getLoopInterval());
  const radiusTotal = character.range * rangeRateFn + character.xrange * 0.5;
  let nextDelay = loopInterval;

  if (character.cc >= 125) return setTimeout(hitAndRun, loopInterval);

  // Merchant gonna do the moveAround while taking part in events
  const isMerchantIdle =
    isMerchant() &&
    !(typeof shouldMerchantKite === "function" && shouldMerchantKite());

  if (isMerchantIdle || !target || smart.moving || isAdvanceSmartMoving) {
    angle = undefined;
    lastKitingTargetId = undefined;
    return setTimeout(hitAndRun, loopInterval);
  }

  try {
    target = await resolveKiteTarget(target);

    if (target.isParkSpot) {
      angle = undefined;
      parkAt(target);
      return;
    }

    if (shouldHoldMeleePosition(target, radiusTotal)) {
      faceTarget(target);
      return;
    }

    updateKitingAngle(target);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    trackStuckMovement(); // may perturb `angle`, but cosA/sinA above stay from before the flip

    const orbit = getFarmMobOrbit(target);
    const desired = getOrbitDestination(target, orbit, radiusTotal, cosA, sinA);
    applyMicroRotation(target, rangeRateFn);

    const destination = await resolveDestination(
      desired,
      orbit,
      radiusTotal,
      target,
    );
    if (!destination) return;

    const moved = moveTowardDestination(destination);
    if (!moved) return;

    if (!destination.isDetour)
      advanceOrbitAngle(target, orbit, radiusTotal, loopInterval);
    nextDelay = Math.max(
      (distance(character, moved) / character.speed) * 1000,
      200,
    );
  } catch (e) {
    console.error(e);
    angle = undefined;
    lastKitingTargetId = undefined;
  } finally {
    setTimeout(hitAndRun, nextDelay);
  }
}
