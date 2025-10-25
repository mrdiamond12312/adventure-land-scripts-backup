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
var originRangeRate = 0.95;
rangeRate = originRangeRate;

async function fight(target) {
  if (currentStrategy === usePullStrategies) {
    const allAggroedByParty = Object.values(parent.entities)
      .filter(
        (entity) =>
          entity.type === "monster" &&
          ([...partyMems, ...parent.party_list].includes(entity.target) ||
            (entity.coorperative && entity.target)),
      )
      .sort((lhs, rhs) => {
        const lhsHpPercentage = lhs.hp / lhs.max_hp;
        const rhsHpPercentage = rhs.hp / rhs.max_hp;

        if (lhs.coorperative && rhs.coorperative) {
          if (lhs["1hp"]) return -1;
          else return 1;
        }
        if (lhs.coorperative) return -1;
        if (rhs.coorperative) return 1;

        return rhsHpPercentage - lhsHpPercentage;
      });

    target = allAggroedByParty.shift() ?? target;
  }

  if (!target) return;

  const promisesToAwait = [];

  if (!is_on_cooldown("energize")) {
    const buffee = getLowestMana();
    if (
      buffee &&
      buffee.max_mp - buffee.mp > 500 &&
      buffee.mp < buffee.max_mp * 0.65 &&
      character.mp > character.max_mp * 0.75 &&
      is_in_range(buffee, "energize")
    ) {
      log("Energize " + buffee.name);
      promisesToAwait.push(
        withTimeout(
          use_skill("energize", buffee).then(() =>
            reduce_cooldown("energize", character.ping * 0.95),
          ),
          2500,
        ),
      );
    } else if (ms_to_next_skill("attack") <= 0 && !character.s.penalty_cd) {
      log("Energize " + character.name);
      promisesToAwait.push(
        withTimeout(
          use_skill("energize", character).then(() =>
            reduce_cooldown("energize", character.ping * 0.95),
          ),
          2500,
        ),
      );
    }
  }

  if (
    ms_to_next_skill("attack") === 0 &&
    !character.s.penalty_cd &&
    distance(target, character) < character.range + character.xrange &&
    shouldAttack()
  ) {
    promisesToAwait.push(
      currentStrategy(target),
      withTimeout(attack(target), 2500)
        .then(() => {
          reduce_cooldown("attack", Math.min(...parent.pings));
        })
        .catch((e) => {
          if (e.failed && e.response !== "cooldown") {
            reduce_cooldown("attack", -e.ms);
          }
        }),
    );

    set_message("Attacking");
  }

  try {
    await Promise.all(promisesToAwait);
  } catch (e) {}

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
        !smart.moving &&
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
    } else await fight(target);
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
//     !smart.moving &&
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
