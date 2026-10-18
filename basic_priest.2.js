// Load basic functions from other code snippet
if (parent.caracAL) {
  parent.caracAL.load_scripts([
    "adventure-land-scripts-backup/basic_function.7.js",
    "adventure-land-scripts-backup/other_class_msg_listener.8.js",
  ]);
} else {
  load_code(7);
  load_code(8);
}

// Kiting & Global Config
var originRangeRate = 0.5;
var rangeRate = originRangeRate;

// How far past attack range target selection is allowed to search
const TARGET_SEARCH_RANGE_MULTIPLIER = 1.5;

/**
 * @param {Object} entity - the entity to measure against
 * @param {number} [mult] - multiplier on attack range
 * @returns {boolean} whether the entity is within that range
 */
const inRange = (entity, mult = 1) =>
  !!entity &&
  distance(entity, character) <= (character.range + character.xrange) * mult;

// Combat Logic

/**
 * @param {Object[]} [buffees] - getPlayersToHeal(), when the caller already has it
 * @returns {Object|undefined} the first player needing a heal within heal range
 */
function getHealee(buffees = getPlayersToHeal()) {
  const healRange = character.range + character.xrange * 0.9;
  return buffees.find((buffee) => distance(buffee, character) < healRange);
}

/**
 * @param {Object} mob
 * @param {Object[]} mobsOnMe
 * @returns {boolean}
 */
function isPullBrave(mob, mobsOnMe) {
  return !FEAR_AFFECTS_HEAL || hasCourageFor([mob], mobsOnMe);
}

/**
 * Narrows the selected target to a mob to taunt as tanker or one to poison,
 * and to what we can actually hit: it, else the beefiest aggroed mob in reach.
 * @param {Object} [target]
 * @returns {{focus?: Object, attackTarget?: Object}}
 */
function refineTarget(target) {
  if (!target) return {};

  const partyDmgRecieved = avgPartyDmgTaken(partyMems);
  const prioritizedCharacter = prioritizedNames();
  const mobsInSearchRange = Object.values(parent.entities).filter(
    (entity) =>
      entity.type === "monster" &&
      !isCaveFriendly(entity) &&
      !entity.dead &&
      inRange(entity, TARGET_SEARCH_RANGE_MULTIPLIER),
  );
  // Taunt and poison spread both need the mob actually reachable
  const mobsInRange = mobsInSearchRange.filter((mob) => inRange(mob));
  const heldWeaponInfo = character.slots.mainhand
    ? item_info(character.slots.mainhand)
    : {};
  const mobsOnMe = listOfMonsterAttacking(character);

  // A taunt that one-shots is just a wasted swing
  const targetToTaunt =
    isAssignedAsTanker() &&
    typeof usePullStrategies === "function" &&
    currentStrategy === usePullStrategies
      ? mobsInRange
          .filter(
            (mob) =>
              !mob.target &&
              !MELEE_IGNORE_LIST.includes(mob.mtype) &&
              isPullBrave(mob, mobsOnMe) &&
              !canOneShotWithWeapon(heldWeaponInfo, [mob]) &&
              partyDmgRecieved + calculateDamage(mob, character) <
                character.heal * 0.9 * attackFrequency(),
          )
          .sort(
            (lhs, rhs) => distance(rhs, character) - distance(lhs, character),
          )
          .shift()
      : null;

  const targetToPoison =
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

  const focus = targetToTaunt ?? targetToPoison;

  // Focus when in reach, else the beefiest aggroed mob; growth kills first
  const fallbacks = mobsInRange
    .filter((mob) => mob !== focus && mob.target)
    .sort((lhs, rhs) => rhs.hp - lhs.hp);
  const reachable = inRange(focus) ? [focus, ...fallbacks] : fallbacks;
  const [best] = reachable
    .map((mob) => ({ mob, rank: growthKillRank(mob) }))
    .sort((lhs, rhs) => lhs.rank - rhs.rank);
  if (best) noteGrowthOptions(best.rank);

  return { focus, attackTarget: best?.mob };
}

/**
 * @param {Object} [healee]
 * @returns {boolean} whether a ghost heal waits for the pinkie we own to be in hand
 */
function isAwaitingPinkie(healee) {
  return (
    isUnhealedGhost(healee) &&
    character.slots.mainhand?.name !== "pinkie" &&
    locate_item("pinkie") !== -1 &&
    canWieldTwoHanded()
  );
}

/**
 * Heal first, else a hit: mid-trip only a safe getEnRouteTarget() mob, else
 * what refineTarget makes of the selected target.
 * @returns {{skill: string, target: Object}|undefined}
 */
function getNextAction() {
  const healee = getHealee();
  if (isAwaitingPinkie(healee)) return undefined;
  if (healee) return { skill: "heal", target: healee };

  const mob = isOnTrip()
    ? getEnRouteTarget()
    : refineTarget(fightTarget).attackTarget;
  if (mob && shouldAttack(mob)) return { skill: "attack", target: mob };
}

/**
 * Faces whoever comes next, and with no one in heal range steps toward a
 * prioritized party member who needs one.
 * @param {Object} [target] - the selected target
 */
function tendParty(target) {
  const buffees = getPlayersToHeal();
  const healee = getHealee(buffees);
  const focus = healee ?? refineTarget(target).focus;
  if (focus) change_target(focus);

  if (healee || smart.moving || isAdvanceSmartMoving) return;

  const prioritizedBuffeesNames = prioritizedNames();
  const approaching = buffees.find((buffee) =>
    prioritizedBuffeesNames.includes(buffee.name),
  );
  if (!approaching) return;

  const middleX = (approaching.x + character.x) / 2;
  const middleY = (approaching.y + character.y) / 2;
  if (can_move_to(middleX, middleY)) move(middleX, middleY);
  else if (can_move_to(approaching.x, approaching.y))
    move(approaching.x, approaching.y);
  set_message(`Moving to ${approaching.name}`);
}

// --- Skills, each on its own runSkillLoop (see startSkillLoops) ---

// Below this hp a mob dies too fast for the curse to pay for its mp
const CURSE_HP_THRESHOLD = 15_000;

/** Share of max mp below which the zapper stops */
const ZAP_MIN_MP_RATIO = 0.6;

/** Mp kept on top of partyheal's own cost so an emergency one can always fire */
const PARTYHEAL_MP_MARGIN = 400;
const PARTYHEAL_RESERVED_HEALS = 20;

function partyHealMpFloor() {
  const mpPerHeal =
    character.mp_cost * (1 - (character.mp_reduction ?? 0) / 100);
  return (
    G.skills["partyheal"].mp +
    Math.max(PARTYHEAL_MP_MARGIN, PARTYHEAL_RESERVED_HEALS * mpPerHeal)
  );
}

/** @returns {number} mp curse must leave behind for the zapper and an emergency partyheal */
function curseMpFloor() {
  return (
    Math.max(
      character.max_mp * ZAP_MIN_MP_RATIO,
      G.skills["partyheal"].mp + PARTYHEAL_MP_MARGIN,
    ) + surgeMpReserve()
  );
}

/**
 * @param {Object} mob
 * @returns {number} party dps on it plus its dps on whoever it reaches
 */
function curseValue(mob) {
  const dealt = partyMems
    .map((name) => (name === character.name ? character : get_player(name)))
    .filter((member) => member && !member.rip && member.target === mob.id)
    .reduce((total, member) => total + calculateDamage(member, mob, false), 0);

  const victim = get_player(mob.target);
  const isReachingVictim =
    victim && distance(mob, victim) <= mob.range + mob.speed;

  return dealt + (isReachingVictim ? calculateDamage(mob, victim, false) : 0);
}

/** @returns {Object|null} the uncursed mob worth the most to curse */
function getCurseTarget() {
  if (
    is_on_cooldown("curse") ||
    character.mp - G.skills["curse"].mp < curseMpFloor()
  )
    return null;
  const prioritized = prioritizedNames();

  return (
    Object.values(parent.entities)
      .filter(
        (mob) =>
          mob.type === "monster" &&
          !isCaveFriendly(mob) &&
          !mob.dead &&
          !mob.s.cursed &&
          is_in_range(mob, "curse") &&
          mob.hp > CURSE_HP_THRESHOLD &&
          prioritized.includes(mob.target),
      )
      .map((mob) => ({ mob, value: curseValue(mob) }))
      .filter(({ value }) => value > 0)
      .sort((lhs, rhs) => rhs.value - lhs.value)[0]?.mob ?? null
  );
}

// A stranger holding a dragged boss, else a party member (not us, not the tank) in absorb range and holding aggro.
function getAbsorbTarget() {
  const bossThief = getBossThiefToAbsorb();
  if (bossThief) return bossThief;

  if (character.mp < G.skills["absorb"].mp + 600) return null;

  const baitedBoss = getBaitedBoss();
  const baitHolder =
    baitedBoss?.target !== character.name &&
    getMyCharacters().includes(baitedBoss?.target) &&
    get_entity(baitedBoss.target);
  if (baitHolder && is_in_range(baitHolder, "absorb")) return baitHolder;

  const offTank =
    farmTanker && farmTanker !== WARRIOR && isOnPartyFarmSpot()
      ? WARRIOR
      : undefined;
  const vulnerableMems = getMyCharacters().filter(
    (id) => id !== character.name && id !== TANKER && id !== offTank,
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
  if (character.mp <= partyHealMpFloor()) return false;
  const allies = (parent.party_list || [])
    .map((name) => get_entity(name))
    .filter((entity) => entity && !entity.dead && !entity.rip);
  if (!allies.length) return false;
  const modInjuredThreshold = character.level * 20;
  return (
    allies.some(
      (lhs) =>
        lhs.hp < lhs.max_hp * 0.3 ||
        (lhs.hp < lhs.max_hp - modInjuredThreshold &&
          !is_in_range(lhs, "heal")),
    ) ||
    (allies.every((lhs) => lhs.hp < lhs.max_hp - modInjuredThreshold * 5) &&
      allies.length > 1)
  );
}

function isOutHealed() {
  return (
    avgPartyDmgTaken(partyMems) > getHealPower() * 0.95 * attackFrequency()
  );
}

function shouldPriestScare() {
  if (isHoldingBait()) return true;
  if (!isOutHealed()) return false;

  if (currentStrategy === usePullStrategies) {
    return (
      character.hp < (isAssignedAsTanker() ? 0.3 : 0.5) * character.max_hp &&
      character.cc < 100
    );
  }

  return !isAssignedAsTanker() || character.hp < 0.2 * character.max_hp;
}

function getZapTarget() {
  const hasZapper =
    character.slots.ring1?.name === "zapper" ||
    character.slots.ring2?.name === "zapper";
  const mpPct = character.mp / character.max_mp;

  // Aggro at Dorr fails the cave entry
  if (isPreparingCave && !character.cave) return null;

  if (
    mpPct < ZAP_MIN_MP_RATIO ||
    character.s.penalty_cd ||
    !hasZapper ||
    Object.keys(character.c).length
  )
    return null;

  const baitedBoss = getBaitedBoss();
  const targetsInRange = Object.values(parent.entities).filter(
    (entity) =>
      entity.type === "monster" &&
      !isCaveFriendly(entity) &&
      is_in_range(entity, "zapperzap") &&
      !entity["1hp"] &&
      !isBaitHeld(entity, baitedBoss),
  );

  const isTanker = isAssignedAsTanker();
  const mobsOnMe = listOfMonsterAttacking(character);

  const targetToZap = targetsInRange
    .map((entity) => ({
      ...entity,
      dist: distance(entity, character),
      hp_p: entity.hp / entity.max_hp,
      weak: entity.max_hp < TRIVIAL_MOB_MAX_HP,
    }))
    .filter((entity) => {
      if (entity.target) return true;

      if (
        IGNORE_ABILITIES.some((skill) =>
          Object.keys(entity.abilities ?? {}).includes(skill),
        )
      )
        return false;

      if (!isPullBrave(entity, mobsOnMe)) return false;

      if (
        entity.weak ||
        entity.hp < 1000 ||
        calculateDamage(entity, get_player(TANKER) ?? character) < 150
      )
        return true;

      // A pulled farm mob ends up on the tank, us included
      if (isFarmMob(entity))
        return (
          calculateDamage(entity, get_player(TANKER) ?? character) +
            avgPartyDmgTaken(partyMems) <
          character.heal * attackFrequency()
        );

      if (!isTanker) {
        return (
          calculateDamage(entity, character) + avgPartyDmgTaken(partyMems) <
          character.heal * attackFrequency()
        );
      }

      return false;
    })
    .sort((lhs, rhs) => {
      const farmFirst = Number(isFarmMob(rhs)) - Number(isFarmMob(lhs));
      if (farmFirst) return farmFirst;

      if (isTanker) {
        // Prioritize unaggrod mobs first
        if (!!lhs.target !== !!rhs.target) return lhs.target ? 1 : -1;
      } else {
        if (!!lhs.target !== !!rhs.target) return lhs.target ? -1 : 1;
      }

      if (lhs.target && rhs.target)
        return lhs.hp_p !== rhs.hp_p
          ? rhs.hp_p - lhs.hp_p
          : rhs.dist - lhs.dist;

      if (isTanker) return rhs.dist - lhs.dist;

      return lhs.weak !== rhs.weak ? (lhs.weak ? -1 : 1) : rhs.dist - lhs.dist;
    })[0];

  if (!targetToZap) return null;
  const mpThreshold = isTanker ? (targetToZap.target ? 0.75 : 0.6) : 0.6;
  return mpPct > mpThreshold ? targetToZap : null;
}

function startSkillLoops() {
  // runSkillLoop always calls canUse right before cast, so canUse stashes what
  // it approved and cast reuses it instead of recomputing the scans.
  let pendingCurseTarget = null;
  let pendingAbsorbTarget = null;
  let pendingZapTarget = null;
  // Heal XOR attack
  runActionLoop(() => {
    const action = getNextAction();
    return action && (() => castOnAttackCooldown(action.skill, action.target));
  });

  // Gear, trips included, on a fixed cadence decoupled from the action loop
  runSkillLoop({
    skill: "gear",
    floorMs: 100,
    whileMoving: true,
    canUse: () => true,
    cast: () => equipClassGear(getHealee() ?? get_target()),
  });

  runSkillLoop({
    skill: "curse",
    canUse: () => {
      pendingCurseTarget = getCurseTarget();
      return pendingCurseTarget != null;
    },
    cast: () => use_skill("curse", pendingCurseTarget),
  });

  runSkillLoop({
    skill: "darkblessing",
    canUse: () =>
      character.mp > G.skills["darkblessing"].mp &&
      shouldAttack() &&
      !character.s?.darkblessing,
    cast: () => use_skill("darkblessing"),
  });

  runSkillLoop({
    skill: "partyheal",
    whileMoving: true,
    canUse: () => shouldPartyHeal(),
    cast: () => use_skill("partyheal"),
  });

  runSkillLoop({
    skill: "absorb",
    whileMoving: true,
    canUse: () => {
      pendingAbsorbTarget = getAbsorbTarget();
      return pendingAbsorbTarget != null;
    },
    cast: () => use_skill("absorb", pendingAbsorbTarget),
  });

  runSkillLoop({
    skill: "scare",
    canUse: () => shouldPriestScare(),
    cast: () => scareAwayMobs(),
  });

  runSkillLoop({
    skill: "zapperzap",
    floorMs: 50,
    whileMoving: true,
    canUse: () => {
      pendingZapTarget = getZapTarget();
      return pendingZapTarget != null;
    },
    cast: () => use_skill("zapperzap", pendingZapTarget),
  });
}

// Main Control Loop

async function mainLoop() {
  try {
    assignRoles();

    if (character.rip) {
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

    // Target Selection — mid-trip it only hands back a target when a higher
    // strategy took over. The action loop heals and attacks.
    fightTarget = await selectFightTarget();

    if (!isOnTrip()) tendParty(fightTarget);
  } catch (e) {
    if (e.cause !== "smart_move" && e.cause !== "death") console.error(e);
  }

  setTimeout(mainLoop, getLoopInterval());
}

mainLoop();
startSkillLoops();
