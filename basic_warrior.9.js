// Load basic functions from other code snippet
load_code(7);
load_code(8);

// Kiting
var originRangeRate = 1.1;
var rangeRate = originRangeRate;
const loopInterval = ((1 / character.frequency) * 1000) / 6;

async function fight(target) {
  const shouldAttack = character.map === "crypt" ? get_entity(HEALER) : true;
  if (can_attack(target) && shouldAttack) {
    set_message("Attacking");
    await currentStrategy(target);

    attack(target).then(() => reduce_cooldown("attack", character.ping * 0.95));

    if (character.mp > G.skills["warcry"].mp && !is_on_cooldown("warcry"))
      use_skill("warcry");

    if (
      target.target === character.name &&
      character.mp > G.skills["hardshell"].mp &&
      !is_on_cooldown("hardshell") &&
      avgDmgTaken(character) > 500 &&
      character.hp < 0.5 * character.max_hp
    )
      use_skill("hardshell");

    if (
      character.mp > G.skills["stomp"].mp &&
      !is_on_cooldown("stomp") &&
      locate_item("basher") !== -1 &&
      character.hp < character.max_hp * 0.7 &&
      character.cc < 100
    ) {
      await equipBatch({ mainhand: "basher", offhand: undefined });
      await use_skill("stomp");
    }

    if (character.mp > G.skills["taunt"].mp && !is_on_cooldown("taunt")) {
      const mobsTargetingAlly = Object.keys(parent.entities).find((id) =>
        partyMems
          .filter((char) => char !== character.name)
          .includes(parent.entities[id]?.target)
      );
      if (
        mobsTargetingAlly &&
        parent.entities[mobsTargetingAlly]?.attack > 120 &&
        parent.entities[mobsTargetingAlly]?.attack < 1500 &&
        !parent.entities[mobsTargetingAlly]?.cooperative
      )
        use_skill("taunt", parent.entities[mobsTargetingAlly]).then(() =>
          reduce_cooldown("taunt", character.ping * 0.95)
        );
      else if (
        !target.target ||
        (target.target !== character.name &&
          target.attack < 1500 &&
          !target.cooperative)
      ) {
        use_skill("taunt", target).then(() =>
          reduce_cooldown("taunt", character.ping * 0.95)
        );
      }
    }

    if (
      (!get_entity(HEALER) ||
        get_entity(HEALER).rip ||
        character.hp < 0.3 * character.max_hp) &&
      Object.keys(parent.entities).filter(
        (id) => parent.entities[id].target === character.name
      ).length > 2 &&
      !is_on_cooldown("scare") &&
      character.mp > 100 &&
      character.cc < 100
    ) {
      await equipBatch({
        orb: "jacko",
      });
      await use_skill("scare");
    }

    // if (
    //   character.mp > G.skills["cleave"].mp &&
    //   !is_on_cooldown("cleave") &&
    //   Object.keys(parent.entities).filter((id) =>
    //     is_in_range(parent.entities[id], "cleave")
    //   ).length > 4
    // )
    //   use_skill("cleave");

    //if (character.mp > G.skills['stomp'].mp && !is_on_cooldown("stomp"))
    //	use_skill('stomp')
  }

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

  if (
    target &&
    target.range <= character.range &&
    target.speed > character.speed
  ) {
    rangeRate = target.speed / character.speed;
  } else rangeRate = originRangeRate;
}

setInterval(async function () {
  loot();
  buff();

  if (
    character.moving &&
    character.mp > G.skills["charge"].mp &&
    !is_on_cooldown("charge")
  )
    use_skill("charge");

  if (character.rip) {
    respawn();
    return;
  }

  if ((smart.moving || isAdvanceSmartMoving) && !smartmoveDebug) return;

  let target = getTarget();

  //// BOSSES
  if (goToBoss()) return;

  target = await changeToDailyEventTargets();

  //// THE CRYPT & EVENTS
  if (get("cryptInstance")) target = await useCryptStrategy(target);
  else target = await changeToDailyEventTargets();

  //// Logic to targets and farm places
  if (get("cryptInstance") && character.map !== "crypt") {
    await advanceSmartMove(CRYPT_DOOR);
    enter("crypt", get("cryptInstance"));
  } else if (!smart.moving && !isAdvanceSmartMoving && !target) {
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
