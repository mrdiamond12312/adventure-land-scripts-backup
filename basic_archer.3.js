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
var originRangeRate = 0.7;
var rangeRate = 0.7;
const loopInterval = ((1 / character.frequency) * 1000) / 4;

var rangerTarget = undefined;
var rangerMap = undefined;
var rangerMapX = undefined;
var rangerMapY = undefined;

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
  let currentAction = undefined;

  if (ms_to_next_skill("attack") === 0) {
    set_message("Attacking");

    const suggestedItems = calculateCupidItems();
    if (
      Object.keys(suggestedItems).some(
        (slot) => character.slots[slot]?.name !== suggestedItems[slot],
      )
    ) {
      await equipBatch(suggestedItems);
    }

    // Debuff
    if (
      target &&
      !target.s.marked &&
      character.mp > 300 &&
      !is_on_cooldown("huntersmark") &&
      target.hp > 3000
    )
      use_skill("huntersmark");

    if (character.mp > 400 && !is_on_cooldown("supershot"))
      use_skill(
        "supershot",
        target?.cooperative
          ? target
          : Object.values(parent.entities)
              .filter(
                (entity) =>
                  entity.type === "monster" &&
                  entity.attack * entity.frequency < 500 &&
                  is_in_range(entity, "supershot"),
              )
              .sort(
                (lhs, rhs) =>
                  distance(character, rhs) - distance(character, lhs),
              )
              .shift() ?? target,
      );

    const potentialTargets = Object.values(parent.entities)
      .filter(
        (mobs) =>
          is_in_range(mobs, "attack") &&
          // distance(mobs, character) < character.range + character.xrange &&
          mobs.type === "monster" &&
          !mobs.s?.fullguardx &&
          (mobs.attack * (mobs.frequency > 1 ? mobs.frequency : 1) < 500 ||
            (mobs.cooperative &&
              mobs.target &&
              (!partyMems.includes(mobs.target) || mobs["1hp"])) ||
            mobs.target),
      )
      .sort((lhs, rhs) => {
        if (lhs.cooperative || lhs.target) return -1;
        if (rhs.cooperative || rhs.target) return 1;
        if (lhs.hp === rhs.hp)
          return distance(character, rhs) - distance(character, lhs);
        return lhs.hp - rhs.hp;
      });

    const weakMobs = potentialTargets.filter(
      (mob) => mob.hp < character.attack * 0.6 || mob.target,
    );

    if (
      character.level >= G.skills["5shot"].level &&
      character.mp > G.skills["5shot"].mp &&
      !character.fear &&
      weakMobs.length >= 4 &&
      character.hp > character.max_hp * 0.55 &&
      character.slots.mainhand?.name !== "cupid"
    ) {
      currentAction = "multishot";
      set_message("Five Shooting");
      use_skill("5shot", weakMobs.slice(0, 5)).then(() =>
        reduce_cooldown("attack", Math.min(...parent.pings)),
      );
    } else if (
      character.level >= G.skills["3shot"].level &&
      character.mp > G.skills["3shot"].mp &&
      !character.fear &&
      potentialTargets.length >= 2 &&
      character.hp > character.max_hp * 0.55 &&
      character.slots.mainhand?.name !== "cupid"
    ) {
      currentAction = "multishot";
      set_message("Three Shooting");
      use_skill("3shot", potentialTargets.slice(0, 3)).then(() =>
        reduce_cooldown("attack", Math.min(...parent.pings)),
      );
    } else if (
      distance(target, character) < character.range + character.xrange &&
      character.slots.mainhand?.name !== "cupid"
    ) {
      currentAction = "singleshot";
      set_message("Shooting");
      attack(target).then(() =>
        reduce_cooldown("attack", Math.min(...parent.pings)),
      );
    }

    if (character.fear) {
      target =
        potentialTargets.filter((mob) => mob.target === character.name)[0] ??
        target;
    }
  }

  if (!smartmoveDebug) {
    if (currentAction === "multishot") stop("move");
    // hitAndRun(
    //   Object.keys(parent.entities)
    //     .filter(
    //       (id) =>
    //         parent.entities.type === "monster" &&
    //         parent.entities[id].target === character.name,
    //     )
    //     ?.sort(
    //       (lhs, rhs) =>
    //         distance(character, parent.entities[lhs]) -
    //         distance(character, parent.entities[rhs]),
    //     )[0] ?? target,
    //   rangeRate,
    // );

    // angle =
    //   angle +
    //   flipRotation *
    //     Math.asin(
    //       (character.speed * loopInterval) /
    //         1000 /
    //         2 /
    //         (character.range * rangeRate +
    //           character.xrange * 0.9 +
    //           // extraDistanceWithinHitbox(
    //           //   angle,
    //           //   target ? get_width(target) ?? 0 : 0,
    //           //   target ? get_height(target) ?? 0 : 0
    //           // ))
    //           extraDistanceWithinHitbox(target) +
    //           extraDistanceWithinHitbox(character)),
    //     ) *
    //     2;
  } else {
    angle = undefined;
  }
}

setInterval(async function () {
  // if (
  //   (bestLooter().name === character.name || !bestLooter()) &&
  //   Object.keys(get_chests()).length
  // )
  //   loot();

  buff();

  if (character.rip) {
    respawn();
    return;
  }

  await cupidHeal();

  if ((smart.moving || isAdvanceSmartMoving) && !smartmoveDebug) return;

  if (character.fear) {
    await scareAwayMobs();
  }

  let target = getRangerTarget() || getTarget();

  //// BOSSES
  if (goToBoss()) return;

  //// EVENTS
  target = (await changeToDailyEventTargets()) ?? getRangerTarget();

  //// Logic to targets and farm places
  if (
    !smart.moving &&
    !isAdvanceSmartMoving &&
    !target &&
    (partyMems[0] == character.name || !get_entity(partyMems[0]))
  ) {
    const scareInterval = setInterval(() => {
      scareAwayMobs();
    }, 5000);
    changeToNormalStrategies();
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
}, loopInterval);
