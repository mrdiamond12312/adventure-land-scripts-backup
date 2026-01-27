// Function to reduce cooldown based on the lowest current ping in the party
const reduceCd = (skillName, isPingBased = true) => {
  const cooldownTime = isPingBased
    ? Math.min(...parent.pings)
    : character.ping * 0.95;
  reduce_cooldown(skillName, cooldownTime);
};

// Load basic functions (unchanged)
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

// Kiting settings (unchanged)
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
  const blastRadius = character.explosion / 3.6 || BLAST_RADIUS;
  const attackRange = character.range + character.xrange;
  const inRange = (entity) => distance(entity, character) < attackRange;

  const haveIgnoreMobAroundTarget = (targetMob) => {
    return mobsListAroundTarget(targetMob, blastRadius).some((mob) =>
      MELEE_IGNORE_LIST.includes(mob.mtype),
    );
  };

  // --- Target Aggregation & Selection (usePullStrategies) ---
  if (currentStrategy === usePullStrategies) {
    const aggroedMobs = Object.values(parent.entities)
      .filter((entity) => {
        return (
          entity.type === "monster" &&
          !entity.s?.fullguardx &&
          !MELEE_IGNORE_LIST.includes(entity.mtype) &&
          entity.target &&
          !haveFormidableMonsterAroundTarget(entity) &&
          inRange(entity) &&
          !haveIgnoreMobAroundTarget(entity)
        );
      })
      // Optimization: Pre-calculate the cluster count BEFORE sorting
      .map((mob) => {
        mob.cluster_count = numberOfMonsterAroundTarget(mob, blastRadius);
        return mob;
      });

    if (aggroedMobs.length) {
      const aoeMob = aggroedMobs
        .sort((lhs, rhs) => {
          // Prioritize highest cluster count (using pre-calculated value)
          if (lhs.cluster_count !== rhs.cluster_count) {
            return rhs.cluster_count - lhs.cluster_count;
          }

          // Hit one with more HP
          return rhs.hp - lhs.hp;
        })
        .shift(); // Get the first of list (best for AOE)

      // Prioritize the AOE mob if it's better than the current target (or if the current is cooperative)
      const isAoeMobBetter =
        aoeMob &&
        mobsToFarm.findIndex((id) => id === aoeMob.mtype) <=
          mobsToFarm.findIndex((id) => id === target?.mtype);

      if (!target?.cooperative && isAoeMobBetter) {
        target = aoeMob;
      }
      change_target(target);
    }
  }

  if (!target) return;

  // --- Ignore blasting mobs on blacklist ---
  if (haveIgnoreMobAroundTarget(target)) {
    changeToNormalStrategies();
  }

  const promisesToAwait = [];

  // --- Attack & Warcry Logic ---
  const isAttackReady =
    ms_to_next_skill("attack") === 0 && !character.s.penalty_cd;

  if (isAttackReady && inRange(target) && shouldAttack()) {
    promisesToAwait.push(currentStrategy(target));
  }

  if (isAttackReady && inRange(target) && shouldAttack()) {
    set_message("Attacking");

    // Main attack execution
    promisesToAwait.push(
      attack(target)
        .then(() => {
          // attackSpeedCompensate(attackFrequencyBeforeComponsate);
          reduceCd("attack");
        })
        .catch((e) => attackErrorHandler(e)),
    );

    // Offhand swap logic: Use Candy Canes for farming
    const shouldUseCandyCanes =
      character.ping < 1000 &&
      !isCleaving &&
      !character.s.sugarrush &&
      (character.slots.offhand?.name === "fireblade" ||
        character.slots.mainhand?.name === "fireblade") &&
      character.slots.offhand?.name !== "mshield" &&
      character.cc < 100;

    if (shouldUseCandyCanes) {
      const candycane1 = findMaxLevelItem("candycanesword");
      const candycane2 = findMaxLevelItem("candycanesword", 1);

      if (candycane1 !== -1 && candycane2 !== -1) {
        isEquipingItems = true;
        const equipPromise = Promise.all([
          // Immediate equip
          Promise.all([
            equip(candycane1, "mainhand"),
            equip(candycane2, "offhand"),
          ]),

          // Delayed re-equip
          new Promise((resolve) => {
            setTimeout(() => {
              resolve(
                Promise.all([
                  equip(candycane1, "mainhand"),
                  equip(candycane2, "offhand"),
                ]),
              );
            }, 150);
          }),
        ]).finally(() => {
          isEquipingItems = false;
        });

        promisesToAwait.push(equipPromise);
      }
    }

    // Warcry check (placed here to potentially benefit from a new attack)
    const canWarcry =
      character.mp > G.skills["warcry"].mp &&
      !is_on_cooldown("warcry") &&
      !character.s["warcry"];

    if (canWarcry) {
      promisesToAwait.push(
        use_skill("warcry").then(() => reduceCd("warcry", false)), // Use full reduction for Warcry
      );
    }
  }

  // --- Defensive Abilities ---

  // Hardshell
  const shouldUseHardShell =
    character.mp > G.skills["hardshell"].mp &&
    !is_on_cooldown("hardshell") &&
    avgDmgTaken(character) > 500 &&
    character.hp < character.max_hp * 0.5;

  if (shouldUseHardShell) {
    promisesToAwait.push(use_skill("hardshell"));
  }

  // Warrior Stomp (Basher logic)
  const hasBasherInInventory = locate_item("basher") !== -1;
  const partyHasInjured = (
    parent.party_list.length ? parent.party_list : [character]
  )
    .map((id) => get_player(id))
    .filter((entity) => entity)
    .some((player) => player.hp < player.max_hp * 0.4);

  if (hasBasherInInventory && partyHasInjured) {
    promisesToAwait.push(warriorStomp());
  }

  // --- Taunt Logic ---
  const isTanker = isAssignedAsTanker();
  const canTaunt =
    isTanker && character.mp > G.skills["taunt"].mp && !is_on_cooldown("taunt");
  const partyHealer = get_player(HEALER) || get_player(RANGER);
  const isHealerAlive = partyHealer && !partyHealer.rip;

  if (canTaunt && isHealerAlive) {
    // --- If Mobs targeting allies
    const mobsTargetingAlly = Object.values(parent.entities).find(
      (mob) =>
        mob.type === "monster" &&
        partyMems.some(
          (ally) => ally !== character.name && mob.target === ally,
        ) &&
        mob.attack > 120 && // Mob is dangerous enough
        calculateDamage(mob, character) < 1800 && // Warrior can take the damage
        !mob.cooperative &&
        is_in_range(mob, "taunt"),
    );

    if (mobsTargetingAlly) {
      promisesToAwait.push(
        use_skill("taunt", mobsTargetingAlly).then(() =>
          reduceCd("taunt", false),
        ), // Use full reduction for Taunt
      );
    }

    // --- Taunt the current target if it's not already targeting the warrior and is weak enough
    const shouldTauntTarget =
      !target.target ||
      (target.target !== character.name &&
        partyMems.includes(target.target) &&
        target.attack < 1500 &&
        !target.cooperative &&
        is_in_range(target, "taunt"));

    if (mobsTargetingAlly === undefined && shouldTauntTarget) {
      promisesToAwait.push(
        use_skill("taunt", target).then(() => reduceCd("taunt", false)), // Use full reduction for Taunt
      );
    }
  }

  // --- Emergency Scare Logic ---
  const isDangerouslyLow =
    !partyHealer || partyHealer.rip || character.hp < character.max_hp * 0.3;
  const isOverwhelmed =
    Object.values(parent.entities).filter(
      (mob) => mob.target === character.name,
    ).length > 2;
  const isReadyToScare =
    !is_on_cooldown("scare") && character.mp > 100 && character.cc < 100;

  if (character.fear || (isDangerouslyLow && isOverwhelmed && isReadyToScare)) {
    scareAwayMobs();
  }

  // --- Kiting Rate Adjustment ---
  const needsKiteAdjustment =
    target && target.range <= character.range && target.speed > character.speed;
  rangeRate = needsKiteAdjustment
    ? target.speed / character.speed
    : originRangeRate;

  // --- Await and Error Handling ---
  try {
    await withTimeout(Promise.all(promisesToAwait), 1000);
  } catch (e) {
    console.error("Error while attacking", e);
  }
}

async function cleaveLoop() {
  try {
    const shouldCleave =
      smart.moving ||
      ms_to_next_skill("attack") > 0 ||
      distance(character, get_targeted_monster()) >
        character.range + character.xrange * 1.1;

    if (shouldCleave && character.mp > 1720) {
      await withTimeout(
        warriorCleave(
          currentStrategy === usePullStrategies ? "pull" : "normal",
        ),
      );
    }
  } catch (e) {
    console.log("Error while cleaving: ", e);
  }

  // Cleave loop runs on its own dedicated timer
  setTimeout(cleaveLoop, Math.max(ms_to_next_skill("cleave"), 100));
}

if (!parent.caracAL) cleaveLoop();

// Main control loop
async function mainLoop() {
  try {
    // --- Initialization and Status Checks ---
    desiredElixir =
      isAssignedAsTanker() && avgDmgTaken(character) > 300
        ? "elixirluck"
        : "pumpkinspice";
    assignRoles();

    // Use Charge if moving (for speed boost)
    const canCharge =
      character.moving &&
      character.mp > G.skills["charge"].mp &&
      !is_on_cooldown("charge");

    if (canCharge) {
      use_skill("charge");
    }

    // Handle immediate death state
    if (character.rip) {
      respawn();
      throw new Error("Character's down", {
        cause: "death",
      });
    }

    // Halt logic if character is performing a controlled move
    const isMovingControlled =
      (smart.moving || isAdvanceSmartMoving) && !smartmoveDebug;
    if (isMovingControlled) {
      throw new Error("Smart moving", {
        cause: "smart_move",
      });
    }

    // --- Target Selection ---
    let target = getTarget();

    // Prioritize Crypt/Event targets
    if (get("cryptInstance")) {
      target = await useCryptStrategy(target);
    } else {
      target = await changeToDailyEventTargets();
    }

    // --- Movement Logic ---
    if (!target) {
      const needsToEnterCrypt =
        get("cryptInstance") && character.map !== "crypt";
      const isPartyLeaderOrAlone =
        partyMems[0] === character.name || !get_entity(partyMems[0]);
      const isFarFromFarmingSpot =
        distance(character, { x: mapX, y: mapY, map }) > 500;

      // Only move to farm location if not doing crypt and either the leader/alone or far away.
      const needsToMoveToFarmLocation =
        !get("cryptInstance") && isPartyLeaderOrAlone && isFarFromFarmingSpot;

      if (needsToEnterCrypt) {
        advanceSmartMove(CRYPT_STARTING_LOCATION);
      } else if (needsToMoveToFarmLocation) {
        changeToNormalStrategies(); // Ensure correct strategy is set before move
        advanceSmartMove({
          map,
          x: mapX,
          y: mapY,
        });
      }
    } else {
      // Target found, engage in combat
      await fight(target);
    }
  } catch (e) {
    // Only log unhandled errors
    if (e.cause !== "smart_move" && e.cause !== "death") {
      console.error(e);
    }
  }

  // Schedule the next loop execution
  setTimeout(mainLoop, getLoopInterval());
}

if (!parent.caracAL) mainLoop();
