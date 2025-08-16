// Load basic functions

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

// Kiting settings
const originRangeRate = 0.97;
rangeRate = originRangeRate;

// Main fight function
async function fight(target) {
  const haveIgnoreMobAroundTarget = (targetMob) => {
    return mobsListAroundTarget(
      targetMob,
      character.explosion / 3.6 || BLAST_RADIUS,
    ).some((mob) => MELEE_IGNORE_LIST.includes(mob.mtype));
  };

  if (currentStrategy === usePullStrategies) {
    aggroedMobs = Object.values(parent.entities).filter((mob) => {
      return (
        !haveFormidableMonsterAroundTarget(mob) &&
        distance(mob, character) <
          character.range +
            character.xrange * 0.9 +
            extraDistanceWithinHitbox(character) &&
        mob.target &&
        mob.type === "monster" &&
        !MELEE_IGNORE_LIST.includes(mob.mtype) &&
        !haveIgnoreMobAroundTarget(mob)
      );
    });

    if (aggroedMobs.length) {
      const aoeMob = aggroedMobs
        .sort((lhs, rhs) => {
          const lhsNumberOfSurrounding = numberOfMonsterAroundTarget(
            lhs,
            character.explosion / 3.6 || BLAST_RADIUS,
          );
          const rhsNumberOfSurrounding = numberOfMonsterAroundTarget(
            rhs,
            character.explosion / 3.6 || BLAST_RADIUS,
          );
          if (lhsNumberOfSurrounding === rhsNumberOfSurrounding)
            return rhs.hp - lhs.hp;
          return rhsNumberOfSurrounding - lhsNumberOfSurrounding;
        })
        .shift();

      target =
        aoeMob &&
        mobsToFarm.findIndex((id) => id === aoeMob.mtype) <=
          mobsToFarm.findIndex((id) => id === target.mtype)
          ? aoeMob
          : target;
      change_target(target);
    }
  }

  if (!target) return;

  if (haveIgnoreMobAroundTarget(target)) {
    changeToNormalStrategies();
  }

  if (
    ms_to_next_skill("attack") === 0 &&
    !character.s.penalty_cd &&
    distance(target, character) <
      character.range +
        character.xrange +
        extraDistanceWithinHitbox(target) +
        extraDistanceWithinHitbox(character) &&
    shouldAttack()
  ) {
    set_message("Attacking");
    currentStrategy(target);
    attack(target)
      .then(() => reduce_cooldown("attack", Math.min(...parent.pings)))
      .catch(
        (e) =>
          e.failed &&
          !["cooldown"].includes(e.response) &&
          reduce_cooldown("attack", ((-1 / character.frequency) * 1000) / 2),
      );
    reduce_cooldown("attack", ((-1 / character.frequency) * 1000) / 2);

    // Offhand swap logic
    if (
      (character.slots.offhand?.name === "fireblade" ||
        character.slots.mainhand?.name === "fireblade") &&
      !isEquipingItems
    ) {
      isEquipingItems = true;
      const warriorItems = calculateWarriorItems();
      equip_batch([
        {
          slot: "mainhand",
          num: findMaxLevelItem("candycanesword"),
        },
        {
          slot: "offhand",
          num: findMaxLevelItem("candycanesword", 1),
        },
      ])
        .then(() => {
          equip_batch([
            {
              slot: "mainhand",
              num: findMaxLevelItem(warriorItems.mainhand),
            },
            {
              slot: "offhand",
              num: findMaxLevelItem(warriorItems.offhand),
            },
          ]);
        })
        .finally(() => {
          isEquipingItems = false;
        });
    }

    if (
      character.mp > G.skills["warcry"].mp &&
      !is_on_cooldown("warcry") &&
      !character.s["warcry"]
    ) {
      use_skill("warcry");
    }
  }

  // Defensive abilities
  if (
    character.mp > G.skills["hardshell"].mp &&
    !is_on_cooldown("hardshell") &&
    avgDmgTaken(character) > 500 &&
    character.hp < character.max_hp * 0.5
  ) {
    use_skill("hardshell");
  }

  if (
    locate_item("basher") !== -1 &&
    (Object.keys(get_party()) ?? [character])
      .map((id) => get_player(id))
      .filter((entity) => entity)
      .some((player) => player.hp < player.max_hp * 0.4)
  ) {
    await warriorStomp();
  }

  // Taunt logic to protect allies
  const partyDmgRecieved = avgPartyDmgTaken(partyMems);
  const partyHealer = get_player(HEALER);
  if (
    character.mp > G.skills["taunt"].mp &&
    !is_on_cooldown("taunt") &&
    partyHealer &&
    !partyHealer.rip
  ) {
    const mobsTargetingAlly = Object.values(parent.entities).find(
      (mob) =>
        mob.type === "monster" &&
        partyMems.some(
          (ally) => ally !== character.name && mob.target === ally,
        ) &&
        mob.attack > 120 &&
        calculateDamage(mob, character) < 1800 &&
        !mob.cooperative,
    );

    if (mobsTargetingAlly) {
      use_skill("taunt", mobsTargetingAlly).then(() =>
        reduce_cooldown("taunt", character.ping * 0.95),
      );
    } else if (
      !target.target ||
      (target.target !== character.name &&
        target.attack < 1500 &&
        !target.cooperative)
    ) {
      use_skill("taunt", target).then(() =>
        reduce_cooldown("taunt", character.ping * 0.95),
      );
    }
  }

  // Emergency scare if overwhelmed
  if (
    character.fear ||
    ((!get_entity(HEALER) ||
      get_entity(HEALER)?.rip ||
      character.hp < character.max_hp * 0.3) &&
      Object.values(parent.entities).filter(
        (mob) => mob.target === character.name,
      ).length > 2 &&
      !is_on_cooldown("scare") &&
      character.mp > 100 &&
      character.cc < 100)
  ) {
    await scareAwayMobs();
  }

  // Kiting and movement logic
  if (!smartmoveDebug) {
    hitAndRun(target, rangeRate);
    const targetSize = target
      ? Math.max(get_width(target) ?? 0, get_height(target) ?? 0)
      : 0;
    const extraDist =
      extraDistanceWithinHitbox(target) + extraDistanceWithinHitbox(character);

    angle +=
      flipRotation *
      (Math.asin(
        (character.speed * getLoopInterval()) /
          1000 /
          (2 *
            (character.range * rangeRate + character.xrange * 0.9 + extraDist)),
      ) *
        2);
  } else {
    angle = undefined;
  }

  if (
    target &&
    target.range <= character.range &&
    target.speed > character.speed
  ) {
    rangeRate = target.speed / character.speed;
  } else {
    rangeRate = originRangeRate;
  }
}

// Main game loop

async function mainLoop() {
  try {
    assignRoles();

    if (
      character.moving &&
      character.mp > G.skills["charge"].mp &&
      !is_on_cooldown("charge")
    ) {
      use_skill("charge");
    }

    if (character.rip) {
      respawn();
      throw new Error("Character's down", {
        cause: "death",
      });
    }

    if (
      smart.moving ||
      is_on_cooldown("attack") ||
      distance(character, get_targeted_monster()) >
        character.range + character.xrange
    )
      await warriorCleave(
        currentStrategy === usePullStrategies ? "pull" : "normal",
      );

    if ((smart.moving || isAdvanceSmartMoving) && !smartmoveDebug)
      throw new Error("Smart moving", {
        cause: "smart_move",
      });

    let target = getTarget();

    // Boss handling
    // if (goToBoss()) return;

    // Crypt & Event logic
    if (get("cryptInstance")) {
      target = await useCryptStrategy(target);
    } else {
      target = await changeToDailyEventTargets();
    }

    // Targeting & movement logic
    if (!target) {
      if (!smart.moving && !isAdvanceSmartMoving) {
        if (get("cryptInstance") && character.map !== "crypt") {
          changeToNormalStrategies();
          advanceSmartMove(CRYPT_STARTING_LOCATION);
        } else if (!get("cryptInstance")) {
          changeToNormalStrategies();
          advanceSmartMove({ map, x: mapX, y: mapY });
        }
      }
    } else {
      fight(target);
    }
  } catch (e) {
    console.error(e);
  }

  setTimeout(mainLoop, getLoopInterval());
}

if (!parent.caracAL) mainLoop();

// setInterval(async function () {
//   assignRoles();

//   buff();

//   if (
//     character.moving &&
//     character.mp > G.skills["charge"].mp &&
//     !is_on_cooldown("charge")
//   ) {
//     use_skill("charge");
//   }

//   if (character.rip) {
//     respawn();
//     return;
//   }

//   if (
//     smart.moving ||
//     is_on_cooldown("attack") ||
//     distance(character, get_targeted_monster()) >
//       character.range + character.xrange
//   )
//     await warriorCleave(
//       currentStrategy === usePullStrategies ? "pull" : "normal"
//     );

//   if ((smart.moving || isAdvanceSmartMoving) && !smartmoveDebug) return;

//   let target = getTarget();

//   // Boss handling
//   if (goToBoss()) return;

//   // Crypt & Event logic
//   if (get("cryptInstance")) {
//     target = await useCryptStrategy(target);
//   } else {
//     target = await changeToDailyEventTargets();
//   }

//   // Targeting & movement logic
//   if (!target) {
//     if (!smart.moving && !isAdvanceSmartMoving) {
//       if (get("cryptInstance") && character.map !== "crypt") {
//         changeToNormalStrategies();
//         await advanceSmartMove(CRYPT_STARTING_LOCATION);
//       } else if (!get("cryptInstance")) {
//         changeToNormalStrategies();
//         const scareInterval = setInterval(scareAwayMobs, 5000);
//         await advanceSmartMove({ map, x: mapX, y: mapY });
//         clearInterval(scareInterval);
//       }
//     }
//   } else {
//     await fight(target);
//   }
// }, loopInterval);
