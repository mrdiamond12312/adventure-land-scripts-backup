// Load basic functions from other code snippet
load_code(7);
load_code(8);

// Kiting
var basicRangeRate = 0.7;
var rangeRate = 0.7;

var rangerTarget = ["rat"];
var rangerMap = "mansion";
var rangerMapX = -9;
var rangerMapY = -268;

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
  // loot();

  if (can_attack(target)) {
    set_message("Attacking");

    await currentStrategy(target);
    // Debuff
    if (
      !target.s.marked &&
      character.mp > 300 &&
      !is_on_cooldown("huntersmark") &&
      target.hp > 3000
    )
      use_skill("huntersmark");

    // Attacks
    // if (character.mp > 400 && !is_on_cooldown("supershot"))
    //   use_skill("supershot", target);
    const potentialTargets = Object.values(parent.entities)
      .filter(
        (mobs) =>
          is_in_range(mobs, "attack") &&
          mobs.type === "monster" &&
          mobs.attack * (mobs.frequency > 1 ? mobs.frequency : 1) < 500
      )
      .sort((lhs, rhs) => {
        if (lhs.hp === rhs.hp)
          return distance(character, rhs) - distance(character, lhs);
        return lhs.hp - rhs.hp;
      });

    const weakMobs = potentialTargets.filter(
      (mob) =>
        mob.max_hp < character.attack * 0.6 || mob.target !== character.name
    );
    if (
      character.mp > 400 &&
      !character.fear &&
      weakMobs.length >= 4 &&
      !is_on_cooldown("5shot") &&
      character.hp > character.max_hp * 0.55
    )
      use_skill("5shot", weakMobs.slice(0, 5)).then(() =>
        reduce_cooldown("attack", character.ping * 0.95)
      );

    if (
      character.mp > 500 &&
      !character.fear &&
      potentialTargets.length >= 2 &&
      !is_on_cooldown("3shot") &&
      target.attack < 400 &&
      character.hp > character.max_hp * 0.55
    )
      use_skill("3shot", potentialTargets.slice(0, 3)).then(() =>
        reduce_cooldown("attack", character.ping * 0.95)
      );

    if (character.fear) {
      target =
        potentialTargets.filter((mob) => mob.target === character.name)[0] ??
        target;
    }

    if (!is_on_cooldown("attack"))
      attack(target).then(() =>
        reduce_cooldown("attack", character.ping * 0.95)
      );
  } else {
    if (character.fear) await scareAwayMobs();
  }

  if (!smartmoveDebug) {
    hitAndRun(
      Object.keys(parent.entities)
        .filter(
          (id) =>
            parent.entities.type === "monster" &&
            parent.entities[id].target === character.name
        )
        ?.sort(
          (lhs, rhs) =>
            distance(character, parent.entities[lhs]) -
            distance(character, parent.entities[rhs])
        )[0] ?? target,
      rangeRate
    );
    angle =
      angle +
      flipRotation *
        Math.asin(
          (character.speed * (1 / character.frequency)) /
            6 /
            (character.range * rangeRate)
        ) *
        2;
  } else {
    angle = undefined;
  }
}

setInterval(async function () {
  if (
    (bestLooter().name === character.name || !bestLooter()) &&
    Object.keys(get_chests()).length
  )
    loot();

  buff();

  if (character.rip) {
    respawn();
    return;
  }

  if ((smart.moving || isAdvanceSmartMoving) && !smartmoveDebug) return;

  let target = getRangerTarget() || getTarget();

  //// BOSSES
  if (goToBoss()) return;

  //// EVENTS
  target = (await changeToDailyEventTargets()) ?? getRangerTarget();

  //// Logic to targets and farm places
  if (!smart.moving && !isAdvanceSmartMoving && !target) {
    const scareInterval = setInterval(() => {
      scareAwayMobs();
    }, 5000);
    await advanceSmartMove({
      map: rangerMap || map,
      x: rangerMapX || mapX,
      y: rangerMapY || mapY,
    });
    clearInterval(scareInterval);
  }

  if (character.hp < 0.6 * character.max_hp && !get_entity(HEALER)) {
    send_cm(HEALER, "party_heal");
  }

  await fight(target);
}, ((1 / character.frequency) * 1000) / 3);
