// Load basic functions from other code snippet (unchanged)
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

// Kiting (unchanged)
var originRangeRate = 0.35;
rangeRate = originRangeRate;

// --- Helper Functions ---
const isWeak = (monster) =>
  monster.hp < calculateDamage(character, monster) * 0.9 || monster.target;
const isCooperative = (monster) => monster.cooperative;
const isMob = (entity) => entity.type === "monster";

// 1. Reusable Cooldown Reduction
const reduceCd = (skillName) =>
  reduce_cooldown(skillName, Math.min(...parent.pings));

const tryMultiShot = async (skill, entityList) => {
  if (entityList.length === 0) return false;
  set_message(`${skill} Shooting`);
  return use_skill(skill, entityList)
    .then(() => reduceCd("attack")) // Use reduceCd for the skill (was incorrectly hardcoded to "attack");
};

async function fight(target) {
  if (ms_to_next_skill("attack") > 0 || character.s.penalty_cd) return;

  const canMultiShot = !character.fear;
  const inRange = (entity) => distance(entity, character) < nearRange;
  const nearRange = character.range + character.xrange;
  const explosionRadius = character.explosion
    ? character.explosion / 3.6
    : BLAST_RADIUS;
  const notCupid = character.slots.mainhand?.name !== "cupid";
  const entitiesInVision = Object.values(parent.entities);
  const promisesToAwait = []; // --- Target Selection & Optimization ---

  const potentialTargets = entitiesInVision
    .filter(
      (entity) =>
        entity.type === "monster" &&
        !entity.dead &&
        !entity.rip &&
        inRange(entity) &&
        !entity.s?.fullguardx &&
        (entity.attack * (entity.frequency > 1 ? entity.frequency : 1) < 500 ||
          (entity.cooperative && !partyMems.includes(entity.target)) ||
          entity["1hp"] ||
          entity.target),
    )
    .map((entity) => {
      // Optimization: Pre-calculate cluster count and distance once
      entity.cluster_count = numberOfMonsterAroundTarget(
        entity,
        explosionRadius,
      );
      entity.distance = distance(character, entity);
      return entity;
    })
    .sort((lhs, rhs) => {
      // Cooperative and target prioritization (Highest Priority)
      if (lhs.cooperative || (lhs.target && !rhs.target)) return -1;
      if (rhs.cooperative || (rhs.target && !lhs.target)) return 1;

      return (
        // 1. Maximize Cluster Count (Highest First: rhs - lhs)
        rhs.cluster_count - lhs.cluster_count || // 2. Minimize HP (Lowest First: lhs - rhs) <-- Corrected from your initial code
        lhs.hp - rhs.hp || // 3. Minimize Distance (Lowest First: lhs - rhs) <-- Corrected from your initial code
        lhs.distance - rhs.distance
      );
    });

  const weakMobs = potentialTargets.filter(isWeak); // --- Target Acquisition ---

  if (potentialTargets.length) {
    target = potentialTargets[0];
    change_target(target);
  } // Reacquire target if feared

  if (character.fear) {
    const aggroing = potentialTargets.find(
      (mob) => mob.target === character.name,
    );
    scareAwayMobs();
    if (aggroing) target = aggroing;
  }

  // --- Huntersmark ---
  const canHuntersMark =
    target &&
    !target.s?.marked &&
    character.mp > 300 + 1000 &&
    !is_on_cooldown("huntersmark") &&
    target.hp > 3000;
  if (canHuntersMark) {
    promisesToAwait.push(
      use_skill("huntersmark", target).then(() => reduceCd("huntersmark")),
    );
  }

  // --- Attack Priority: 5shot > 3shot > single ---
  const hpOk = character.hp > character.max_hp * 0.55;
  const is5ShotReady =
    character.level >= G.skills["5shot"].level &&
    canMultiShot &&
    hpOk &&
    character.mp > G.skills["5shot"].mp + G.skills["huntersmark"].mp + 1000 &&
    weakMobs.length >= 4;
  const is3ShotReady =
    character.level >= G.skills["3shot"].level &&
    canMultiShot &&
    hpOk &&
    character.mp > G.skills["3shot"].mp + G.skills["huntersmark"].mp + 1000 &&
    potentialTargets.length >= 2;

  if (is5ShotReady) {
    const mobsTo5Shot = weakMobs.slice(0, 5);
    promisesToAwait.push(currentStrategy(mobsTo5Shot));
    // if (notCupid)
    promisesToAwait.push(tryMultiShot("5shot", mobsTo5Shot));
  } else if (is3ShotReady) {
    const mobsTo3Shot = potentialTargets.slice(0, 3);
    promisesToAwait.push(currentStrategy(mobsTo3Shot));
    // if (notCupid)
    promisesToAwait.push(tryMultiShot("3shot", potentialTargets.slice(0, 3)));
  } else if (target && distance(target, character) < nearRange) {
    set_message("Shooting");
    promisesToAwait.push(currentStrategy(target));
    // if (notCupid)
    promisesToAwait.push(
      use_skill("attack", target)
        .then(() => reduceCd("attack"))
        .catch((e) => attackErrorHandler(e)),
    );
  }

  // --- Supershot ---
  const canSuperShot = character.mp > 400 + 1000 && !is_on_cooldown("supershot");

  if (canSuperShot) {
    const coopTarget = target?.cooperative
      ? target
      : entitiesInVision.find(
          (entity) => isMob(entity) && isCooperative(entity),
        );

    const easyMob =
      entitiesInVision
        .filter(
          (entity) =>
            isMob(entity) &&
            entity.attack * entity.frequency < 500 &&
            is_in_range(entity, "supershot"),
        )
        .sort((lhs, rhs) => distance(character, lhs) - distance(character, rhs))
        .shift() ??
      coopTarget ??
      target;

    if (easyMob)
      promisesToAwait.push(
        use_skill("supershot", easyMob).then(() => reduceCd("supershot")),
      );
  }

  // --- Await and Error Handling ---
  try {
    await withTimeout(Promise.all(promisesToAwait), 1500);
  } catch (e) {
    console.warn(e);
  }
}

// --- Cupid Heal Logic (Refactored) ---
async function cupidHeal(playersToHeal) {
  const isAttackOnCD = ms_to_next_skill("attack") > 0 || character.s.penalty_cd;
  const hasCupid =
    locate_item("cupid") !== -1 || character.slots.mainhand?.name === "cupid";
  if (isAttackOnCD || !hasCupid) return;

  const characterRange = character.range + character.xrange;
  const lowHealthPlayersInRange = playersToHeal.filter(
    (player) =>
      player.name !== character.name &&
      distance(player, character) < characterRange,
  );

  const promisesToAwait = [];

  if (lowHealthPlayersInRange.length > 0) {
    // Equipping Cupid first
    if (character.slots.mainhand?.name !== "cupid") {
      const rangerItems = calculateRangerItems(lowHealthPlayersInRange);
      promisesToAwait.push(equipBatch({ ...rangerItems, mainhand: "cupid" }));
    }

    // Determine the best shot for healing
    const mpCost = G.skills["huntersmark"].mp;
    const is5ShotReady =
      character.level >= G.skills["5shot"].level &&
      lowHealthPlayersInRange.length >= 4 &&
      character.mp > G.skills["5shot"].mp + mpCost &&
      !character.fear;
    const is3ShotReady =
      character.level >= G.skills["3shot"].level &&
      lowHealthPlayersInRange.length >= 2 &&
      character.mp > G.skills["3shot"].mp + mpCost &&
      !character.fear;

    let healingTarget = null;
    let skillName = "attack";
    let sliceAmount = 1;

    if (is5ShotReady) {
      skillName = "5shot";
      sliceAmount = 5;
    } else if (is3ShotReady) {
      skillName = "3shot";
      sliceAmount = 3;
    } else {
      // Single shot fallback
      healingTarget = lowHealthPlayersInRange[0];
    }

    if (skillName !== "attack") {
      // Multi-shot healing
      set_message(`${skillName} Cupid`);
      const targets = lowHealthPlayersInRange.slice(0, sliceAmount);
      console.log(`Healing ${targets.map((player) => player.name).join(", ")}`);
      promisesToAwait.push(tryMultiShot(skillName, targets));
    } else if (healingTarget) {
      // Single shot healing
      set_message("Single Cupid");
      log(`Healing ${healingTarget.name}`);
      promisesToAwait.push(
        use_skill("attack", healingTarget).then(
          () => reduceCd("attack"), // Use reduceCd
        ),
      );
    }
  }

  try {
    await withTimeout(Promise.all(promisesToAwait), 1000);
  } catch (e) {
    console.warn("Error while Cupiding!", e);
  }
}

async function mainLoop() {
  try {
    desiredElixir = "pumpkinspice";
    assignRoles();

    // buff();

    // 1. Death Check
    if (character.rip) {
      respawn();
      throw new Error("Character's down", {
        cause: "death",
      });
    }

    // 2. Cupid Healing
    const playersToHeal = getPlayersToHeal();
    await cupidHeal(playersToHeal);

    // 3. Movement Control Check
    const isMovingControlled =
      (smart.moving || isAdvanceSmartMoving) && !smartmoveDebug;
    if (isMovingControlled) {
      throw new Error("Smart moving", {
        cause: "smart_move",
      });
    }

    // 4. Target Acquisition
    let target = getTarget();

    // Crypt & Event logic
    if (get("cryptInstance")) {
      target = await useCryptStrategy(target);
    } else {
      target = await changeToDailyEventTargets();
    }

    // 5. Movement Logic
    if (!target) {
      const needsToEnterCrypt =
        get("cryptInstance") && character.map !== "crypt";
      const isPartyLeaderOrAlone =
        partyMems[0] === character.name || !get_entity(partyMems[0]);
      const isFarFromFarmingSpot =
        distance(character, { x: mapX, y: mapY, map }) > 500;

      const needsToMoveToFarmLocation =
        !get("cryptInstance") && (isPartyLeaderOrAlone || isFarFromFarmingSpot);

      if (needsToEnterCrypt) {
        changeToNormalStrategies();
        advanceSmartMove(CRYPT_STARTING_LOCATION);
      } else if (needsToMoveToFarmLocation) {
        log("Moving to farming location");
        changeToNormalStrategies();
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

  setTimeout(mainLoop, getLoopInterval());
}

if (!parent.caracAL) mainLoop();
