// Load basic functions from other code snippet
load_code(7);
load_code(8);

// Kiting
var rangeRate = 0.7;

var rangerTarget = ["cgoo"];
var rangerMap = "level2s";
var rangerMapX = 9;
var rangerMapY = 432;

function getRangerTarget() {
  if (rangerTarget && rangerTarget.length) {
    for (const monsterName of rangerTarget) {
      const monsterInstance = get_nearest_monster({ type: monsterName });
      if (monsterInstance) return monsterInstance;
    }
  }
  return undefined;
}
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
    // if (character.mp > 400 && !is_on_cooldown("supershot"))
    //   use_skill("supershot", target);
    const targetsToThreeshot = Object.keys(parent.entities)
      .sort((lhs, rhs) => {
        if (parent.entities[lhs].hp === parent.entities[rhs].hp)
          return (
            distance(character, parent.entities[rhs]) -
            distance(character, parent.entities[lhs])
          );
        return parent.entities[lhs].hp - parent.entities[rhs].hp;
      })
      ?.slice(0, 3)
      .map((id) => parent.entities[id]);
    if (
      character.mp > 500 &&
      !character.fear &&
      targetsToThreeshot.filter((target) => is_in_range(target, "attack"))
        .length >= 2 &&
      !is_on_cooldown("3shot") &&
      target.attack < 400 &&
      character.hp > character.max_hp * 0.55
    )
      use_skill("3shot", targetsToThreeshot).then(() =>
        reduce_cooldown("attack", character.ping * 0.95)
      );

    if (!is_on_cooldown("attack"))
      attack(
        Object.keys(parent.entities)
          .sort((lhs, rhs) => {
            if (parent.entities[lhs].hp === parent.entities[rhs].hp)
              return (
                distance(character, parent.entities[rhs]) -
                distance(character, parent.entities[lhs])
              );
            return parent.entities[lhs].hp - parent.entities[rhs].hp;
          })
          .map((id) => parent.entities[id])?.[0]
      ).then(() => reduce_cooldown("attack", character.ping * 0.95));
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
            8 /
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

  let target = getRangerTarget() || getTarget();

  //// BOSSES
  if (goToBoss()) return;

  //// EVENTS
  target = (await changeToDailyEventTargets()) ?? getRangerTarget();

  //// Logic to targets and farm places
  if (!smart.moving && !target)
    smart_move({
      map: rangerMap || map,
      x: rangerMapX || mapX,
      y: rangerMapY || mapY,
    }).catch((e) => use_skill("use_town"));

  if (character.hp < 0.6 * character.max_hp && !get_entity(HEALER)) {
    send_cm(HEALER, "party_heal");
  }

  fight(target);
}, ((1 / character.frequency) * 1000) / 4);
