// Load basic functions from other code snippet
if (parent.caracAL) {
  parent.caracAL
    .load_scripts([
      "adventure-land-scripts-backup/basic_function.7.js",
      "adventure-land-scripts-backup/other_class_msg_listener.8.js",
    ])
    .then(() => {
      mainLoop();
      startSkillLoops();
    });
} else {
  load_code(7);
  load_code(8);
}

// Kiting & Global Config
var originRangeRate = 0.5;
var rangeRate = originRangeRate;

const reduceCd = (skillName, isPingBased = true) =>
  reduce_cooldown(
    skillName,
    isPingBased ? Math.min(...parent.pings) : character.ping * 0.95,
  );

// Combat Logic

async function fight(target, isMovingControlled = false) {
  // Snapshot for attackSpeedCompensate: heal and attack share the attack
  // cooldown, and weapon swaps change frequency mid-tick, so capture it now.
  const attackFrequencyBeforeCompensate = character.frequency;
  const promisesToAwait = [];

  const isAttackReady =
    ms_to_next_skill("attack") === 0 && !character.s.penalty_cd;

  // Targetting, poisoned aggro'ed mob or taunt if assigned as tanker
  let isTargetInAttackRange = false;
  if (target && !isMovingControlled) {
    const partyDmgRecieved = avgPartyDmgTaken(partyMems);
    const characterBufferedRange = character.range + character.xrange;
    const prioritizedCharacter = prioritizedNames();
    const mobsInRange = Object.values(parent.entities).filter(
      (entity) =>
        entity.type === "monster" &&
        !entity.dead &&
        distance(character, entity) <= characterBufferedRange,
    );

    const targetToTaunt =
      isAssignedAsTanker() &&
      typeof usePullStrategies === "function" &&
      currentStrategy === usePullStrategies
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
              (mob) =>
                !mob.s.poisoned && prioritizedCharacter.includes(mob.target),
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
    isTargetInAttackRange =
      target && distance(target, character) <= characterBufferedRange;
  }

  // Heal XOR attack
  let committedToHeal = false;
  const buffees = getPlayersToHeal();
  const prioritizedBuffeesNames = prioritizedNames();
  const healRange = character.range + character.xrange * 0.9;

  if (isAttackReady && buffees.length) {
    for (const buffee of buffees) {
      const dist = distance(buffee, character);

      if (
        !smart.moving &&
        !isAdvanceSmartMoving &&
        dist >= healRange &&
        prioritizedBuffeesNames.includes(buffee.name)
      ) {
        const middleX = (buffee.x + character.x) / 2;
        const middleY = (buffee.y + character.y) / 2;
        if (can_move_to(middleX, middleY)) move(middleX, middleY);
        else if (can_move_to(buffee.x, buffee.y)) move(buffee.x, buffee.y);
        set_message(`Moving to ${buffee.name}`);
        continue;
      }

      if (dist < healRange) {
        set_message(`Heal ${buffee.name}`);
        promisesToAwait.push(
          use_skill("heal", buffee).then(() => {
            attackSpeedCompensate(attackFrequencyBeforeCompensate);
            reduceCd("heal");
          }),
        );
        committedToHeal = true;
        break;
      }
    }
  }

  // --- Attack (only if we didn't heal this tick) ---
  if (
    !committedToHeal &&
    isAttackReady &&
    target &&
    isTargetInAttackRange &&
    shouldAttack()
  ) {
    set_message("Attacking");
    promisesToAwait.push(
      attack(target)
        .then(() => {
          attackSpeedCompensate(attackFrequencyBeforeCompensate);
          reduceCd("attack", false);
        })
        .catch((e) => attackErrorHandler(e)),
    );
  }

  // --- Await All Actions ---
  try {
    await withTimeout(Promise.allSettled(promisesToAwait), 2500);
  } catch (e) {
    console.error(e);
  }
}

// --- Skills, each on its own runSkillLoop (see startSkillLoops) ---

// Best mob to curse: aggroing a party member, cursable, chunky, biggest cluster.
function getCurseTarget() {
  if (is_on_cooldown("curse") || character.mp <= 1600) return null;
  const prioritized = prioritizedNames();
  const candidate = Object.values(parent.entities)
    .filter(
      (mob) =>
        mob.type === "monster" &&
        !mob.dead &&
        !mob.s.curse &&
        is_in_range(mob, "curse") &&
        mob.max_hp > 3000 &&
        prioritized.includes(mob.target),
    )
    .map((mob) => ({ mob, cluster: numberOfMonsterAroundTarget(mob, 17) }))
    .sort((lhs, rhs) => {
      if (lhs.mob.cooperative !== rhs.mob.cooperative)
        return lhs.mob.cooperative ? -1 : 1;
      if (lhs.cluster === rhs.cluster) return rhs.mob.hp - lhs.mob.hp;
      return rhs.cluster - lhs.cluster;
    })[0]?.mob;

  const targetToCurse = candidate ?? get_targeted_monster();
  return targetToCurse && is_in_range(targetToCurse, "curse")
    ? targetToCurse
    : null;
}

// A party member (not us, not the tank) in absorb range and holding aggro.
function getAbsorbTarget() {
  if (character.mp < G.skills["absorb"].mp + 600) return null;
  const vulnerableMems = [...partyMems, partyMerchant].filter(
    (id) => id !== character.name && id !== TANKER,
  );
  for (const memberId of vulnerableMems) {
    const member = get_entity(memberId);
    if (member && is_in_range(member, "absorb")) {
      const hasAggro = Object.values(parent.entities).some(
        (e) => e.target === memberId,
      );
      if (hasAggro) return member;
    }
  }
  return null;
}

function shouldPartyHeal() {
  if (character.mp <= G.skills["partyheal"].mp + 400) return false;
  const allies = (parent.party_list || [])
    .map((name) => get_entity(name))
    .filter((entity) => entity && !entity.dead && !entity.rip);
  if (!allies.length) return false;
  const modInjuredThreshold = character.level * 20;
  return (
    allies.some(
      (lhs) =>
        lhs.hp < lhs.max_hp * 0.3 ||
        (lhs.hp < lhs.max_hp - modInjuredThreshold && !is_in_range(lhs, "heal")),
    ) ||
    (allies.every((lhs) => lhs.hp < lhs.max_hp - modInjuredThreshold * 5) &&
      allies.length > 1)
  );
}

function shouldPriestScare() {
  const overHealed =
    avgPartyDmgTaken(partyMems) > character.heal * 0.95 * character.frequency;
  if (currentStrategy === usePullStrategies) {
    return (
      overHealed &&
      character.hp < (isAssignedAsTanker() ? 0.3 : 0.5) * character.max_hp &&
      character.cc < 100
    );
  }
  return (
    (overHealed &&
      character.hp < (isAssignedAsTanker() ? 0.2 : 0.5) * character.max_hp) ||
    !isAssignedAsTanker()
  );
}

// Best mob to zapperzap (migrated from the old zapperLoop). Null unless the
// zapper ring is on, mp is healthy, and a worthwhile target clears the mp gate.
function getZapTarget() {
  const hasZapper =
    character.slots.ring1?.name === "zapper" ||
    character.slots.ring2?.name === "zapper";
  const mpPct = character.mp / character.max_mp;

  if (
    mpPct < 0.6 ||
    character.penalty_cd ||
    !hasZapper ||
    Object.keys(character.c).length
  )
    return null;

  const targetsInRange = Object.values(parent.entities).filter(
    (entity) =>
      entity.type === "monster" &&
      is_in_range(entity, "zapperzap") &&
      !entity["1hp"],
  );

  const isTanker = isAssignedAsTanker();
  const aggroCount = (dmgType) =>
    targetsInRange.filter(
      (e) => e.target === character.name && e.damage_type === dmgType,
    ).length;
  const courageMap = {
    physical: { count: aggroCount("physical"), limit: character.courage },
    magical: { count: aggroCount("magical"), limit: character.mcourage },
    pure: { count: aggroCount("pure"), limit: character.pcourage },
  };

  const targetToZap = targetsInRange
    .map((entity) => ({
      ...entity,
      dist: distance(entity, character),
      hp_p: entity.hp / entity.max_hp,
      weak: entity.max_hp < 2000,
    }))
    .filter((entity) => {
      if (entity.target) return true;

      if (
        IGNORE_ABILITIES.some((skill) =>
          Object.keys(entity.abilities ?? {}).includes(skill),
        )
      )
        return false;

      const { count, limit } = courageMap[entity.damage_type] ?? {
        count: 0,
        limit: Infinity,
      };
      if (count + 1 > limit) return false;

      if (
        entity.weak ||
        entity.hp < 1000 ||
        calculateDamage(entity, get_player(TANKER) ?? character) < 150
      )
        return true;

      if (!isTanker) {
        return (
          calculateDamage(entity, character) + avgPartyDmgTaken(partyMems) <
          character.heal * character.frequency
        );
      }

      return false;
    })
    .sort((lhs, rhs) => {
      if (isTanker) {
        // Prioritize unaggrod mobs first
        if (!!lhs.target !== !!rhs.target) return lhs.target ? 1 : -1;
      } else {
        if (!!lhs.target !== !!rhs.target) return lhs.target ? -1 : 1;
      }

      if (lhs.target && rhs.target)
        return lhs.hp_p !== rhs.hp_p ? rhs.hp_p - lhs.hp_p : rhs.dist - lhs.dist;

      if (isTanker) return rhs.dist - lhs.dist;

      return lhs.weak !== rhs.weak ? (lhs.weak ? -1 : 1) : rhs.dist - lhs.dist;
    })[0];

  if (!targetToZap) return null;
  const mpThreshold = isTanker ? (targetToZap.target ? 0.75 : 0.6) : 0.6;
  return mpPct > mpThreshold ? targetToZap : null;
}

function startSkillLoops() {
  // Gear: not a cooldown skill, runs on a fixed cadence (floorMs).
  runSkillLoop({
    skill: "gear",
    floorMs: 100,
    canUse: () => {
      const target = get_targeted_monster();
      if (!target) return false;
      const suggested = calculatePriestItems(target);
      return Object.keys(suggested).some(
        (slot) => character.slots[slot]?.name !== suggested[slot],
      );
    },
    cast: () => equipBatch(calculatePriestItems(get_targeted_monster())),
  });

  runSkillLoop({
    skill: "curse",
    canUse: () => getCurseTarget() != null,
    cast: () =>
      use_skill("curse", getCurseTarget()).then(() => reduceCd("curse")),
  });

  runSkillLoop({
    skill: "darkblessing",
    canUse: () =>
      character.mp > G.skills["darkblessing"].mp &&
      shouldAttack() &&
      !character.s?.darkblessing,
    cast: () => use_skill("darkblessing").then(() => reduceCd("darkblessing")),
  });

  runSkillLoop({
    skill: "partyheal",
    canUse: () => shouldPartyHeal(),
    cast: () => use_skill("partyheal").then(() => reduceCd("partyheal")),
  });

  runSkillLoop({
    skill: "absorb",
    canUse: () => getAbsorbTarget() != null,
    cast: () => use_skill("absorb", getAbsorbTarget()),
  });

  runSkillLoop({
    skill: "scare",
    canUse: () => shouldPriestScare(),
    cast: () => scareAwayMobs(),
  });

  runSkillLoop({
    skill: "zapperzap",
    floorMs: 50,
    canUse: () => getZapTarget() != null,
    cast: () =>
      use_skill("zapperzap", getZapTarget()).then(() => reduceCd("zapperzap")),
  });
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
        await withTimeout(push_deferred("activate"), 300);
      }
    }

    const isMovingControlled =
      (smart.moving || isAdvanceSmartMoving) && !smartmoveDebug;

    // Target Selection — skipped during controlled moves (getTarget can
    // reposition us); target stays undefined then and fight() only heals.
    let target;
    if (!isMovingControlled) {
      target = getTarget();
      if (get("cryptInstance")) {
        target = await useCryptStrategy(target);
      } else {
        target = await changeToDailyEventTargets();
      }
    }

    // Heal (always) XOR attack (when we have a target). Runs every tick so the
    // priest keeps healing with no mob in reach or while smart-moving.
    await fight(target, isMovingControlled);

    // Movement Logic — only when idle with nothing to fight.
    if (!isMovingControlled && !target) {
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
    }
  } catch (e) {
    if (e.cause !== "smart_move" && e.cause !== "death") console.error(e);
  }

  setTimeout(mainLoop, getLoopInterval());
}

if (!parent.caracAL) {
  mainLoop();
  startSkillLoops();
}
