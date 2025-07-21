// Load basic functions from other code snippet

if (parent.caracAL) {
  parent.caracAL
    .load_scripts([
      "adventure-land-scripts-backup/basic_function.7.js",
      "adventure-land-scripts-backup/other_class_msg_listener.8.js",
    ])
    .then(() => {
      mainLoop();
    });
} else {
  load_code(7);
  load_code(8);
}

// Kiting
var originRangeRate = 0.85;
rangeRate = originRangeRate;
const loopInterval = Math.floor(((1 / character.frequency) * 1000) / 4);

async function fight(target) {
  if (currentStrategy === usePullStrategies) {
    aggroedMobs = Object.values(parent.entities).filter((mob) => {
      return (
        !haveFormidableMonsterAroundTarget(mob) &&
        distance(mob, character) <
          character.range +
            character.xrange * 0.4 +
            extraDistanceWithinHitbox(mob) +
            extraDistanceWithinHitbox(character) &&
        mob.target &&
        mob.type === "monster"
      );
    });

    if (aggroedMobs.length) {
      target =
        aggroedMobs
          .sort((lhs, rhs) => {
            const lhsNumberOfSurrounding = numberOfMonsterAroundTarget(
              lhs,
              character.blast / 3.6 || BLAST_RADIUS,
            );
            const rhsNumberOfSurrounding = numberOfMonsterAroundTarget(
              rhs,
              character.blast / 3.6 || BLAST_RADIUS,
            );
            if (lhsNumberOfSurrounding === rhsNumberOfSurrounding)
              return rhs.hp - lhs.hp;
            return rhsNumberOfSurrounding - lhsNumberOfSurrounding;
          })
          .shift() ?? target;
      change_target(target);
    }
  }

  if (!target) return;

  if (!is_on_cooldown("energize")) {
    const buffee = getLowestMana();
    if (
      buffee.max_mp - buffee.mp > 500 &&
      buffee.mp < buffee.max_mp * 0.65 &&
      character.mp > character.max_mp * 0.75 &&
      is_in_range(buffee, "energize")
    ) {
      log("Energize " + buffee?.name);
      use_skill("energize", buffee).then(() =>
        reduce_cooldown("energize", character.ping * 0.95),
      );
    } else if (ms_to_next_skill("attack") < 10 && !character.s.penalty_cd) {
      use_skill("energize", character).then(() =>
        reduce_cooldown("energize", character.ping * 0.95),
      );
    }
  }

  if (
    ms_to_next_skill("attack") === 0 &&
    distance(target, character) <
      character.range +
        character.xrange +
        extraDistanceWithinHitbox(target) +
        extraDistanceWithinHitbox(character) &&
    shouldAttack()
  ) {
    currentStrategy(target);
    set_message("Attacking");
    attack(target).then(() =>
      reduce_cooldown("attack", Math.min(...parent.pings)),
    );
    reduce_cooldown("attack", ((-1 / character.frequency) * 1000) / 2);
  }

  if (
    target["damage_type"] === "magical" &&
    !is_on_cooldown("reflection") &&
    partyMems.includes(target.target) &&
    character.mp > 1000
  ) {
    use_skill("reflection", get_entity(target.target));
  }

  // if (character.mp > 2000 && !is_on_cooldown("alchemy") && !isInvFull()) {
  //   const sellableSlot = character.items.findIndex((item) =>
  //     SALE_ABLE.includes(item?.name)
  //   );

  //   if (sellableSlot !== -1) {
  //     if (sellableSlot === 0 && SALE_ABLE.includes(character.items[0]?.name)) {
  //       use_skill("alchemy");
  //     } else {
  //       swap(0, sellableSlot).then(() => {
  //         if (SALE_ABLE.includes(character.items[0]?.name)) use_skill("alchemy");
  //       });
  //     }
  //   }
  // }

  if (!smartmoveDebug) {
    hitAndRun(target, rangeRate);
    angle =
      angle +
      flipRotation *
        Math.asin(
          (character.speed * getLoopInterval()) /
            1000 /
            2 /
            (character.range * rangeRate +
              character.xrange * 0.9 +
              // extraDistanceWithinHitbox(
              //   angle,
              //   target ? get_width(target) ?? 0 : 0,
              //   target ? get_height(target) ?? 0 : 0
              // ))
              extraDistanceWithinHitbox(target) +
              extraDistanceWithinHitbox(character)),
        ) *
        2;
  } else {
    angle = undefined;
  }
}

async function mainLoop() {
  try {
    desiredElixir = "pumpkinspice";
    assignRoles();

    // buff();

    if (character.rip) {
      respawn();
      throw new Error("Character's down", {
        cause: "death",
      });
    }

    if (character.level > 50) {
      set("mageLocation", {
        mp: character.mp,
        map: character.map,
        x: character.x,
        y: character.y,
      });
    }

    if ((smart.moving || isAdvanceSmartMoving) && !smartmoveDebug)
      throw new Error("Smart moving", {
        cause: "smart_move",
      });

    let target = getTarget();

    // if (goToBoss()) return;

    //// THE CRYPT & EVENTS
    if (get("cryptInstance")) target = await useCryptStrategy(target);
    else target = await changeToDailyEventTargets();

    //// Logic to targets and farm places
    if (!target) {
      if (
        !smart.move &&
        !isAdvanceSmartMoving &&
        get("cryptInstance") &&
        character.map !== "crypt"
      ) {
        changeToNormalStrategies();
        advanceSmartMove(CRYPT_STARTING_LOCATION);
      } else if (
        !smart.moving &&
        !isAdvanceSmartMoving &&
        !get("cryptInstance") &&
        (partyMems[0] == character.name ||
          !get_entity(partyMems[0]) ||
          character.map === "crypt" ||
          distance(character, { x: mapX, y: mapY, map }) > 500)
      ) {
        log("Moving to farming location");
        changeToNormalStrategies();
        advanceSmartMove({
          map,
          x: mapX,
          y: mapY,
        });
      }
    } else fight(target);
  } catch (e) {
    console.error(e);
  }

  setTimeout(mainLoop, getLoopInterval());
}

if (!parent.caracAL) mainLoop();

// setInterval(async function () {
//   desiredElixir = "pumpkinspice";
//   assignRoles();

//   buff();

//   if (character.rip) {
//     respawn();
//     return;
//   }

//   if (character.level > 50) {
//     set("mageLocation", {
//       mp: character.mp,
//       map: character.map,
//       x: character.x,
//       y: character.y,
//     });
//   }

//   if ((smart.moving || isAdvanceSmartMoving) && !smartmoveDebug) return;

//   let target = getTarget();

//   if (goToBoss()) return;

//   //// THE CRYPT & EVENTS
//   if (get("cryptInstance")) target = await useCryptStrategy(target);
//   else target = await changeToDailyEventTargets();

//   //// Logic to targets and farm places
//   if (
//     !smart.move &&
//     !isAdvanceSmartMoving &&
//     get("cryptInstance") &&
//     character.map !== "crypt" &&
//     !target
//   ) {
//     changeToNormalStrategies();
//     await advanceSmartMove(CRYPT_STARTING_LOCATION);
//   } else if (
//     !smart.moving &&
//     !isAdvanceSmartMoving &&
//     !target &&
//     !get("cryptInstance") &&
//     (partyMems[0] == character.name ||
//       !get_entity(partyMems[0]) ||
//       character.map === "crypt" ||
//       distance(character, { x: mapX, y: mapY, map }) > 500)
//   ) {
//     log("Moving to farming location");
//     changeToNormalStrategies();
//     const scareInterval = setInterval(() => {
//       scareAwayMobs();
//     }, 5000);
//     await advanceSmartMove({
//       map,
//       x: mapX,
//       y: mapY,
//     });
//     clearInterval(scareInterval);
//   }

//   await fight(target);
// }, loopInterval);
