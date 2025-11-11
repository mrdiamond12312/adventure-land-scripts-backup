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
  const characterBufferedRange = character.range + character.xrange;

  const targetToTaunt =
    isAssignedAsTanker() && currentStrategy === usePullStrategies
      ? Object.values(parent.entities)
          .filter(
            (mob) =>
              mob.type === "monster" &&
              !mob.dead &&
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
    character.slots.orb?.name === "test_orb" && !target.cooperative
      ? Object.values(parent.entities)
          .filter(
            (mob) =>
              mob.type === "monster" &&
              !mob.s.poisoned &&
              !mob.dead &&
              mob.hp &&
              distance(character, mob) < characterBufferedRange &&
              (parent.party_list && parent.party_list.length > 0
                ? parent.party_list
                : partyMems
              ).includes(mob.target),
          )
          .sort((lhs, rhs) => rhs.attack - lhs.attack)
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
  const minPing = () => Math.min(...parent.pings);

  // --- Single Target Heal (Attack Cooldown) ---
  if (ms_to_next_skill("attack") === 0) {
    const buffees = getPlayersToHeal();

    for (const buffee of buffees) {
      const characterBufferedRange = character.range + character.xrange * 0.9;
      const distanceToTarget = distance(buffee, character);

      // If too far, and a party member (prioritized), move closer.
      if (
        !smart.moving &&
        distanceToTarget >= characterBufferedRange &&
        prioritizedNames().includes(buffee.name)
      ) {
        // To the midpoint between the priest and the target
        promises.push(
          move((buffee.x + character.x) / 2, (buffee.y + character.y) / 2),
        );
        set_message("Moving to heal " + buffee.name);
        continue; // Stop and wait for movement
      }

      // If in range, heal and stop the loop.
      if (distanceToTarget < characterBufferedRange) {
        try {
          promises.push(currentStrategy(buffee));
          promises.push(
            withTimeout(
              heal(buffee).then(() => {
                reduce_cooldown("attack", minPing());
              }),
            ),
          );
          set_message("Heal " + buffee.name);
        } catch (e) {
          // console.error("Heal failed:", e);
        }
        break; // Heal one target and wait for the next attack cooldown
      }
    }
  }

  // --- Party Heal Logic ---
  const allies = parent.party_list
    .map((name) => get_entity(name))
    .filter((visible) => visible);

  if (!is_on_cooldown("partyheal") && character.mp > 1000 && allies.length) {
    // Condition for Party Heal:
    // any ally is critically low (under 30% HP) OR out of single-heal range while moderately injured.
    // OR All allies are moderately injured (HP < max_hp - character.level * 20).
    const moderatelyInjuredThreshold = character.level * 20;

    const shouldPartyHeal =
      allies.some(
        (ally) =>
          ally.hp < ally.max_hp * 0.3 || // Critically low
          (ally.hp < ally.max_hp - moderatelyInjuredThreshold &&
            !is_in_range(ally, "heal")), // Moderately low & out of range
      ) ||
      allies.every(
        (ally) => ally.hp < ally.max_hp - moderatelyInjuredThreshold, // All moderately low
      );

    if (shouldPartyHeal) {
      use_skill("partyheal").then(() =>
        reduce_cooldown("partyheal", minPing()),
      );
      set_message("Party Heal");
    }
  }

  // --- Absorb Skill Logic ---
  const vulnerableMembers = partyMems.filter(
    (member) => member !== character.name && member !== TANKER,
  );

  for (const memberName of vulnerableMembers) {
    const member = get_entity(memberName);
    if (!member) continue;

    const monstersTargetingMember = Object.values(parent.entities).filter(
      (entity) => entity.type === "monster" && entity.target === memberName,
    );

    const requiredMonsterCount = isAssignedAsTanker() ? 1 : 2;

    if (
      is_in_range(member, "absorb") &&
      !is_on_cooldown("absorb") &&
      character.mp >= G.skills["absorb"].mp &&
      monstersTargetingMember.length >= requiredMonsterCount
    ) {
      use_skill("absorb", member);
      set_message("Absorb " + memberName);
      break; // Absorb one target and move on
    }
  }

  return withTimeout(Promise.all(promises), 750);
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
