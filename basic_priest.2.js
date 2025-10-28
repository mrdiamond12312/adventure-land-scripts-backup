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
  // Make Priest prior mobs without poison effect that attacking the party, to reduce their attack spped
  const partyDmgRecieved = avgPartyDmgTaken(partyMems);
  const targetToTaunt =
    isAssignedAsTanker() && currentStrategy === usePullStrategies
      ? Object.values(parent.entities)
          .filter(
            (mob) =>
              mob.type === "monster" &&
              !mob.target &&
              is_in_range(mob, "attack") &&
              partyDmgRecieved + calculateDamage(mob, character) <
                character.heal * 0.9 * character.frequency,
          )
          .sort(
            (lhs, rhs) => distance(lhs, character) - distance(rhs, character),
          )
          .shift()
      : null;

  const targetToAttack =
    character.slots.orb?.name === "test_orb"
      ? Object.values(parent.entities)
          .filter(
            (mob) =>
              mob.type === "monster" &&
              !mob.s.poisoned &&
              is_in_range(mob, "attack") &&
              partyMems.includes(mob.target),
          )
          .sort((lhs, rhs) => lhs.attack - rhs.attack)
          .pop() ?? target
      : target;
  target = targetToTaunt ?? targetToAttack;
  change_target(target);

  const promisesToAwait = [];

  if (
    target &&
    !target.s.curse &&
    character.mp > 1100 &&
    !is_on_cooldown("curse") &&
    is_in_range(target, "curse") &&
    target.max_hp > 3000
  )
    promisesToAwait.push(
      withTimeout(use_skill("curse", target), 2500).then(() =>
        reduce_cooldown("curse", Math.min(...parent.pings)),
      ),
    );

  if (
    target &&
    shouldAttack() &&
    !is_on_cooldown("darkblessing") &&
    character.mp > G.skills["darkblessing"].mp &&
    !character.s?.darkblessing
  )
    promisesToAwait.push(
      withTimeout(use_skill("darkblessing"), 2500).then(() =>
        reduce_cooldown("darkblessing", Math.min(...parent.pings)),
      ),
    );

  if (
    !character.s.penalty_cd &&
    ms_to_next_skill("attack") === 0 &&
    distance(target, character) <
      character.range +
        character.xrange +
        extraDistanceWithinHitbox(target) +
        extraDistanceWithinHitbox(character) &&
    shouldAttack()
  ) {
    set_message("Attacking");
    promisesToAwait.push(
      currentStrategy(target),
      withTimeout(attack(target), 2500)
        .then(() => {
          reduce_cooldown("attack", Math.min(...parent.pings));
        })
        .catch((e) => {
          attackErrorHandler(e);
        }),
    );
  }

  try {
    await withTimeout(Promise.all(promisesToAwait), 2500);
  } catch (e) {}
}

async function priestBuff() {
  const promises = [];

  if (ms_to_next_skill("attack") === 0) {
    const buffees = getPlayersToHeal();

    if (buffees.length) {
      for (const buffee of buffees) {
        if (
          !smart.moving &&
          distance(buffee, character) >=
            character.range + character.xrange * 0.9 &&
          prioritizedNames().includes(buffee.name)
        ) {
          promises.push(
            move((buffee.x + character.x) / 2, (buffee.y + character.y) / 2),
          );
          continue;
        }

        if (
          distance(buffee, character) <
          character.range + character.xrange * 0.9
        ) {
          try {
            promises.push(
              currentStrategy(buffee),
              withTimeout(
                heal(buffee).then(() => {
                  reduce_cooldown("attack", Math.min(...parent.pings));
                }),
              ),
            );
          } catch (e) {}
          set_message("Heal " + buffee.name);
          break;
        }
      }
    }
  }

  const allies = parent.party_list
    .map((name) => get_entity(name))
    .filter((visible) => visible);
  if (
    allies.length &&
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
        reduce_cooldown("partyheal", Math.min(...parent.pings)),
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
          Object.values(parent.entities).filter(
            (entity) => entity.type === "monster" && entity.target === member,
          ).length >= (isAssignedAsTanker() ? 1 : 2)
        ) {
          use_skill("absorb", get_entity(member));

          set_message("Absorb " + member);
        }
    });

  return Promise.all(promises);
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

    await priestBuff();

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
        !get("cryptInstance") &&
        (partyMems[0] == character.name ||
          !get_entity(partyMems[0]) ||
          distance(character, { x: mapX, y: mapY, map }) > 500)
      ) {
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
