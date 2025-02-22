// Load basic functions from other code snippet
load_code(7);
load_code(8);

// Kiting
var rangeRate = 0.96;

function fight(target) {
  loot();

  if (can_attack(target)) {
    set_message("Attacking");
    // Debuff
    if (
      !target.s.marked &&
      character.mp > 300 &&
      !is_on_cooldown("huntersmark") &&
      target.hp > 3000
    )
      use_skill("huntersmark");

    // Attacks
    if (character.mp > 400 && !is_on_cooldown("supershot"))
      use_skill("supershot", target);
    if (character.mp > 300 && !is_on_cooldown("3shot") && target.attack < 120)
      use_skill("3shot", target);
    attack(target);
  }

  if (!smartmoveDebug) {
    hitAndRun(target, rangeRate);
    angle =
      angle +
      flipRotation *
        Math.asin(
          (character.speed * (1 / character.frequency)) /
            4 /
            (character.range * rangeRate)
        ) *
        2;
  } else {
    angle = undefined;
  }
}

setInterval(async function () {
  loot();
  buff();

  if (character.rip) {
    respawn();
    return;
  }

  if (smart.moving && isAdvanceSmartMoving && !smartmoveDebug) return;

  let target = getTarget();

  //// BOSSES
  if (goToBoss()) return;

  //// EVENTS
  target = await changeToDailyEventTargets();

  //// Logic to targets and farm places
  if (!smart.moving && !isAdvanceSmartMoving && !target)
    advanceSmartMove({
      map,
      x: mapX,
      y: mapY,
    }).catch((e) => use_skill("use_town"));

  fight(target);
}, ((1 / character.frequency) * 1000) / 2);
