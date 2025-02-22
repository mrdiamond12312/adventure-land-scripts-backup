// Load basic functions from other code snippet
load_code(7);
load_code(8);

// Kiting
var basicRangeRate = 0.5;
var rangeRate = 0.5;

async function fight(target) {
  const shouldAttack = character.map === "crypt" ? get_entity(HEALER) : true;
  if (can_attack(target) && shouldAttack) {
    set_message("Attacking");
    await currentStrategy(target);
    attack(target).then(() => reduce_cooldown("attack", character.ping * 0.95));
    if (character.mp > 1100 && !is_on_cooldown("curse") && target.max_hp > 3000)
      use_skill("curse", target);

    if (
      target &&
      !is_on_cooldown("darkblessing") &&
      character.mp > G.skills["darkblessing"].mp &&
      !character.s?.darkblessing
    )
      use_skill("darkblessing");
  }

  if (!smartmoveDebug) {
    hitAndRun(target, rangeRate);
    angle =
      angle +
      flipRotation *
        Math.asin(
          (character.speed * (1 / character.frequency)) /
            6 /
            (character.range * rangeRate)
        ) *
        2;
  } else {
    angle = undefined;
  }
}

function priestBuff() {
  const buffee = getLowestHealth();
  if (buffee.hp < buffee.max_hp - buffThreshold * character.heal) {
    if (!is_in_range(buffee, "heal")) move(buffee.x, buffee.y);
    if (!is_on_cooldown("heal")) {
      use_skill("heal", buffee).then(() => {
        reduce_cooldown("attack", character.ping * 0.95);
      });
      set_message("Heal" + buffee.name);
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
        ally.hp < ally.max_hp * 0.3
    ) ||
      allies.every((ally) => ally.hp < ally.max_hp - character.level * 10 * 2))
  ) {
    if (!is_on_cooldown("partyheal") && character.mp > 1000) {
      use_skill("partyheal").then(() =>
        reduce_cooldown("partyheal", character.ping * 0.95)
      );
      set_message("Party Heal");
    }
  }
  partyMems
    .filter((member) => member !== character.name && member !== TANKER)
    .map((member) => {
      if (
        Object.keys(parent.entities).some(
          (entity) => parent.entities[entity]?.target === member
        )
      )
        if (
          is_in_range(get_entity(member), "absorb") &&
          !is_on_cooldown("absorb") &&
          character.mp > G.skills["absorb"].mp &&
          (get_entity(member).ctype !== "warrior" ||
            Object.keys(parent.entities).filter(
              (entity) => parent.entities[entity]?.target === member
            ).length > 2)
        ) {
          use_skill("absorb", get_entity(member));

          set_message("Absorb " + member);
        }
    });
}

setInterval(async function () {
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

  priestBuff();

  if ((smart.moving || isAdvanceSmartMoving) && !smartmoveDebug) return;

  let target = getTarget();

  //// BOSSES
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
    !target &&
    (partyMems[0] == character.name || !get_entity(partyMems[0]))
  ) {
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
}, ((1 / character.frequency) * 1000) / 3);
