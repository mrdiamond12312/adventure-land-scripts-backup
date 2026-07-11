// Load basic functions from other code snippet

if (parent.caracAL) {
  parent.caracAL
    .load_scripts([
      "adventure-land-scripts-backup/basic_function.7.js",
      "adventure-land-scripts-backup/other_class_msg_listener.8.js",
    ])
    .then(() => {
      mainLoop();
      fuaLoop();
    });
} else {
  load_code(7);
  load_code(8);
}

// Kiting
var originRangeRate = 0.95;
rangeRate = originRangeRate;

async function fight(target) {
  // Snapshot for attackSpeedCompensate: weapon swaps mid-tick change frequency,
  // and the attack cooldown must be timed with the frequency at fire time.
  const attackFrequencyBeforeCompensate = character.frequency;
  const inRange = (entity) =>
    distance(entity, character) < character.range + character.xrange;
  const isAttackReady =
    ms_to_next_skill("attack") === 0 && !character.s.penalty_cd;

  if (
    typeof usePullStrategies === "function" &&
    currentStrategy === usePullStrategies
  ) {
    const allAggroedByParty = Object.values(parent.entities)
      .filter(
        (entity) =>
          entity.type === "monster" &&
          ([...partyMems, ...parent.party_list].includes(entity.target) ||
            (entity.cooperative && entity.target)) &&
          !MELEE_IGNORE_LIST.includes(entity.mtype) &&
          inRange(entity),
      )
      .sort((lhs, rhs) => {
        const lhsHpPercentage = lhs.hp / lhs.max_hp;
        const rhsHpPercentage = rhs.hp / rhs.max_hp;

        if (lhs.cooperative && rhs.cooperative) {
          if (lhs["1hp"]) return -1;
          else return 1;
        }
        if (lhs.cooperative) return -1;
        if (rhs.cooperative) return 1;

        return rhsHpPercentage - lhsHpPercentage;
      });

    target = allAggroedByParty.shift() ?? target;
  }

  if (!target) return;

  const promisesToAwait = [];

  if (!isAttackReady && inRange(target) && shouldAttack())
    promisesToAwait.push(currentStrategy(target));

  if (isAttackReady && inRange(target) && shouldAttack()) {
    if (!ms_to_next_skill("invis")) {
      use_skill("invis").then(() =>
        reduce_cooldown("invis", Math.min(...parent.pings)),
      );
    }
    promisesToAwait.push(
      withTimeout(attack(target), 2500)
        .then(() => {
          attackSpeedCompensate(attackFrequencyBeforeCompensate);
          reduce_cooldown("attack", Math.min(...parent.pings));
        })
        .catch((e) => {
          attackErrorHandler(e);
        }),
    );

    set_message("Attacking");
  }

  try {
    await Promise.allSettled(promisesToAwait);
  } catch (e) {}
}

async function fuaLoop() {
  try {
    const currentTarget = get_target();
    const promisesToAwait = [];

    const prioritized = prioritizedNames();
    const playersNearbyWithoutRogueSpeed = [
      ...Object.values(parent.entities),
      character,
    ]
      .filter(
        (entity) =>
          entity.type === "character" &&
          (!entity.s.rspeed || entity.s.rspeed.ms < 2.22e6) &&
          is_in_range(entity, "rspeed"),
      )
      .sort((lhs, rhs) => {
        const lhsPriority = prioritized.includes(lhs.id || lhs.name) ? 1 : 0;
        const rhsPriority = prioritized.includes(rhs.id || rhs.name) ? 1 : 0;
        return rhsPriority - lhsPriority; // higher priority first
      });

    if (
      playersNearbyWithoutRogueSpeed.length &&
      ms_to_next_skill("rspeed") === 0 &&
      character.mp > G.skills["rspeed"].mp &&
      shouldAttack()
    ) {
      promisesToAwait.push(
        use_skill("rspeed", playersNearbyWithoutRogueSpeed.shift()),
      );
    }

    if (
      distance(character, currentTarget) < character.range + character.xrange &&
      ms_to_next_skill("quickstab") === 0 &&
      character.mp > parent.G.skills["rspeed"].mp * 2
    ) {
      const currentMainhand = item_info(character.slots.mainhand);
      const skillToBeUsed =
        currentMainhand?.wtype === "dagger"
          ? "quickstab"
          : currentMainhand?.wtype === "fist"
          ? "quickpunch"
          : undefined;
      if (skillToBeUsed) {
        promisesToAwait.push(
          use_skill(skillToBeUsed, currentTarget).then(() =>
            reduce_cooldown(skillToBeUsed, Math.min(...parent.pings)),
          ),
        );
      }
    }

    await withTimeout(Promise.allSettled(promisesToAwait), 500);
  } catch (e) {
    console.log("Error while FuA: ", e);
  }

  setTimeout(fuaLoop, Math.max(ms_to_next_skill("quickpunch"), 100));
}

if (!parent.caracAL) fuaLoop();

async function mainLoop() {
  try {
    desiredElixir = "pumpkinspice";
    assignRoles();

    // buff();

    if (character.rip) {
      respawn();
      throw new Error("Character's down", {
        cause: "death",
      });
    }

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
        !isAdvanceSmartMoving &&
        !get("cryptInstance") &&
        (partyMems[0] === character.name ||
          !get_entity(partyMems[0]) ||
          distance(character, { x: mapX, y: mapY, map }) > 500)
      ) {
        log("Moving to farming location");
        changeToNormalStrategies();
        advanceSmartMove({
          map,
          x: mapX,
          y: mapY,
        });
      }
    } else await fight(target);
  } catch (e) {
    if (e.cause !== "smart_move" && e.cause !== "death") console.error(e);
  }

  setTimeout(mainLoop, getLoopInterval());
}

if (!parent.caracAL) mainLoop();
