// Load basic functions from other code snippet
load_code(7);
load_code(8);

// Kiting
var rangeRate = 0.76;

function fight(target) {
  if (character.rip) {
    respawn();
    return;
  }

  if (can_attack(target)) {
    set_message("Attacking");
    attack(target);
    if (
      !is_on_cooldown("burst") &&
      target.hp > 3000 &&
      target.resistance > 400 &&
      character.mp > 2000
    ) {
      log("Maxima Burst!");
      use_skill("burst");
    }

    // if (
    //   !is_on_cooldown("cburst") &&
    //   character.mp > 1000 &&
    //   get_targeted_monster().hp < 200 &&
    //   !get_targeted_monster().hp?.["1hp"]
    // ) {
    //   use_skill("cburst", [[get_targeted_monster(), target.hp * 2]]);
    // }

    if (!is_on_cooldown("energize") && character.mp > 1200) {
      const buffee = getLowestMana();
      if (buffee.max_mp - buffee.mp > 500 && buffee.mp < buffee.max_mp * 0.5) {
        log("Energize " + buffee?.name);
        use_skill("energize", buffee);
      } else {
        use_skill("energize", get_entity(partyMems[0]));
      }
    }
    if (
      target["damage_type"] === "magical" &&
      !is_on_cooldown("reflection") &&
      partyMems.includes(target.target) &&
      character.mp > 1000
    ) {
      use_skill("reflection", get_entity(target.target));
    }
    if (
      character.mp > 100 &&
      !is_on_cooldown("scare") &&
      target.max_hp > 3000 &&
      Object.keys(parent.entities).some(
        (entity) => parent.entities[entity]?.target === character.name
      )
    )
      use_skill("scare");
  }

  if (character.mp > 2000 && !is_on_cooldown("alchemy") && !isInvFull()) {
    const sellableSlot = character.items.findIndex((item) =>
      saleAble.includes(item?.name)
    );

    if (sellableSlot !== -1) {
      if (sellableSlot === 0) {
        use_skill("alchemy");
      } else {
        swap(0, sellableSlot).then(() => use_skill("alchemy"));
      }
    }
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

setInterval(function () {
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
  target = changeToDailyEventTargets();

  //// Logic to targets and farm places
  if (!smart.moving && !target && !get_entity(partyMems[0]))
    smart_move({
      map,
      x: mapX,
      y: mapY,
    }).catch((e) => use_skill("use_town"));

  fight(target);
}, ((1 / character.frequency) * 1000) / 2);
