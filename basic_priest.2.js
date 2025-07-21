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
var originRangeRate = 0.5;
var rangeRate = 0.5;
const loopInterval = ((1 / character.frequency) * 1000) / 4;

async function fight(target) {
  if (can_attack(target) && shouldAttack()) {
    set_message("Attacking");
    currentStrategy(target);

    // Make Priest prior mobs without poison effect that attacking the party, to reduce their attack spped
    const targetToAttack =
      character.slots.orb?.name === "test_orb"
        ? Object.values(parent.entities)
            .filter(
              (mob) =>
                !mob.s.poisoned &&
                is_in_range(mob, "attack") &&
                mob.type === "monster" &&
                partyMems.includes(mob.target),
            )
            .sort((lhs, rhs) => lhs.attack - rhs.attack)
            .pop() ?? target
        : target;
    change_target(targetToAttack);

    attack(targetToAttack).then(() =>
      reduce_cooldown("attack", Math.min(parent.pings)),
    );
    reduce_cooldown("attack", ((-1 / character.frequency) * 1000) / 2);

    if (
      target &&
      !is_on_cooldown("darkblessing") &&
      character.mp > G.skills["darkblessing"].mp &&
      !character.s?.darkblessing
    )
      use_skill("darkblessing");
  }

  if (
    target &&
    character.mp > 1100 &&
    !is_on_cooldown("curse") &&
    is_in_range(target, "curse") &&
    target.max_hp > 3000
  )
    use_skill("curse", target);

  if (!smartmoveDebug) {
    hitAndRun(target, rangeRate);

    angle =
      angle +
      flipRotation *
        Math.asin(
          (character.speed * getLoopInterval()) /
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

async function priestBuff() {
  const buffee = getLowestHealth();
  if (buffee.hp < buffee.max_hp - buffThreshold * character.heal) {
    if (!is_in_range(buffee, "heal") && !smart.moving) move(buffee.x, buffee.y);
    if (!is_on_cooldown("heal")) {
      if (
        !character.slots.mainhand ||
        ["broom", "froststaff"].includes(character.slots.mainhand?.name) ||
        !character.slots.mainhand.level
      ) {
        equipBatch({
          mainhand:
            character.name === TANKER
              ? "pmace"
              : character.map === "crypt"
              ? "pmace"
              : "oozingterror",
          orb: "jacko",
        });
      } else {
        equipBatch({
          orb: "jacko",
        });
      }
      use_skill("heal", buffee).then(() => {
        reduce_cooldown("attack", Math.min(...parent.pings));
      });
      reduce_cooldown("attack", ((-1 / character.frequency) * 1000) / 2);

      set_message("Heal " + buffee.name);
    }
  }

  const allies = parent.party_list
    .map((name) => get_entity(name))
    .filter((visible) => visible);
  if (
    allies?.length &&
    (allies.some(
      (ally) =>
        (ally.hp < ally.max_hp - character.level * 10 * 2 &&
          !is_in_range(ally, "heal")) ||
        ally.hp < ally.max_hp * 0.3,
    ) ||
      allies.every((ally) => ally.hp < ally.max_hp - character.level * 10 * 2))
  ) {
    if (!is_on_cooldown("partyheal") && character.mp > 1000) {
      use_skill("partyheal").then(() =>
        reduce_cooldown("partyheal", character.ping * 0.95),
      );
      set_message("Party Heal");
    }
  }
  partyMems
    .filter((member) => member !== character.name && member !== TANKER)
    .map((member) => {
      if (
        Object.values(parent.entities).some(
          (entity) => entity.target === member,
        )
      )
        if (
          is_in_range(get_entity(member), "absorb") &&
          !is_on_cooldown("absorb") &&
          character.mp > G.skills["absorb"].mp &&
          (get_entity(member).ctype !== "warrior" ||
            Object.values(parent.entities).filter(
              (entity) => entity.type === "monster" && entity.target === member,
            ).length > 2)
        ) {
          use_skill("absorb", get_entity(member));

          set_message("Absorb " + member);
        }
    });
}

async function mainLoop() {
  try {
    assignRoles();

    if (character.rip) {
      respawn();
      throw new Error("Character's down", {
        cause: "death",
      });
    }

    priestBuff();

    if ((smart.moving || isAdvanceSmartMoving) && !smartmoveDebug)
      throw new Error("Smart moving", {
        cause: "smart_move",
      });

    let target = getTarget();

    //// BOSSES
    // if (goToBoss()) return;

    //// THE CRYPT & EVENTS
    if (get("cryptInstance")) target = await useCryptStrategy(target);
    else target = await changeToDailyEventTargets();

    //// Logic to targets and farm places
    if (!target) {
      if (
        !smart.move &&
        !isAdvanceSmartMoving &&
        get("cryptInstance") &&
        character.map !== "crypt"
      ) {
        changeToNormalStrategies();
        await advanceSmartMove(CRYPT_STARTING_LOCATION);
      } else if (
        !smart.moving &&
        !get("cryptInstance") &&
        (partyMems[0] == character.name ||
          !get_entity(partyMems[0]) ||
          character.map === "crypt" ||
          distance(character, { x: mapX, y: mapY, map }) > 500)
      ) {
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
    } else fight(target);
  } catch (e) {
    console.error(e);
  }

  setTimeout(mainLoop, getLoopInterval());
}

if (!parent.caracAL) mainLoop();

// setInterval(async function () {
//   assignRoles();

//   if (character.rip) {
//     respawn();
//     return;
//   }

//   priestBuff();

//   if ((smart.moving || isAdvanceSmartMoving) && !smartmoveDebug) return;

//   let target = getTarget();

//   //// BOSSES
//   if (goToBoss()) return;

//   //// THE CRYPT & EVENTS
//   if (get("cryptInstance")) target = await useCryptStrategy(target);
//   else target = await changeToDailyEventTargets();

//   //// Logic to targets and farm places
//   if (
//     !smart.move &&
//     !isAdvanceSmartMoving &&
//     get("cryptInstance") &&
//     character.map !== "crypt" &&
//     !target
//   ) {
//     changeToNormalStrategies();
//     await advanceSmartMove(CRYPT_STARTING_LOCATION);
//   } else if (
//     !smart.moving &&
//     !target &&
//     !get("cryptInstance") &&
//     (partyMems[0] == character.name ||
//       !get_entity(partyMems[0]) ||
//       character.map === "crypt" ||
//       distance(character, { x: mapX, y: mapY, map }) > 500)
//   ) {
//     changeToNormalStrategies();
//     const scareInterval = setInterval(() => {
//       scareAwayMobs();
//     }, 5000);
//     await advanceSmartMove({
//       map,
//       x: mapX,
//       y: mapY,
//     });
//     clearInterval(scareInterval);
//   }

//   await fight(target);
// }, loopInterval);
