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

async function fight(target) {
  // Snapshot for attackSpeedCompensate: blaster's attack speed modifier means
  // frequency can change mid-tick when weapons swap, and the attack cooldown
  // must be timed with the frequency the shot was actually fired at.
  const attackFrequencyBeforeCompensate = character.frequency;

  if (
    currentStrategy === usePullStrategies &&
    !target?.mtype.includes("crabx")
  ) {
    const attackRange = character.range + character.xrange;
    const blastRadius = getSplashRadius();

    // Filter: Find all aggroed mobs within a reasonable pull distance, excluding formidable ones
    const aggroedMobs = Object.values(parent.entities)
      .filter(
        (entity) =>
          entity.type === "monster" &&
          entity.target && // Must be aggroed
          !entity.dead &&
          !entity.s?.fullguardx &&
          !haveFormidableMonsterAroundTarget(entity) &&
          distance(entity, character) <= attackRange,
      )
      // Map: Pre-calculate the cluster count (The performance optimization)
      .map((mob) => {
        mob.cluster_count = numberOfMonsterAroundTarget(mob, blastRadius);
        return mob;
      });

    if (aggroedMobs.length) {
      // Sort: Find the best mob to target for cluster damage
      const bestTarget = aggroedMobs
        .sort((lhs, rhs) => {
          if (lhs.cooperative !== rhs.cooperative) {
            return lhs.cooperative ? -1 : 1;
          }
          // Prioritize highest cluster count
          if (lhs.cluster_count !== rhs.cluster_count) {
            return rhs.cluster_count - lhs.cluster_count;
          }
          // If cluster counts are equal, prioritize highest HP to apply max damage
          return rhs.hp - lhs.hp;
        })
        .shift(); // Get the first (best) target

      target = bestTarget ?? target;
      change_target(target);
    }
  }

  // --- Early Exit ---
  if (!target) return;

  const isAttackReady =
    ms_to_next_skill("attack") === 0 && !character.s.penalty_cd;
  const isTargetInAttackRange =
    distance(target, character) <= character.range + character.xrange;

  // Attack, paired with self-energize (spare mp feeds the shot). Every other
  // skill runs on its own loop (startSkillLoops).
  if (isAttackReady && isTargetInAttackRange && shouldAttack()) {
    set_message("Attacking");

    const promisesToAwait = [];

    if (!is_on_cooldown("energize")) {
      promisesToAwait.push(
        use_skill(
          "energize",
          character,
          Math.max(character.mp - G.skills["magiport"].mp * 1.5, 2),
        )
          .then(() => reduceCd("energize"))
          .catch((e) => attackErrorHandler(e)),
      );
    }

    promisesToAwait.push(
      attack(target)
        .then(() => {
          attackSpeedCompensate(attackFrequencyBeforeCompensate);
          reduceCd("attack", false);
        })
        .catch((e) => attackErrorHandler(e)),
    );

    try {
      await withTimeout(Promise.allSettled(promisesToAwait), 1000);
    } catch (e) {
      console.log(e);
    }
  }
}

// --- Skills, each on its own runSkillLoop (see startSkillLoops) ---

// Ally worth energizing: needs the mana, and we have spare to give.
// (Self-energize is paired with the attack in fight, not here.)
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

  // Strategy: gear + pull-strategy skills (cburst) run on a fixed cadence via
  // currentStrategy, decoupled from the attack loop.
  runSkillLoop({
    skill: "strategy",
    floorMs: 100,
    canUse: () => true,
    cast: () => currentStrategy(get_target()),
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
      if (is_on_cooldown("reflection") || character.mp <= 1000) return false;
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
      const cryptKey = get("cryptInstance");
      const needsToEnterCrypt = cryptKey && character.map !== "crypt";
      const isPartyLeaderOrAlone =
        TANKER === character.name || !get_entity(TANKER);
      const isFarFromFarmingSpot =
        distance(character, { x: mapX, y: mapY, map }) > 500;

      const needsToMoveToFarmLocation =
        !cryptKey && (isPartyLeaderOrAlone || isFarFromFarmingSpot);

      if (needsToEnterCrypt) {
        // Move to Crypt start if a crypt instance is active but we aren't there
        advanceSmartMove(CRYPT_STARTING_LOCATION);
      } else if (needsToMoveToFarmLocation) {
        // Move to the designated farming spot
        log("Moving to farming location");
        changeToNormalStrategies();
        advanceSmartMove({
          map,
          x: mapX,
          y: mapY,
        });
      }
    } else {
      // Target found, chilling with my staff :cow2:
      await fight(target);
    }
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
