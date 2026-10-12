// Load basic functions from other code snippet

if (parent.caracAL) {
  parent.caracAL.load_scripts([
    "adventure-land-scripts-backup/basic_function.7.js",
    "adventure-land-scripts-backup/other_class_msg_listener.8.js",
  ]);
} else {
  load_code(7);
  load_code(8);
}

// Kiting
var originRangeRate = 0.4;
rangeRate = originRangeRate;

const reduceCd = (skillName, isPingBased = true) =>
  reduce_cooldown(
    skillName,
    isPingBased ? Math.min(...parent.pings) : character.ping * 0.95,
  );

// How far past attack range target selection is allowed to search
const TARGET_SEARCH_RANGE_MULTIPLIER = 1.5;

/**
 * @param {Object} entity - the entity to measure against
 * @param {number} [mult] - multiplier on attack range
 * @returns {boolean} whether the entity is within that range
 */
const inRange = (entity, mult = 1) =>
  !!entity &&
  distance(entity, character) <= (character.range + character.xrange) * mult;

/**
 * The selected target as the mage fights it: in pull mode the best aggroed
 * mob for the splash, and what to shoot, it when in reach, else the best
 * aggroed mob that is.
 * @param {Object} [target]
 * @returns {{focus?: Object, attackTarget?: Object}}
 */
function planFight(target) {
  const aggroedMobs = Object.values(parent.entities).filter(
    (entity) =>
      entity.type === "monster" &&
      !isCaveFriendly(entity) &&
      entity.target &&
      !entity.dead &&
      !entity.s?.fullguardx &&
      !haveFormidableMonsterAroundTarget(entity) &&
      inRange(entity, TARGET_SEARCH_RANGE_MULTIPLIER),
  );

  if (
    currentStrategy === usePullStrategies &&
    !target?.mtype.includes("crabx") &&
    aggroedMobs.length
  ) {
    target =
      sortPullTargets(aggroedMobs, getSplashRadius(), cooperativeFirst)[0] ??
      target;
  }

  if (!target) return {};

  const attackTarget = inRange(target)
    ? target
    : aggroedMobs.filter((mob) => mob !== target && inRange(mob))[0];
  return { focus: target, attackTarget };
}

/** @param {Object} [target] - the selected target, faced as planFight picks it */
function aimAt(target) {
  const { focus } = planFight(target);
  if (focus) change_target(focus);
}

/** @returns {(() => Promise)|undefined} the shot to take now, if any */
function getMageCast() {
  if (isOnTrip()) return getEnRouteCast();

  const { attackTarget } = planFight(fightTarget);
  if (!attackTarget || !shouldAttack(attackTarget)) return;

  // Paired with self-energize: spare mp feeds the shot
  return () =>
    Promise.allSettled(
      [
        !is_on_cooldown("energize") &&
          use_skill(
            "energize",
            character,
            Math.max(character.mp - G.skills["magiport"].mp * 1.5, 2),
          )
            .then(() => reduceCd("energize"))
            .catch((e) => attackErrorHandler(e)),
        castOnAttackCooldown("attack", attackTarget),
      ].filter(Boolean),
    );
}

// --- Skills, each on its own runSkillLoop (see startSkillLoops) ---

// Ally worth energizing: needs the mana, and we have spare to give.
// (Self-energize is paired with the attack in getMageCast, not here.)
function getEnergizeBuffee() {
  const buffee = getLowestMana();
  const shouldEnergize =
    buffee &&
    buffee.max_mp - buffee.mp > 500 &&
    buffee.mp < buffee.max_mp * 0.65 &&
    character.mp > character.max_mp * 0.75 &&
    is_in_range(buffee, "energize");
  return shouldEnergize ? buffee : null;
}

// Party member (in reflection range) taking the most magical damage right now.
function getReflectionBuffee() {
  return prioritizedNames()
    .map((name) => get_player(name))
    .filter((player) => player && is_in_range(player, "reflection"))
    .map((player) => ({ player, dmg: avgDmgTaken(player, "magical") }))
    .filter(({ dmg }) => dmg > 0)
    .sort((lhs, rhs) => rhs.dmg - lhs.dmg)[0]?.player;
}

function startSkillLoops() {
  // runSkillLoop always calls canUse right before cast, so canUse stashes what
  // it approved and cast reuses it instead of recomputing the scans.
  let pendingEnergizeBuffee = null;
  let pendingReflectionBuffee = null;

  runActionLoop(getMageCast);

  // Gear, trips included, on a fixed cadence decoupled from the attack loop.
  // Keeps the native mover's broom on for the trip.
  runSkillLoop({
    skill: "gear",
    floorMs: 100,
    whileMoving: true,
    canUse: () => !(isOnTrip() && getServerSlot("mainhand")?.name === "broom"),
    cast: () => equipClassGear(get_target()),
  });

  // Pull skills (cburst), never on a trip
  runSkillLoop({
    skill: "pullSkills",
    floorMs: 100,
    canUse: () => currentStrategy === usePullStrategies,
    cast: () => usePullSkills(),
  });

  runSkillLoop({
    skill: "energize",
    canUse: () => {
      if (is_on_cooldown("energize")) return false;
      pendingEnergizeBuffee = getEnergizeBuffee();
      return pendingEnergizeBuffee != null;
    },
    cast: () =>
      use_skill(
        "energize",
        pendingEnergizeBuffee,
        Math.max(character.mp - G.skills["magiport"].mp * 1.5, 2),
      )
        .then(() => reduceCd("energize"))
        .catch((e) => attackErrorHandler(e)),
  });

  runSkillLoop({
    skill: "reflection",
    canUse: () => {
      if (
        is_on_cooldown("reflection") ||
        character.mp <= G.skills["reflection"].mp + surgeMpReserve()
      )
        return false;
      pendingReflectionBuffee = getReflectionBuffee();
      return pendingReflectionBuffee != null;
    },
    cast: () =>
      use_skill("reflection", pendingReflectionBuffee).then(() =>
        reduceCd("reflection"),
      ),
  });

  // scare: shake off mobs on a tanky target. Pull mode additionally requires
  // the mage to actually be hurt before bailing.
  runSkillLoop({
    skill: "scare",
    canUse: () => {
      if (isHoldingBait()) return true;
      if (character.mp <= 100) return false;
      const target = get_targeted_monster();
      if (!target || target.max_hp <= 3000) return false;
      const mobsOnMe = Object.values(parent.entities).some(
        (entity) =>
          entity.type === "monster" && entity.target === character.name,
      );
      if (!mobsOnMe) return false;
      return currentStrategy === usePullStrategies
        ? character.hp < character.max_hp * 0.7
        : true;
    },
    cast: () => scareAwayMobs(),
  });
}

async function mainLoop() {
  try {
    // --- Initialization and Status Checks ---
    desiredElixir = "pumpkinspice";
    assignRoles();

    // Handle immediate death state
    if (character.rip) {
      respawn();
      throw new Error("Character's down", {
        cause: "death",
      });
    }

    publishEntFieldReport();

    // Save location data for magiport consumers once high level. The ent count
    // moved to publishEntFieldReport (basic_function.7.js) so it survives the
    // mage being swapped out of the party.
    if (character.max_mp > G.skills["magiport"].mp * 1.5) {
      set("mageLocation", {
        mp: character.mp,
        map: character.map,
        x: character.x,
        y: character.y,
        time: Date.now(),
      });
    }

    // --- Target Selection --- events, then the crypt, then the farming spot
    // Mid-trip it only hands back a target when a higher strategy took over.
    // The action loop shoots.
    fightTarget = await selectFightTarget();

    if (fightTarget && !isOnTrip()) aimAt(fightTarget);
  } catch (e) {
    // If the error is 'smart_move' or 'death', it was handled internally (by the throw)
    // If it's a real runtime error, log it
    if (e.cause !== "smart_move" && e.cause !== "death") {
      console.error(e);
    }
  }

  // Schedule the next loop execution
  setTimeout(mainLoop, getLoopInterval());
}

mainLoop();
startSkillLoops();
