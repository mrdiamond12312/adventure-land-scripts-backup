// Function to reduce cooldown based on the lowest current ping in the party
const reduceCd = (skillName, isPingBased = true) => {
  const cooldownTime = isPingBased
    ? Math.min(...parent.pings)
    : character.ping * 0.95;
  reduce_cooldown(skillName, cooldownTime);
};

// Load basic functions (unchanged)
if (parent.caracAL) {
  parent.caracAL.load_scripts([
    "adventure-land-scripts-backup/basic_function.7.js",
    "adventure-land-scripts-backup/other_class_msg_listener.8.js",
  ]);
} else {
  load_code(7);
  load_code(8);
}

// Kiting settings (unchanged)
const originRangeRate = 0.9;
rangeRate = originRangeRate;

const CANDY_SWAP_WEAPON_ALLOW_LIST = ["fireblade", "rapier"];

/** @returns {boolean} whether the attack cooldown is up */
const isAttackReady = () =>
  ms_to_next_skill("attack") === 0 && !character.s.penalty_cd;

// Main fight function
async function fight(target) {
  const blastRadius = getSplashRadius();
  const attackRange = character.range + character.xrange;
  const attackFrequencyBeforeComponsate = attackFrequency();
  const inRange = (entity, mult = 1) =>
    distance(entity, character) < attackRange * mult;

  const haveIgnoreMobAroundTarget = (targetMob) => {
    return mobsListAroundTarget(targetMob, blastRadius).some((mob) =>
      MELEE_IGNORE_LIST.includes(mob.mtype),
    );
  };

  // --- Target Aggregation & Selection (usePullStrategies) ---
  let altTarget = undefined;
  const candidates = Object.values(parent.entities).filter(
    (entity) =>
      entity.type === "monster" &&
      !isCaveFriendly(entity) &&
      !entity.s?.fullguardx &&
      !MELEE_IGNORE_LIST.includes(entity.mtype) &&
      entity.target &&
      !haveFormidableMonsterAroundTarget(entity) &&
      inRange(entity, 5) &&
      !haveIgnoreMobAroundTarget(entity),
  );
  const aggroedMobs = sortPullTargets(candidates, blastRadius);

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

    // Left to currentStrategy to put the real weapons back on its own tick
    const candySwap = maybeCandySwap(targetToAttack, {
      swapFrom: CANDY_SWAP_WEAPON_ALLOW_LIST,
    });
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
    await withTimeout(
      warriorCleave(currentStrategy === usePullStrategies ? "pull" : "normal"),
    );
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
  if (character.mp <= G.skills["taunt"].mp) return null;

  // Taunt redirects off a party member: takes the boss back so scare can hand it on
  const baitedBoss = getBaitedBoss();
  if (
    baitedBoss?.target !== character.name &&
    partyMems.includes(baitedBoss?.target) &&
    is_in_range(baitedBoss, "taunt")
  )
    return baitedBoss;

  if (!isAssignedAsTanker()) return null;

  const partyHealer = get_player(HEALER) || get_player(RANGER);
  if (!partyHealer || partyHealer.rip) return null;

  const myCharacters = getMyCharacters();
  const mobsTargetingAlly = Object.values(parent.entities)
    .filter(
      (entity) =>
        entity.type === "monster" &&
        !isCaveFriendly(entity) &&
        myCharacters.some(
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
    !isBaitHeld(target) &&
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
  return (
    character.fear ||
    isHoldingBait() ||
    (isDangerouslyLow && isOverwhelmed && isReadyToScare)
  );
}

function startSkillLoops() {
  // runSkillLoop always calls canUse right before cast, so canUse stashes what
  // it approved and cast reuses it instead of recomputing the scans.
  let pendingTauntTarget = null;

  // Strategy: gear + pull-strategy skills (agitate, pull-taunt) run on a fixed
  // cadence via currentStrategy, decoupled from the attack loop.
  runSkillLoop({
    skill: "strategy",
    floorMs: 50,
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

  runSkillLoop({
    skill: "charge",
    whileMoving: true,
    canUse: () =>
      character.moving &&
      character.mp > G.skills["charge"].mp &&
      !is_on_cooldown("charge"),
    cast: () => use_skill("charge"),
  });
}

// Main control loop
async function mainLoop() {
  try {
    // --- Initialization and Status Checks ---
    desiredElixir =
      isAssignedAsTanker() && avgDmgTaken(character) > 300
        ? "elixirluck"
        : "pumpkinspice";
    assignRoles();

    // Handle immediate death state
    if (character.rip) {
      respawn();
      throw new Error("Character's down", {
        cause: "death",
      });
    }

    // --- Target Selection --- events, then the crypt, then the farming spot
    // Mid-trip it only hands back a target when a higher strategy took over
    const target = await selectFightTarget();

    // Target found, engage in combat
    if (target && !isOnTrip()) await fight(target);
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

cleaveLoop();
mainLoop();
startSkillLoops();
