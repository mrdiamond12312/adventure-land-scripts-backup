// Load basic functions from other code snippet
load_code(7);
load_code(8);

// Kiting
var basicRangeRate = 0.8;
var rangeRate = 0.8;
const loopInterval = ((1 / character.frequency) * 1000) / 3;

async function fight(target) {
  if (character.rip) {
    respawn();
    return;
  }

  aggroedMobs = Object.values(parent.entities).filter((mob) => {
    return (
      !haveFormidableMonsterAroundTarget(mob) &&
      is_in_range(mob, "attack") &&
      mob.target === TANKER &&
      mob.type === "monster"
    );
  });

  if (target && target.type !== "monster" && aggroedMobs.length) {
    target =
      aggroedMobs.sort((lhs, rhs) => {
        const lhsNumberOfSurrounding = numberOfMonsterAroundTarget(
          parent.entities[lhs]
        );
        const rhsNumberOfSurrounding = numberOfMonsterAroundTarget(
          parent.entities[rhs]
        );
        if (lhsNumberOfSurrounding === rhsNumberOfSurrounding)
          return parent.entities[rhs]?.hp - parent.entities[lhs]?.hp;
        return rhsNumberOfSurrounding - lhsNumberOfSurrounding;
      })[0] ?? undefined;
    change_target(target);
  }
  const shouldAttack = character.map === "crypt" ? get_entity(HEALER) : true;
  if (can_attack(target) && shouldAttack) {
    set_message("Attacking");

    await currentStrategy(target);

    // Awaiting for HEALER to come if fighting bosses
    if (!is_on_cooldown("attack")) {
      attack(target).then(() =>
        reduce_cooldown("attack", character.ping * 0.95)
      );
    }

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
  // loot();
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

  if (character.level > 50) {
    set("mageLocation", {
      map: character.map,
      x: character.x,
      y: character.y,
    });
  }
  if ((smart.moving || isAdvanceSmartMoving) && !smartmoveDebug) return;

  let target = getTarget();

  if (goToBoss()) return;

  //// THE CRYPT & EVENTS
  if (get("cryptInstance")) target = await useCryptStrategy(target);
  else target = await changeToDailyEventTargets();

  //// Logic to targets and farm places
  if (get("cryptInstance") && character.map !== "crypt") {
    await advanceSmartMove(CRYPT_DOOR);
    enter("crypt", get("cryptInstance"));
  } else if (
    !smart.moving &&
    !isAdvanceSmartMoving &&
    !target &&
    !get_entity(partyMems[0])
  ) {
    log("Moving to farming location");
    const scareInterval = setInterval(() => {
      scareAwayMobs();
    }, 5000);
    await advanceSmartMove({
      map,
      x: mapX,
      y: mapY,
    });
    clearInterval(scareInterval);
  }

  await fight(target);
}, loopInterval);
