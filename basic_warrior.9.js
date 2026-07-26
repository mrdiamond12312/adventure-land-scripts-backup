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
    .then(() => dependenciesLoaded)
    .then(() => {
      cleaveLoop();
      mainLoop();
      startSkillLoops();
    });
} else {
  load_code(7);
  load_code(8);
}

// Kiting settings (unchanged)
const originRangeRate = 0.9;
rangeRate = originRangeRate;

const CANDY_SWAP_WEAPON_ALLOW_LIST = ["fireblade", "rapier"];
const CANDY_SWAP_FALLBACK_DELAY_MS = 150; // used when no projectile speed can be resolved
const CANDY_MIN_HOLD_MS = 40; // dwell after the canes land, even if the ETA is spent

/**
 * ETA (ms) of the character's attack projectile against the target
 * @param {Object} target - the entity the attack was fired at
 * @returns {number} delay in ms (>= 0)
 */
function projectileEtaMs(target) {
  const projectileKey =
    item_info(character.slots.mainhand)?.projectile ||
    G.classes[character.ctype].projectile;
  const projectileSpeed = G.projectiles[projectileKey]?.speed;

  if (!projectileSpeed || !target) return CANDY_SWAP_FALLBACK_DELAY_MS;

  return Math.max(
    20,
    (simple_distance(character, target) / projectileSpeed) * 1000 + 7,
  );
}

/**
 * Momentarily swaps to candy cane(s) for the landing hit, then swaps back to
 * the warrior's real weapon after the projectile connects.
 * @param {Object} targetToAttack - the entity being attacked
 * @returns {Promise|undefined} the equip promise, or undefined if not swapping
 */
function maybeCandySwap(targetToAttack) {
  const characterAtkCycleMs = 1000 / character.frequency;
  const shouldUseCandyCanes =
    character.ping < 1000 &&
    !isCleaving &&
    !isEquipingItems &&
    characterAtkCycleMs > 250 + character.ping &&
    // !character.s.sugarrush &&
    (CANDY_SWAP_WEAPON_ALLOW_LIST.includes(character.slots.offhand?.name) ||
      CANDY_SWAP_WEAPON_ALLOW_LIST.includes(character.slots.mainhand?.name)) &&
    character.slots.offhand?.name !== "mshield" &&
    character.cc < 100;

  if (!shouldUseCandyCanes) return;

  const candycane1 = findMaxLevelItem("candycanesword");
  const candycane2 = findMaxLevelItem("candycanesword", 1);
  const isFastAttacker = characterAtkCycleMs < 600;

  // To avoid penalty_cd, fast attackers only swap the mainhand; slower
  // attackers dual-wield candy canes when a second one is available.
  const buildEquip = (mainhand, offhand) =>
    isFastAttacker
      ? [{ num: mainhand, slot: "mainhand" }]
      : [
          { num: mainhand, slot: "mainhand" },
          { num: offhand, slot: "offhand" },
        ];

  const canCandySwap =
    candycane1 !== -1 && (isFastAttacker || candycane2 !== -1);
  if (!canCandySwap) return;

  // One-way trip for an equip to take effect server-side
  const equipLatencyMs = character.ping / 2;
  const etaMs = projectileEtaMs(targetToAttack);

  if (etaMs <= equipLatencyMs) return;

  isEquipingItems = true;

  const swapBackAt = Date.now() + etaMs + equipLatencyMs;

  const swapBackDeadline =
    Date.now() + characterAtkCycleMs - equipLatencyMs - CANDY_MIN_HOLD_MS;

  const candyEquip = equip_batch(buildEquip(candycane1, candycane2));

  const swapBackAfterHit = () =>
    new Promise((resolve) => {
      setTimeout(() => {
        const warriorItems = calculateWarriorItems();
        const mainhand = findMaxLevelItem(warriorItems.mainhand);
        const mainhandNum = mainhand === -1 ? candycane1 : mainhand;

        let equipPromise;
        if (!warriorItems.offhand) {
          // Double-handed mainhand: empty the offhand.
          equipPromise = Promise.all([
            unequip("offhand"),
            equip_batch([{ num: mainhandNum, slot: "mainhand" }]),
          ]);
        } else {
          // If offhand === mainhand, use a different inventory slot.
          const offhand =
            warriorItems.offhand === warriorItems.mainhand
              ? findMaxLevelItem(warriorItems.offhand, 1)
              : findMaxLevelItem(warriorItems.offhand);
          equipPromise = equip_batch(
            buildEquip(mainhandNum, offhand === -1 ? candycane2 : offhand),
          );
        }

        resolve(equipPromise.then(() => reduceCd("attack", false)));
      }, Math.min(
        Math.max(CANDY_MIN_HOLD_MS, swapBackAt - Date.now()),
        Math.max(0, swapBackDeadline - Date.now()),
      ));
    });

  return Promise.allSettled([
    candyEquip,
    candyEquip.then(swapBackAfterHit),
  ]).finally(() => {
    isEquipingItems = false;
  });
}

/** @returns {boolean} whether the attack cooldown is up */
const isAttackReady = () =>
  ms_to_next_skill("attack") === 0 && !character.s.penalty_cd;

// Main fight function
async function fight(target) {
  const blastRadius = getSplashRadius();
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
      // const isAoeMobBetter =
      //   aoeMob &&
      //   mobsToFarm.findIndex((id) => id === aoeMob.mtype) <=
      //     mobsToFarm.findIndex((id) => id === target?.mtype);

      if (
        !target?.cooperative
        // && isAoeMobBetter
      ) {
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

  const targetToAttack = inRange(target) ? target : altTarget;
  if (isAttackReady() && targetToAttack && shouldAttack()) {
    set_message("Attacking");
    promisesToAwait.push(
      attack(targetToAttack)
        .then(() => {
          attackSpeedCompensate(attackFrequencyBeforeComponsate);
          reduceCd("attack", false);
        })
        .catch((e) => attackErrorHandler(e, targetToAttack)),
    );

    const candySwap = maybeCandySwap(targetToAttack);
    if (candySwap) promisesToAwait.push(candySwap);
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
    if (
      canAffordSwap(2) &&
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

// --- Skills, each on its own runSkillLoop (see startSkillLoops) ---

/**
 * Defensive taunt target only: a mob to peel off an ally, or a weak current
 * target attacking a party member (needs a live healer). Strategic pull-taunt
 * stays in pull_strategy.13.js (driven by the strategy loop).
 * @returns {Object|null} the mob to taunt, or null
 */
function getTauntTarget() {
  if (!isAssignedAsTanker() || character.mp <= G.skills["taunt"].mp) return null;

  const partyHealer = get_player(HEALER) || get_player(RANGER);
  if (!partyHealer || partyHealer.rip) return null;

  const mobsTargetingAlly = Object.values(parent.entities)
    .filter(
      (entity) =>
        entity.type === "monster" &&
        [...partyMems, partyMerchant].some(
          (ally) => ally !== character.name && entity.target === ally,
        ) &&
        calculateDamage(entity, character) < 3000 &&
        !entity.cooperative &&
        is_in_range(entity, "taunt"),
    )
    .sort((lhs, rhs) => rhs.attack - lhs.attack)[0];
  if (mobsTargetingAlly) return mobsTargetingAlly;

  const target = get_targeted_monster();
  const shouldTauntTarget =
    target &&
    (!target.target ||
      (target.target !== character.name &&
        partyMems.includes(target.target) &&
        target.attack < 1500 &&
        !target.cooperative &&
        is_in_range(target, "taunt")));
  return shouldTauntTarget ? target : null;
}

/** @returns {boolean} whether the emergency scare should fire this tick */
function shouldWarriorScare() {
  const partyHealer = get_player(HEALER) || get_player(RANGER);
  const isDangerouslyLow =
    !partyHealer || partyHealer.rip || character.hp < character.max_hp * 0.3;
  const isOverwhelmed =
    Object.values(parent.entities).filter(
      (mob) => mob.target === character.name,
    ).length > 2;
  const isReadyToScare = character.mp > 100 && character.cc < 100;
  return character.fear || (isDangerouslyLow && isOverwhelmed && isReadyToScare);
}

function startSkillLoops() {
  // runSkillLoop always calls canUse right before cast, so canUse stashes what
  // it approved and cast reuses it instead of recomputing the scans.
  let pendingTauntTarget = null;

  // Strategy: gear + pull-strategy skills (agitate, pull-taunt) run on a fixed
  // cadence via currentStrategy, decoupled from the attack loop.
  runSkillLoop({
    skill: "strategy",
    floorMs: 100,
    canUse: () => true,
    cast: () => currentStrategy(get_target()),
  });

  runSkillLoop({
    skill: "warcry",
    canUse: () =>
      character.mp > G.skills["warcry"].mp &&
      !character.s["warcry"] &&
      !!get_targeted_monster(),
    cast: () => use_skill("warcry").then(() => reduceCd("warcry", false)),
  });

  runSkillLoop({
    skill: "hardshell",
    canUse: () =>
      character.mp > G.skills["hardshell"].mp &&
      avgDmgTaken(character) > 500 &&
      character.hp < character.max_hp * 0.5,
    cast: () => use_skill("hardshell"),
  });

  runSkillLoop({
    skill: "stomp",
    canUse: () => {
      const hasBasher = locate_item("basher") !== -1;
      const partyHasInjured = (
        parent.party_list.length ? parent.party_list : [character]
      )
        .map((id) => get_player(id))
        .filter((entity) => entity)
        .some((player) => player.hp < player.max_hp * 0.4);
      return hasBasher && partyHasInjured;
    },
    cast: () => warriorStomp(),
  });

  runSkillLoop({
    skill: "taunt",
    canUse: () => {
      pendingTauntTarget = getTauntTarget();
      return pendingTauntTarget != null;
    },
    cast: () =>
      use_skill("taunt", pendingTauntTarget).then(() =>
        reduceCd("taunt", false),
      ),
  });

  runSkillLoop({
    skill: "scare",
    canUse: () => shouldWarriorScare(),
    cast: () => scareAwayMobs(),
  });
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

if (!parent.caracAL) {
  mainLoop();
  startSkillLoops();
}
