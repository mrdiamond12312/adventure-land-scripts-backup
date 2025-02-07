// Load basic functions from other code snippet
load_code(7);
load_code(8);

// Kiting
var rangeRate = 0.8;
const loopInterval = ((1 / character.frequency) * 1000) / 4;

async function fight(target) {
  if (character.rip) {
    respawn();
    return;
  }

  if (can_attack(target)) {
    set_message("Attacking");

    await currentStrategy(target);

    // Awaiting for HEALER to come if fighting bosses
    attack(target).then(() => reduce_cooldown("attack", character.ping * 0.95));

    if (
      !is_on_cooldown("burst") &&
      target.hp > 3000 &&
      target.resistance > 400 &&
      !target["1hp"] &&
      character.mp > 2000
    ) {
      log("Maxima Burst!");
      use_skill("burst");
    }

    if (
      target["damage_type"] === "magical" &&
      !is_on_cooldown("reflection") &&
      partyMems.includes(target.target) &&
      character.mp > 1000
    ) {
      use_skill("reflection", get_entity(target.target));
    }
  }

  // if (character.mp > 2000 && !is_on_cooldown("alchemy") && !isInvFull()) {
  //   const sellableSlot = character.items.findIndex((item) =>
  //     saleAble.includes(item?.name)
  //   );

  //   if (sellableSlot !== -1) {
  //     if (sellableSlot === 0 && saleAble.includes(character.items[0]?.name)) {
  //       use_skill("alchemy");
  //     } else {
  //       swap(0, sellableSlot).then(() => {
  //         if (saleAble.includes(character.items[0]?.name)) use_skill("alchemy");
  //       });
  //     }
  //   }
  // }

  if (!smartmoveDebug) {
    hitAndRun(target, rangeRate);
    angle =
      angle +
      flipRotation *
        Math.asin(
          (character.speed * loopInterval) /
            1000 /
            2 /
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

  if (smart.moving && !smartmoveDebug) return;

  let target = getTarget();

  if (goToBoss()) return;

  //// EVENTS
  target = await changeToDailyEventTargets();

  //// Logic to targets and farm places
  if (!smart.moving && !target && !get_entity(partyMems[0])) {
    log("Moving to farming location");
    smart_move({
      map,
      x: mapX,
      y: mapY,
    }).catch((e) => use_skill("use_town"));
  }

  await fight(target);
}, loopInterval);
