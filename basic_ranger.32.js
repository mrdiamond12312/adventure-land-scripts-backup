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

const isWeak = (monster) =>
  monster.hp < calculateDamage(character, monster) * 0.9 || monster.target;
const isCooperative = (monster) => monster.cooperative;
const isMob = (entity) => entity.type === "monster";
const reduceCd = (skill) => reduce_cooldown(skill, Math.min(...parent.pings));
const tryMultiShot = async (skill, entityList) => {
  if (entityList.length === 0) return false;
  set_message(`${skill} Shooting`);
  return use_skill(skill, entityList)
    .then(() => reduceCd("attack"))
    .catch((e) => attackErrorHandler(e));
};

async function fight(target) {
  if (ms_to_next_skill("attack") > 0) return;

  const canMultiShot = !character.fear;
  const inRange = (entity) => distance(entity, character) < nearRange;
  const nearRange = character.range + character.xrange;
  const explosionRadius = character.explosion
    ? character.explosion / 3.6
    : BLAST_RADIUS;
  const notCupid = character.slots.mainhand?.name !== "cupid";
  const entitiesInVision = Object.values(parent.entities);
  const promisesToAwait = [];

  // Potential and weak mobs
  const potentialTargets = entitiesInVision
    .filter(
      (entity) =>
        entity.type === "monster" &&
        !entity.dead &&
        !entity.rip &&
        inRange(entity) &&
        !entity.s?.fullguardx &&
        (entity.attack * (entity.frequency > 1 ? entity.frequency : 1) < 500 ||
          (entity.cooperative &&
            entity.target &&
            !partyMems.includes(entity.target)) ||
          entity["1hp"] ||
          entity.target),
    )
    .map((entity) => {
      // **Expensive calculation moved here, runs only N times (number of targets), not N log N times.**
      entity.cluster_count = numberOfMonsterAroundTarget(
        entity,
        explosionRadius,
      );
      entity.distance = distance(character, entity);
      return entity;
    })
    .sort((lhs, rhs) => {
      if (lhs.cooperative || (lhs.target && !rhs.target)) return -1;
      if (rhs.cooperative || (rhs.target && !lhs.target)) return 1;

      return (
        rhs.cluster_count - lhs.cluster_count || // Sort by cluster count (highest first)
        rhs.hp - lhs.hp || // Then by HP (lowest first)
        rhs.distance - lhs.distance // Then by distance (closest first)
      );
    });

  const weakMobs = potentialTargets.filter(isWeak);

  if (currentStrategy === usePullStrategies && potentialTargets.length) {
    target = potentialTargets[0];
    change_target(target);
  }

  // Reacquire target if feared
  if (character.fear) {
    const aggroing = potentialTargets.find(
      (mob) => mob.target === character.name,
    );
    if (aggroing) target = aggroing;
  }

  // Carry out the strategy
  promisesToAwait.push(currentStrategy(target));

  // Apply huntersmark if suitable
  if (
    target &&
    !target.s?.marked &&
    character.mp > 300 &&
    !is_on_cooldown("huntersmark") &&
    target.hp > 3000
  ) {
    promisesToAwait.push(
      use_skill("huntersmark", target).then(() => reduceCd("huntersmark")),
    );
  }

  // Find supershot target
  if (character.mp > 400 && !is_on_cooldown("supershot")) {
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

  // Prioritize 5shot > 3shot > single
  if (
    character.level >= G.skills["5shot"].level &&
    canMultiShot &&
    notCupid &&
    character.hp > character.max_hp * 0.55 &&
    character.mp > G.skills["5shot"].mp + G.skills["huntersmark"].mp &&
    weakMobs.length >= 4
  ) {
    promisesToAwait.push(tryMultiShot("5shot", weakMobs.slice(0, 5)));
  } else if (
    character.level >= G.skills["3shot"].level &&
    canMultiShot &&
    notCupid &&
    character.hp > character.max_hp * 0.55 &&
    character.mp > G.skills["3shot"].mp + G.skills["huntersmark"].mp &&
    potentialTargets.length >= 2
  ) {
    promisesToAwait.push(tryMultiShot("3shot", potentialTargets.slice(0, 3)));
  } else if (target && distance(target, character) < nearRange && notCupid) {
    set_message("Shooting");
    promisesToAwait.push(
      attack(target)
        .then(() => reduceCd("attack"))
        .catch((e) => attackErrorHandler(e)),
    );
  }

  try {
    await withTimeout(Promise.all(promisesToAwait), 1500);
  } catch (e) {
    console.log(e);
  }
}

async function cupidHeal(playersToHeal) {
  if (
    (locate_item("cupid") === -1 &&
      character.slots.mainhand?.name !== "cupid") ||
    ms_to_next_skill("attack") > 0
  )
    return;

  const characterRange = character.range + character.xrange;
  // const prioritized = prioritizedNames();

  const lowHealthPlayers = playersToHeal.filter(
    (player) => player.name !== character.name,
  );
  const lowHealthPlayersInRange = lowHealthPlayers.filter(
    (player) => distance(player, character) < characterRange,
  );

  const promisesToAwait = [];

  if (lowHealthPlayersInRange.length > 0) {
    console.log(
      lowHealthPlayersInRange
        .map((player) => `${player.name} (${player.hp}/${player.max_hp})`)
        .join(", "),
    );
    promisesToAwait.push(
      equipBatch({
        mainhand: "cupid",
      }),
    );

    if (
      character.level >= G.skills["5shot"].level &&
      lowHealthPlayersInRange.length >= 4 &&
      character.mp > G.skills["5shot"].mp + G.skills["huntersmark"].mp &&
      !character.fear
    ) {
      set_message("5shot Cupid");
      log(
        `Healing ${lowHealthPlayersInRange
          .slice(0, 5)
          .map((player) => player.name)
          .join(", ")}`,
      );
      promisesToAwait.push(
        tryMultiShot("5shot", lowHealthPlayersInRange.slice(0, 5)),
      );
    } else if (
      character.level >= G.skills["3shot"].level &&
      lowHealthPlayersInRange.length >= 2 &&
      character.mp > G.skills["3shot"].mp + G.skills["huntersmark"].mp &&
      !character.fear
    ) {
      set_message("3shot Cupid");
      log(
        `Healing ${lowHealthPlayersInRange
          .slice(0, 3)
          .map((player) => player.name)
          .join(", ")}`,
      );
      promisesToAwait.push(
        tryMultiShot("3shot", lowHealthPlayersInRange.slice(0, 3)),
      );
    } else if (lowHealthPlayersInRange.length) {
      set_message("Single Cupid");
      log(`Healing ${lowHealthPlayersInRange[0].name}`);
      promisesToAwait.push(
        use_skill("attack", lowHealthPlayersInRange[0]).then(() =>
          reduce_cooldown("attack", Math.min(...parent.pings)),
        ),
      );
    }
  }

  try {
    await withTimeout(Promise.all(promisesToAwait), 1000);
  } catch (e) {
    attackErrorHandler(e);
    console.error("Error while Cupiding!", e);
  }
}

async function mainLoop() {
  try {
    desiredElixir = "pumpkinspice";
    assignRoles();

    // buff();

    if (character.rip) {
      respawn();
      throw new Error("Character's down", {
        cause: "death",
      });
    }

    const playersToHeal = getPlayersToHeal();
    await cupidHeal(playersToHeal);

    if ((smart.moving || isAdvanceSmartMoving) && !smartmoveDebug)
      throw new Error("Smart moving", {
        cause: "smart_move",
      });

    let target = getTarget();

    //// THE CRYPT & EVENTS
    if (get("cryptInstance")) target = await useCryptStrategy(target);
    else target = await changeToDailyEventTargets();

    //// Logic to targets and farm places
    if (!target) {
      if (
        !smart.moving &&
        !isAdvanceSmartMoving &&
        get("cryptInstance") &&
        character.map !== "crypt"
      ) {
        changeToNormalStrategies();
        advanceSmartMove(CRYPT_STARTING_LOCATION);
      } else if (
        !smart.moving &&
        !isAdvanceSmartMoving &&
        !get("cryptInstance") &&
        (partyMems[0] == character.name ||
          !get_entity(partyMems[0]) ||
          distance(character, { x: mapX, y: mapY, map }) > 500)
      ) {
        log("Moving to farming location");
        changeToNormalStrategies();
        advanceSmartMove({
          map,
          x: mapX,
          y: mapY,
        });
      }
    } else await fight(target);
  } catch (e) {
    console.error(e);
  }

  setTimeout(mainLoop, getLoopInterval());
}

if (!parent.caracAL) mainLoop();
