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

/**
 * @param {Object} entity
 * @param {number} [mult] - multiplier on attack range
 * @returns {boolean} whether the entity is within that range
 */
const inRange = (entity, mult = 1) =>
  distance(entity, character) < (character.range + character.xrange) * mult;

/** @returns {boolean} whether a blacklisted blasting mob stands around the target */
const haveIgnoreMobAroundTarget = (targetMob) =>
  mobsListAroundTarget(targetMob, getSplashRadius()).some((mob) =>
    MELEE_IGNORE_LIST.includes(mob.mtype),
  );

/**
 * The selected target as the warrior fights it: in pull mode the best mob for
 * the AOE, and what to swing at: it when in reach, else another aggroed mob.
 * @param {Object} [target]
 * @returns {{focus?: Object, attackTarget?: Object}}
 */
function planFight(target) {
  const blastRadius = getSplashRadius();

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
    !target?.mtype.includes("crabx") &&
    aggroedMobs.length
  ) {
    if (!target?.cooperative) target = aggroedMobs[0];
  }

  if (!target) return {};

  // Another mob in reach to hit while the focus is out of it
  const attackTarget = inRange(target)
    ? target
    : aggroedMobs.find((mob) => mob !== target && inRange(mob));
  return { focus: target, attackTarget };
}

/**
 * Faces the selected target, kiting wider from faster mobs, and drops the pull
 * strategy around blasting mobs on the blacklist.
 * @param {Object} [target]
 */
function aimAt(target) {
  const { focus } = planFight(target);
  if (!focus) return;

  if (haveIgnoreMobAroundTarget(focus)) changeToNormalStrategies();

  const needsKiteAdjustment =
    focus.range <= character.range && focus.speed > character.speed;
  rangeRate = needsKiteAdjustment
    ? focus.speed / character.speed
    : originRangeRate;

  change_target(focus);
}

/** @returns {(() => Promise)|undefined} the swing to take now, if any */
function getWarriorCast() {
  if (isOnTrip()) return getEnRouteCast();

  const { attackTarget } = planFight(fightTarget);
  if (!attackTarget || attackTarget.dead || !shouldAttack(attackTarget)) return;

  return () =>
    Promise.allSettled(
      [
        castOnAttackCooldown("attack", attackTarget),
        // Left to currentStrategy to put the real weapons back on its own tick
        maybeCandySwap(attackTarget, {
          swapFrom: CANDY_SWAP_WEAPON_ALLOW_LIST,
        }),
      ].filter(Boolean),
    );
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
 * target attacking a party member
 * @returns {Object|null} the mob to taunt, or null
 */
function getTauntTarget() {
  if (character.mp <= G.skills["taunt"].mp) return null;

  const baitedBoss = getBaitedBoss();
  if (
    baitedBoss?.target !== character.name &&
    partyMems.includes(baitedBoss?.target) &&
    is_in_range(baitedBoss, "taunt")
  )
    return baitedBoss;

  const rivalBoss = getBossToTakeBack()?.boss;
  if (rivalBoss && is_in_range(rivalBoss, "taunt")) return rivalBoss;

  if (!isAssignedAsTanker()) return null;

  // Taunt skips cooperative mobs below, so a drag boss on an ally is taken here
  const dragBossOnAlly = getDragBossOnAlly();
  if (dragBossOnAlly && is_in_range(dragBossOnAlly, "taunt"))
    return dragBossOnAlly;

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

  runActionLoop(getWarriorCast);

  // Gear, trips included, on a fixed cadence decoupled from the attack loop
  runSkillLoop({
    skill: "gear",
    floorMs: 50,
    whileMoving: true,
    canUse: () => true,
    cast: () => equipClassGear(get_target()),
  });

  // Pull skills (agitate, pull-taunt), never on a trip
  runSkillLoop({
    skill: "pullSkills",
    floorMs: 50,
    canUse: () => currentStrategy === usePullStrategies,
    cast: () => usePullSkills(),
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
    skill: "agitate",
    canUse: () => shouldAgitateBossBack(),
    cast: () => use_skill("agitate"),
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
    // Mid-trip it only hands back a target when a higher strategy took over.
    // The action loop swings.
    fightTarget = await selectFightTarget();

    if (fightTarget && !isOnTrip()) aimAt(fightTarget);
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
