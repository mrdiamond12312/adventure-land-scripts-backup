// Load basic functions from other code snippet
if (parent.caracAL) {
  parent.caracAL
    .load_scripts([
      "adventure-land-scripts-backup/basic_function.7.js",
      "adventure-land-scripts-backup/other_class_msg_listener.8.js",
    ])
    .then(() => {
      mainLoop();
      fuaLoop();
    });
} else {
  load_code(7);
  load_code(8);
}

// Kiting
var originRangeRate = 0.85;
rangeRate = originRangeRate;

var rangerTarget = ["phoenix", "crab", "squig"];
var rangerMap = "main";
var rangerMapX = -1163;
var rangerMapY = 74;

function getRangerTarget() {
  if (rangerTarget && rangerTarget.length) {
    for (const monsterName of rangerTarget) {
      const monsterInstance = get_nearest_monster({ type: monsterName });
      if (monsterInstance) return monsterInstance;
    }
  }
  return undefined;
}

async function fight(target) {
  // Early exit if attack is still on cooldown
  if (ms_to_next_skill("attack") > 0) return;

  const attackReady = ms_to_next_skill("attack") === 0;
  const canAct = attackReady && !character.fear;
  const nearRange = character.range + character.xrange;
  const explosionRadius = character.explosion
    ? character.explosion / 3.6
    : BLAST_RADIUS;
  const inRange = (entity) => distance(entity, character) < nearRange;
  const isWeak = (monster) =>
    monster.hp < calculateDamage(character, monster) * 0.9 || monster.target;
  const isCooperative = (monster) => monster.cooperative;
  const isMob = (entity) => entity.type === "monster";
  const notCupid = character.slots.mainhand?.name !== "cupid";
  const entitiesInVision = Object.values(parent.entities);
  const reduceCd = (skill) => reduce_cooldown(skill, Math.min(...parent.pings));
  const promisesToAwait = [];

  // Potential and weak mobs
  const potentialTargets = Object.values(parent.entities)
    .filter(
      (m) =>
        m.type === "monster" &&
        inRange(m) &&
        !m.s?.fullguardx &&
        (m.attack * (m.frequency > 1 ? m.frequency : 1) < 500 ||
          (m.cooperative && m.target && !partyMems.includes(m.target)) ||
          m["1hp"] ||
          m.target),
    )
    .sort((lhs, rhs) => {
      if (lhs.cooperative || (lhs.target && !rhs.target)) return -1;
      if (rhs.cooperative || (rhs.target && !lhs.target)) return 1;
      return (
        numberOfMonsterAroundTarget(rhs, explosionRadius) -
          numberOfMonsterAroundTarget(lhs, explosionRadius) ||
        lhs.hp - rhs.hp ||
        distance(character, lhs) - distance(character, rhs)
      );
    });

  const weakMobs = potentialTargets.filter(isWeak);
  console.log(potentialTargets.map((entity) => entity.id));
  console.log(weakMobs.map((entity) => entity.id));

  if (currentStrategy === usePullStrategies && potentialTargets.length)
    target = potentialTargets[0];

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

  // === Handle multishot logic ===

  const tryMultiShot = async (skill, mobs) => {
    if (!canAct || mobs.length === 0) return false;
    set_message(`${skill} Shooting`);
    // log(`Using ${skill} on ${mobs.map((m) => m.id).join(", ")}`);
    return use_skill(skill, mobs)
      .then(() => reduceCd("attack"))
      .catch((e) => attackErrorHandler(e));
  };

  // Prioritize 5shot > 3shot > single
  if (
    character.level >= G.skills["5shot"].level &&
    notCupid &&
    character.hp > character.max_hp * 0.55 &&
    character.mp > G.skills["5shot"].mp + G.skills["huntersmark"].mp &&
    weakMobs.length >= 4
  ) {
    promisesToAwait.push(tryMultiShot("5shot", weakMobs.slice(0, 5)));
  } else if (
    character.level >= G.skills["3shot"].level &&
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

    await cupidHeal();

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
