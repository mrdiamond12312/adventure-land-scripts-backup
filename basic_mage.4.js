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
    const blastRadius = character.blast / 3.6 || BLAST_RADIUS;

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
        use_skill(
          "energize",
          energizeTarget,
          Math.max(character.mp - G.skills["magiport"].mp * 1.5, 2),
        )
          .then(() => reduceCd("energize"))
          .catch((e) => attackErrorHandler(e)),
      );
    }
  }

  if (!isAttackReady && isTargetInAttackRange && shouldAttack()) {
    promisesToAwait.push(currentStrategy(target));
  }

  if (isAttackReady && isTargetInAttackRange && shouldAttack()) {
    set_message("Attacking");
    promisesToAwait.push(
      // currentStrategy(target),
      attack(target)
        .then(() => {
          attackSpeedCompensate(attackFrequencyBeforeCompensate);
          reduceCd("attack", false);
        })
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
  const canUseReflection = !is_on_cooldown("reflection") && character.mp > 1000;
  const targetAggroesParty = partyMems.includes(target.target);

  if (isMagicalTarget && canUseReflection && targetAggroesParty) {
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
      // Observer count for the merchant's ent lure: how many ents are already
      // engaged with the party near the farm spawn? (avoids double-luring)
      const { party_list } = parent;
      const partyNames = new Set([...partyMems, partyMerchant, ...party_list]);
      const entsTargetingPartyCount = Object.values(parent.entities).filter(
        (entity) =>
          entity &&
          entity.type === "monster" &&
          entity.mtype === "ent" &&
          entity.target &&
          partyNames.has(entity.target) &&
          distance(entity, { x: mapX, y: mapY }) < 300,
      ).length;

      set("mageLocation", {
        mp: character.mp,
        map: character.map,
        x: character.x,
        y: character.y,
        time: Date.now(),
        entsTargetingPartyCount,
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

if (!parent.caracAL) mainLoop();
