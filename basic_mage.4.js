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
var originRangeRate = 0.85;
rangeRate = originRangeRate;
const loopInterval = Math.floor(((1 / character.frequency) * 1000) / 4);

const reduceCd = (skillName) =>
  reduce_cooldown(skillName, Math.min(...parent.pings));

async function fight(target) {
  if (currentStrategy === usePullStrategies) {
    const attackRange = character.range + character.xrange;
    const blastRadius = character.blast / 3.6 || BLAST_RADIUS;

    // Filter: Find all aggroed mobs within a reasonable pull distance, excluding formidable ones
    const aggroedMobs = Object.values(parent.entities)
      .filter(
        (entity) =>
          entity.type === "monster" &&
          entity.target && // Must be aggroed
          !entity.dead &&
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
      const bestPullTarget = aggroedMobs
        .sort((lhs, rhs) => {
          // 1. Prioritize highest cluster count
          if (lhs.cluster_count !== rhs.cluster_count) {
            return rhs.cluster_count - lhs.cluster_count;
          }
          // 2. If cluster counts are equal, prioritize highest HP to apply max damage
          return rhs.hp - lhs.hp;
        })
        .shift(); // Get the first (best) target

      target = bestPullTarget ?? target;
      change_target(target);
    }
  }

  // --- Early Exit ---
  if (!target) return;

  const promisesToAwait = [];

  // --- Energize Logic ---
  const canEnergize = !is_on_cooldown("energize");
  const isAttackReady =
    ms_to_next_skill("attack") === 0 && !character.s.penalty_cd;
  const isTargetInAttackRange =
    distance(target, character) <= character.range + character.xrange;
  if (canEnergize) {
    let energizeTarget = null;

    const buffee = getLowestMana();
    const shouldEnergizeBuffee =
      buffee &&
      buffee.max_mp - buffee.mp > 500 &&
      buffee.mp < buffee.max_mp * 0.65 &&
      character.mp > character.max_mp * 0.75 &&
      is_in_range(buffee, "energize");

    if (shouldEnergizeBuffee) {
      energizeTarget = buffee;
    } else if (isAttackReady && isTargetInAttackRange) {
      energizeTarget = character;
    }

    if (energizeTarget) {
      promisesToAwait.push(
        use_skill("energize", energizeTarget).then(() => reduceCd("energize")),
      );
    }
  }

  // --- Attack Logic ---

  if (isAttackReady && isTargetInAttackRange && shouldAttack()) {
    set_message("Attacking");
    promisesToAwait.push(
      currentStrategy(target), // Assumes currentStrategy includes moving/kiting logic
      attack(target)
        .then(() => reduceCd("attack"))
        .catch((e) => {
          attackErrorHandler(e);
        }),
    );
  }

  // --- Await and Error Handling ---
  try {
    await withTimeout(Promise.allSettled(promisesToAwait), 1000);
  } catch (e) {
    console.log(e);
  }

  // --- Reflection Logic ---
  const isMagicalTarget = target["damage_type"] === "magical";
  const canReflect = !is_on_cooldown("reflection") && character.mp > 1000;
  const targetAggroesParty = partyMems.includes(target.target);

  if (isMagicalTarget && canReflect && targetAggroesParty) {
    use_skill("reflection", get_entity(target.target)).then(() =>
      reduceCd("reflection"),
    );
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

    // Save location data for other characters/storage once high level
    if (character.max_mp > G.skills["magiport"].mp * 1.5) {
      set("mageLocation", {
        mp: character.mp,
        map: character.map,
        x: character.x,
        y: character.y,
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
      const isFarFromPartyLeader =
        distance(character, { x: mapX, y: mapY, map }) > 500;

      const needsToMoveToFarmLocation =
        !cryptKey && (isPartyLeaderOrAlone || isFarFromPartyLeader);

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

if (!parent.caracAL) mainLoop();
