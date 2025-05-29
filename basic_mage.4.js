// Load basic functions from other code snippet

if (parent.caracAL) {
  parent.caracAL.load_scripts([
    "adventure-land-scripts-backup/basic_function.7.js",
    "adventure-land-scripts-backup/other_class_msg_listener.8.js",
  ]);
} else {
  load_code(7);
  load_code(8);
}

// Kiting
var originRangeRate = 0.9;
rangeRate = originRangeRate;
const loopInterval = Math.floor(((1 / character.frequency) * 1000) / 5);

async function fight(target) {
  if (currentStrategy === usePullStrategies) {
    aggroedMobs = Object.values(parent.entities).filter((mob) => {
      return (
        !haveFormidableMonsterAroundTarget(mob) &&
        distance(mob, character) <
          character.range +
            character.xrange * 0.4 +
            extraDistanceWithinHitbox(mob) +
            extraDistanceWithinHitbox(character) &&
        mob.target &&
        mob.type === "monster"
      );
    });

    if (aggroedMobs.length) {
      target =
        aggroedMobs
          .sort((lhs, rhs) => {
            const lhsNumberOfSurrounding = numberOfMonsterAroundTarget(
              lhs,
              character.blast / 3.6 || BLAST_RADIUS,
            );
            const rhsNumberOfSurrounding = numberOfMonsterAroundTarget(
              rhs,
              character.blast / 3.6 || BLAST_RADIUS,
            );
            if (lhsNumberOfSurrounding === rhsNumberOfSurrounding)
              return rhs.hp - lhs.hp;
            return rhsNumberOfSurrounding - lhsNumberOfSurrounding;
          })
          .shift() ?? target;
      change_target(target);
    }
  }

  if (!target) return;

  const shouldAttack = character.map === "crypt" ? get_entity(HEALER) : true;

  if (
    ms_to_next_skill("attack") === 0 &&
    distance(target, character) <
      character.range +
        character.xrange +
        extraDistanceWithinHitbox(target) +
        extraDistanceWithinHitbox(character) &&
    shouldAttack
  ) {
    set_message("Attacking");

    currentStrategy(target);

    attack(target).then(() =>
      reduce_cooldown("attack", Math.min(...parent.pings)),
    );

    if (
      target &&
      !is_on_cooldown("burst") &&
      target.hp > 3000 &&
      target.resistance > 400 &&
      target.avoidence < 95 &&
      !target["1hp"] &&
      character.mp > 4000
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
            (character.range * rangeRate +
              character.xrange * 0.9 +
              // extraDistanceWithinHitbox(
              //   angle,
              //   target ? get_width(target) ?? 0 : 0,
              //   target ? get_height(target) ?? 0 : 0
              // ))
              extraDistanceWithinHitbox(target) +
              extraDistanceWithinHitbox(character)),
        ) *
        2;
  } else {
    angle = undefined;
  }
}

setInterval(async function () {
  desiredElixir = "pumpkinspice";
  assignRoles();

  buff();

  if (character.rip) {
    respawn();
    return;
  }

  if (character.level > 50) {
    set("mageLocation", {
      mp: character.mp,
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
  if (
    !smart.move &&
    !isAdvanceSmartMoving &&
    get("cryptInstance") &&
    character.map !== "crypt" &&
    !target
  ) {
    changeToNormalStrategies();
    await advanceSmartMove(CRYPT_STARTING_LOCATION);
  } else if (
    !smart.moving &&
    !isAdvanceSmartMoving &&
    !target &&
    !get("cryptInstance") &&
    (partyMems[0] == character.name ||
      !get_entity(partyMems[0] || character.map === "crypt"))
  ) {
    log("Moving to farming location");
    changeToNormalStrategies();
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
