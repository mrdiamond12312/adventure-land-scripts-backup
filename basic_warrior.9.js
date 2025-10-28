// Load basic functions

if (parent.caracAL) {
  parent.caracAL
    .load_scripts([
      "adventure-land-scripts-backup/basic_function.7.js",
      "adventure-land-scripts-backup/other_class_msg_listener.8.js",
    ])
    .then(() => {
      cleaveLoop();
      mainLoop();
    });
} else {
  load_code(7);
  load_code(8);
}

// Kiting settings
const originRangeRate = 0.9;
rangeRate = originRangeRate;

const bosses = {
  icegolem: { type: "icegolem", threshold: 0.7, hoppable: 0.999 },
  franky: { type: "franky", threshold: 0.7, hoppable: 0.965 },
  mrpumpkin: { type: "mrpumpkin", threshold: 0.7, hoppable: 0.95 },
  mrgreen: { type: "mrgreen", threshold: 0.7, hoppable: 0.95 },
  crabxx: { type: "crabxx", threshold: 0.95, hoppable: 0.9999 },
  dragold: { type: "dragold", threshold: 0.99, hoppable: 1 },
};

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
        !target.cooperative &&
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
        character.xrange * 0.9 +
        extraDistanceWithinHitbox(target) +
        extraDistanceWithinHitbox(character) &&
    shouldAttack()
  ) {
    set_message("Attacking");
    // Main attack logic
    const promisesToAwait = [
      currentStrategy(target),
      withTimeout(attack(target), 2500)
        .then(() => {
          reduce_cooldown("attack", Math.min(...parent.pings));
        })
        .catch((e) => attackErrorHandler(e)),
    ];

    // Offhand swap logic
    if (
      (character.slots.offhand?.name === "fireblade" ||
        character.slots.mainhand?.name === "fireblade") &&
      character.cc < 105 &&
      !character.s.sugarrush
    ) {
      const warriorItems = calculateWarriorItems();
      const candycane1 = findMaxLevelItem("candycanesword");
      const candycane2 = findMaxLevelItem("candycanesword", 1);
      const equipPromises = Promise.all([
        equip(candycane1, "mainhand"),
        equip(candycane2, "offhand"),
      ]).then(async () => {
        await equipBatch({
          mainhand: warriorItems.mainhand,
          offhand: warriorItems.offhand,
        });
      });

      promisesToAwait.push(equipPromises);
    }

    try {
      await withTimeout(Promise.all(promisesToAwait), 2500);
    } catch (e) {}

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
    isAssignedAsTanker() &&
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

    if (mobsTargetingAlly && is_in_range(mobsTargetingAlly, "taunt")) {
      use_skill("taunt", mobsTargetingAlly).then(() =>
        reduce_cooldown("taunt", character.ping * 0.95),
      );
    } else if (
      !target.target ||
      (target.target !== character.name &&
        target.attack < 1500 &&
        !target.cooperative &&
        is_in_range(target, "taunt"))
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
async function cleaveLoop() {
  try {
    if (
      smart.moving ||
      ms_to_next_skill("attack") > 50 ||
      distance(character, get_targeted_monster()) >
        character.range + character.xrange * 1.1
    )
      await warriorCleave(
        currentStrategy === usePullStrategies ? "pull" : "normal",
      );
  } catch (e) {
    console.log("Error while cleaving: " + e);
  }

  setTimeout(cleaveLoop, Math.max(ms_to_next_skill("cleave"), 100));
}

if (!parent.caracAL) cleaveLoop();

async function mainLoop() {
  try {
    desiredElixir = isAssignedAsTanker() ? "elixirluck" : "pumpkinspice";
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

    // if (
    //   smart.moving ||
    //   ms_to_next_skill("attack") > 50 ||
    //   distance(character, get_targeted_monster()) >
    //     character.range + character.xrange * 1.1
    // )
    //   await warriorCleave(
    //     currentStrategy === usePullStrategies ? "pull" : "normal",
    //   );

    if ((smart.moving || isAdvanceSmartMoving) && !smartmoveDebug)
      throw new Error("Smart moving", {
        cause: "smart_move",
      });

    let target = getTarget();

    // Crypt & Event logic
    if (get("cryptInstance")) {
      target = await useCryptStrategy(target);
    } else {
      target = await changeToDailyEventTargets();
    }

    // Targeting & movement logic
    if (!target) {
      if (
        !smart.moving &&
        !isAdvanceSmartMoving &&
        get("cryptInstance") &&
        character.map !== "crypt"
      ) {
        advanceSmartMove(CRYPT_STARTING_LOCATION);
      } else if (
        !smart.moving &&
        !get("cryptInstance") &&
        (partyMems[0] === character.name ||
          !get_entity(partyMems[0]) ||
          distance(character, { x: mapX, y: mapY, map }) > 500)
      ) {
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
