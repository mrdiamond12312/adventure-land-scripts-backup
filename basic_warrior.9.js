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

const CANDY_SWAP_WEAPON_ALLOW_LIST = ["fireblade", "rapier"];

// Main fight function
async function fight(target) {
  const blastRadius = character.explosion / 3.6 || BLAST_RADIUS;
  const attackRange = character.range + character.xrange;
  const attackFrequencyBeforeComponsate = character.frequency;
  const inRange = (entity, mult = 1) =>
    distance(entity, character) < attackRange * mult;

  const haveIgnoreMobAroundTarget = (targetMob) => {
    return mobsListAroundTarget(targetMob, blastRadius).some((mob) =>
      MELEE_IGNORE_LIST.includes(mob.mtype),
    );
  };

  // --- Target Aggregation & Selection (usePullStrategies) ---
  let altTarget = undefined;
  const aggroedMobs = Object.values(parent.entities)
    .filter((entity) => {
      return (
        entity.type === "monster" &&
        !entity.s?.fullguardx &&
        !MELEE_IGNORE_LIST.includes(entity.mtype) &&
        entity.target &&
        !haveFormidableMonsterAroundTarget(entity) &&
        inRange(entity, 5) &&
        !haveIgnoreMobAroundTarget(entity)
      );
    })
    .map((mob) => {
      mob.cluster_count = numberOfMonsterAroundTarget(mob, blastRadius);
      return mob;
    })
    .sort((lhs, rhs) => {
      // Prioritize highest cluster count (using pre-calculated value)
      if (lhs.cluster_count !== rhs.cluster_count) {
        return rhs.cluster_count - lhs.cluster_count;
      }

      // Hit one with more HP
      return rhs.hp - lhs.hp;
    });

  if (
    typeof usePullStrategies === "function" &&
    currentStrategy === usePullStrategies &&
    !target?.mtype.includes("crabx")
  ) {
    if (aggroedMobs.length) {
      const aoeMob = aggroedMobs[0]; // Get the first of list (best for AOE)
      altTarget = aggroedMobs.filter(
        (mob) => mob !== aoeMob && inRange(mob),
      )[0]; // Get another mob in AttackRange to attack if the AOE mob is out of range

      // Prioritize the AOE mob if it's better than the current target (or if the current is cooperative)
      const isAoeMobBetter =
        aoeMob &&
        mobsToFarm.findIndex((id) => id === aoeMob.mtype) <=
          mobsToFarm.findIndex((id) => id === target?.mtype);

      if (!target?.cooperative && isAoeMobBetter) {
        target = aoeMob;
      }
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

  if (!isAttackReady && inRange(target) && shouldAttack()) {
    promisesToAwait.push(currentStrategy(target));
  }

  const targetToAttack = inRange(target) ? target : altTarget;
  if (isAttackReady && targetToAttack && shouldAttack()) {
    set_message("Attacking");
    // const xrangeUsed = distance(target, character) - character.range;
    // if (xrangeUsed > 0) character.xrange -= xrangeUsed;
    // Main attack execution
    promisesToAwait.push(
      attack(targetToAttack)
        .then(() => {
          attackSpeedCompensate(attackFrequencyBeforeComponsate);
          reduceCd("attack");
        })
        .catch((e) => attackErrorHandler(e, targetToAttack)),
    );

    // Offhand swap logic: Use Candy Canes for attacking
    const shouldUseCandyCanes =
      character.ping < 1000 &&
      !isCleaving &&
      !isEquipingItems &&
      !character.s.sugarrush &&
      (CANDY_SWAP_WEAPON_ALLOW_LIST.includes(character.slots.offhand?.name) ||
        CANDY_SWAP_WEAPON_ALLOW_LIST.includes(
          character.slots.mainhand?.name,
        )) &&
      character.slots.offhand?.name !== "mshield" &&
      character.cc < 100;

    if (shouldUseCandyCanes) {
      const candycane1 = findMaxLevelItem("candycanesword");
      const candycane2 = findMaxLevelItem("candycanesword", 1);
      const isFastAttacker = 1 / character.frequency < 0.6;

      if (candycane1 !== -1) {
        isEquipingItems = true;

        // To avoid penalty_cd, fast attackers only equip one candy cane, while slower attackers can attempt dual wield if they have two candy canes.
        const immediateEquip = isFastAttacker
          ? [{ num: candycane1, slot: "mainhand" }]
          : [
              { num: candycane1, slot: "mainhand" },
              { num: candycane2, slot: "offhand" },
            ];

        const delayedEquip = isFastAttacker
          ? [{ num: candycane1, slot: "mainhand" }]
          : [
              { num: candycane1, slot: "mainhand" },
              { num: candycane2, slot: "offhand" },
            ];

        // Only attempt dual wield if second candy cane exists
        if (!isFastAttacker && candycane2 === -1) {
          isEquipingItems = false;
        } else {
          const equipPromise = Promise.allSettled([
            equip_batch(immediateEquip),
            new Promise((resolve) => {
              setTimeout(() => {
                resolve(equip_batch(delayedEquip));
              }, 150);
            }),
          ]).finally(() => {
            isEquipingItems = false;
          });

          promisesToAwait.push(equipPromise);
        }
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
        [...partyMems, partyMerchant].some(
          (ally) => ally !== character.name && mob.target === ally,
        ) &&
        calculateDamage(mob, character) < 3000 && // Warrior can take the damage
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
    promisesToAwait.push(scareAwayMobs());
  }

  // --- Kiting Rate Adjustment ---
  const needsKiteAdjustment =
    target && target.range <= character.range && target.speed > character.speed;
  rangeRate = needsKiteAdjustment
    ? target.speed / character.speed
    : originRangeRate;

  // --- Await and Error Handling ---
  try {
    await withTimeout(Promise.allSettled(promisesToAwait), 1000);
  } catch (e) {
    console.error("Error while attacking", e);
  }

  // --- Change global target  ---
  change_target(target);
}

async function cleaveLoop() {
  try {
    const shouldCleave =
      smart.moving ||
      ms_to_next_skill("attack") > 0 ||
      distance(character, get_targeted_monster()) >
        character.range + character.xrange * 1.1;

    if (
      shouldCleave &&
      character.mp > 1720 &&
      !Object.keys(character.c).length
    ) {
      await withTimeout(
        warriorCleave(
          currentStrategy === usePullStrategies ? "pull" : "normal",
        ),
      );
    }
  } catch (e) {
    console.log("Error while cleaving: ", e);
  } finally {
    // Cleave loop runs on its own dedicated timer
    setTimeout(cleaveLoop, Math.max(ms_to_next_skill("cleave"), 100));
  }
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
  } finally {
    // Schedule the next loop execution
    setTimeout(mainLoop, getLoopInterval());
  }
}

if (!parent.caracAL) mainLoop();
