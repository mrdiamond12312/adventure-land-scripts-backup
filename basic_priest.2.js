// Load basic functions from other code snippet
if (parent.caracAL) {
  parent.caracAL
    .load_scripts([
      "adventure-land-scripts-backup/basic_function.7.js",
      "adventure-land-scripts-backup/other_class_msg_listener.8.js",
    ])
    .then(() => {
      mainLoop();
      zapperLoop();
    });
} else {
  load_code(7);
  load_code(8);
}

// Kiting & Global Config
var originRangeRate = 0.5;
var rangeRate = originRangeRate;
const loopInterval = Math.floor(((1 / character.frequency) * 1000) / 4);

const reduceCd = (skillName) =>
  reduce_cooldown(skillName, Math.min(...parent.pings));

// Combat Logic

async function fight(target, isDeterminedToHeal = false) {
  const partyDmgRecieved = avgPartyDmgTaken(partyMems);
  const characterBufferedRange = character.range + character.xrange;
  const mobsInRange = Object.values(parent.entities)
    .filter(
      (entity) =>
        entity.type === "monster" &&
        !entity.dead &&
        distance(character, entity) <= characterBufferedRange,
    )
    .map((mob) => ({
      ...mob,
      cluster_count: numberOfMonsterAroundTarget(mob, 17),
    }));

  // Target Selection (Taunt & Debuff Logic)
  const targetToTaunt =
    isAssignedAsTanker() && currentStrategy === usePullStrategies
      ? mobsInRange
          .filter(
            (mob) =>
              !mob.target &&
              partyDmgRecieved + calculateDamage(mob, character) <
                character.heal * 0.9 * character.frequency,
          )
          .sort(
            (lhs, rhs) => distance(rhs, character) - distance(lhs, character),
          )
          .shift()
      : null;

  const targetToAttack =
    (character.slots.orb?.name === "test_orb" ||
      character.slots.mainhand?.name === "oozingterror") &&
    !target?.cooperative
      ? mobsInRange
          .filter(
            (mob) => !mob.s.poisoned && prioritizedNames().includes(mob.target),
          )
          .sort((lhs, rhs) => {
            if (rhs.attack === lhs.attack) {
              return rhs.hp - lhs.hp;
            }
            return rhs.attack - lhs.attack;
          })
          .shift() ?? target
      : target;

  target = targetToTaunt ?? targetToAttack;
  if (target) change_target(target);

  // Early Exit
  if (!target) return;

  const promisesToAwait = [];

  // Curse Logic
  const canCurse = !is_on_cooldown("curse") && character.mp > 1600;
  const targetToCurse =
    mobsInRange
      .filter(
        (mob) => !mob.s.curse && is_in_range(mob, "curse") && mob.max_hp > 3000,
      )
      .sort((lhs, rhs) => {
        if (lhs.cooperative !== rhs.cooperative) {
          return lhs.cooperative ? -1 : 1;
        }
        if (lhs.cluster_count === rhs.cluster_count) return rhs.hp - lhs.hp;
        return rhs.cluster_count - lhs.cluster_count;
      })
      .shift() ?? target;
  if (canCurse && is_in_range(targetToCurse, "curse")) {
    promisesToAwait.push(
      use_skill("curse", targetToCurse).then(() => reduceCd("curse")),
    );
  }

  // Dark Blessing Logic
  const canDarkBless =
    !is_on_cooldown("darkblessing") &&
    character.mp > G.skills["darkblessing"].mp;
  if (canDarkBless && shouldAttack() && !character.s?.darkblessing) {
    promisesToAwait.push(
      use_skill("darkblessing").then(() => reduceCd("darkblessing")),
    );
  }

  // Attack Logic
  if (!isDeterminedToHeal) {
    const isAttackReady =
      ms_to_next_skill("attack") === 0 && !character.s.penalty_cd;
    const isTargetInAttackRange =
      distance(target, character) <= characterBufferedRange;

    if (!isAttackReady && isTargetInAttackRange && shouldAttack()) {
      promisesToAwait.push(currentStrategy(target));
    }

    if (isAttackReady && isTargetInAttackRange && shouldAttack()) {
      set_message("Attacking");
      promisesToAwait.push(
        attack(target)
          .then(() => reduceCd("attack"))
          .catch((e) => attackErrorHandler(e)),
      );
    }
  }

  // Await All Actions
  try {
    await withTimeout(Promise.allSettled(promisesToAwait), 2500);
  } catch (e) {
    console.error(e);
  }
}

async function priestBuff() {
  const promises = [];

  // Heal Logic
  const buffees = getPlayersToHeal();
  const prioritizedBuffeesNames = prioritizedNames();
  const isAttackReady =
    ms_to_next_skill("attack") === 0 && !character.s.penalty_cd;

  if (buffees.length !== 0) {
    for (const buffee of buffees) {
      const bufferedRange = character.range + character.xrange * 0.9;
      const dist = distance(buffee, character);

      if (!isAttackReady) {
        promises.push(currentStrategy(buffee));
        break;
      }

      if (
        !smart.moving &&
        dist >= bufferedRange &&
        prioritizedBuffeesNames.includes(buffee.name)
      ) {
        promises.push(
          move((buffee.x + character.x) / 2, (buffee.y + character.y) / 2),
        );
        set_message(`Moving to ${buffee.name}`);
        continue;
      }

      if (dist < bufferedRange && isAttackReady) {
        set_message(`Heal ${buffee.name}`);
        promises.push(
          heal(buffee).then(() => reduceCd("attack")),
        );
        break;
      }
    }
  }

  // Party Heal Logic
  const allies = (parent.party_list || [])
    .map((name) => get_entity(name))
    .filter((entity) => entity);
  const modInjuredThreshold = character.level * 20;

  if (
    !is_on_cooldown("partyheal") &&
    character.mp > G.skills["partyheal"].mp + 400 &&
    allies.length
  ) {
    const shouldPartyHeal =
      allies.some(
        (lhs) =>
          lhs.hp < lhs.max_hp * 0.3 ||
          (lhs.hp < lhs.max_hp - modInjuredThreshold &&
            !is_in_range(lhs, "heal")),
      ) ||
      (allies.every((lhs) => lhs.hp < lhs.max_hp - modInjuredThreshold) &&
        allies.length > 1);

    if (shouldPartyHeal) {
      use_skill("partyheal").then(() => reduceCd("partyheal"));
      set_message("Party Heal");
    }
  }

  // Absorb Skill Logic
  const vulnerableMems = partyMems.filter(
    (memberId) => memberId !== character.name && memberId !== TANKER,
  );
  for (const memberId of vulnerableMems) {
    const member = get_entity(memberId);
    if (
      member &&
      !is_on_cooldown("absorb") &&
      is_in_range(member, "absorb") &&
      character.mp >= G.skills["absorb"].mp + 200
    ) {
      const hasAggro = Object.values(parent.entities).some(
        (e) => e.target === memberId,
      );
      if (hasAggro) {
        use_skill("absorb", member);
        set_message(`Absorb ${memberId}`);
        break;
      }
    }
  }
  try {
    await withTimeout(Promise.allSettled(promises), 2500);
  } catch (e) {
    console.error(e);
    return false;
  }
  return buffees.length > 0;
}

// Specialized Loops
async function zapperLoop() {
  const zapCd = ms_to_next_skill("zapperzap");
  const hasZapper =
    character.slots.ring1?.name === "zapper" ||
    character.slots.ring2?.name === "zapper";

  if (
    zapCd !== 0 ||
    character.mp < character.max_mp * 0.6 ||
    character.penalty_cd ||
    !hasZapper
  ) {
    return setTimeout(zapperLoop, Math.max(zapCd, 50));
  }

  try {
    const targets = Object.values(parent.entities)
      .filter(
        (entity) =>
          entity.type === "monster" &&
          is_in_range(entity, "zapperzap") &&
          !entity["1hp"] &&
          (entity.target ||
            entity.hp < 1000 ||
            calculateDamage(entity, get_player(TANKER) ?? character) < 150),
      )
      .map((entity) => ({
        ...entity,
        dist: distance(entity, character),
        hp_p: entity.hp / entity.max_hp,
        weak: entity.max_hp < 2000,
      }))
      .sort((lhs, rhs) => {
        if (!!lhs.target !== !!rhs.target) return lhs.target ? -1 : 1;
        if (lhs.target && rhs.target)
          return lhs.hp_p !== rhs.hp_p
            ? rhs.hp_p - lhs.hp_p
            : rhs.dist - lhs.dist;
        return lhs.weak !== rhs.weak
          ? lhs.weak
            ? -1
            : 1
          : rhs.dist - lhs.dist;
      });

    if (targets.length) {
      use_skill("zapperzap", targets[0]).then(() => reduceCd("zapperzap"));
    }
  } catch (e) {
    console.log("Zap Error:", e);
  }
  setTimeout(zapperLoop, Math.max(ms_to_next_skill("zapperzap"), 50));
}

// Main Control Loop

async function mainLoop() {
  try {
    assignRoles();

    if (character.rip) {
      respawn();
      throw new Error("Character down", { cause: "death" });
    }

    // Costume & Cape Logic
    if (!character.skin || character.skin !== "snow_angel") {
      if (character.slots.cape?.name !== "angelwings") {
        await equipBatch({ cape: "angelwings" });
      }
      if (character.slots.cape?.name === "angelwings") {
        parent.socket.emit("activate", { slot: "cape" });
      }
    }

    const isDeterminedToHeal = await priestBuff();

    const isMovingControlled =
      (smart.moving || isAdvanceSmartMoving) && !smartmoveDebug;
    if (isMovingControlled) {
      throw new Error("Smart moving", { cause: "smart_move" });
    }

    // Target Selection
    let target = getTarget();
    if (get("cryptInstance")) {
      target = await useCryptStrategy(target);
    } else {
      target = await changeToDailyEventTargets();
    }

    // Movement Logic
    if (!target) {
      const cryptKey = get("cryptInstance");
      const isPartyLeaderOrAlone =
        partyMems[0] === character.name || !get_entity(partyMems[0]);
      const isFarFromFarm =
        distance(character, { x: mapX, y: mapY, map }) > 500;

      if (cryptKey && character.map !== "crypt") {
        changeToNormalStrategies();
        advanceSmartMove(CRYPT_STARTING_LOCATION);
      } else if (!cryptKey && (isPartyLeaderOrAlone || isFarFromFarm)) {
        changeToNormalStrategies();
        advanceSmartMove({ map, x: mapX, y: mapY });
      }
    } else {
      await fight(target, isDeterminedToHeal);
    }
  } catch (e) {
    if (e.cause !== "smart_move" && e.cause !== "death") console.error(e);
  }

  setTimeout(mainLoop, getLoopInterval());
}

if (!parent.caracAL) mainLoop();
