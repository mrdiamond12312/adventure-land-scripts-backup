// Load basic functions from other code snippet
load_code(7);
load_code(8);

// Kiting
var originRangeRate = 0.95;
var rangeRate = originRangeRate;
const loopInterval = ((1 / character.frequency) * 1000) / 4;

async function fight(target) {
  const shouldAttack = character.map === "crypt" ? get_entity(HEALER) : true;
  if (can_attack(target) && shouldAttack) {
    set_message("Attacking");
    await currentStrategy(target);

    attack(target).then(() => reduce_cooldown("attack", character.ping * 0.95));
    if (
      character.slots.offhand &&
      character.slots.offhand.name === "fireblade"
    ) {
      equip(findMaxLevelItem("candycanesword"), "offhand");
    }

    if (
      character.slots.mainhand &&
      character.slots.mainhand.name === "rapier"
    ) {
    }

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
      const magicalMobsTargetingSelf = Object.values(parent.entities).filter(
        (mob) => mob.damage_type === "magical"
      );
      const physicalMobsTargetingSelf = Object.values(parent.entities).filter(
        (mob) => mob.damage_type === "physical"
      );

      const pureMobsTargetingSelf = Object.values(parent.entities).filter(
        (mob) => mob.damage_type === "pure"
      );

      const mobsTargetingAlly = Object.values(parent.entities).find(
        (mob) =>
          mob.type === "monster" &&
          partyMems
            .filter((char) => char !== character.name)
            .includes(mob?.target) &&
          (mob.damage_type === "physical"
            ? physicalMobsTargetingSelf.length < character.courage
            : mob.damage_type === "magical"
            ? magicalMobsTargetingSelf.length < character.mcourage
            : pureMobsTargetingSelf.length < character.pcourage)
      );

      if (
        mobsTargetingAlly &&
        mobsTargetingAlly.attack > 120 &&
        mobsTargetingAlly.attack < 1500 &&
        !mobsTargetingAlly.cooperative
      )
        use_skill("taunt", mobsTargetingAlly).then(() =>
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
        character.hp < 0.5 * character.max_hp) &&
      Object.keys(parent.entities).filter(
        (id) => parent.entities[id].target === character.name
      ).length > 2 &&
      !is_on_cooldown("scare") &&
      character.mp > 100 &&
      character.cc < 100
    ) {
      scareAwayMobs();
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
            (character.range * rangeRate +
              character.xrange * 0.3 +
              extraDistanceWithinHitbox(
                angle,
                target ? get_width(target) ?? 0 : 0,
                target ? get_height(target) ?? 0 : 0
              ))
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
    await advanceSmartMove(CRYPT_STARTING_LOCATION);
  } else if (
    !smart.moving &&
    !get("cryptInstance") &&
    !isAdvanceSmartMoving &&
    !target &&
    !get("cryptInstance")
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
}, loopInterval);
