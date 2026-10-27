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

// Kiting
var originRangeRate = 0.95;
rangeRate = originRangeRate;

// How far past attack range target selection is allowed to search
const TARGET_SEARCH_RANGE_MULTIPLIER = 5;

/**
 * @param {Object} entity - the entity to measure against
 * @param {number} [mult] - multiplier on attack range
 * @returns {boolean} whether the entity is within that range
 */
const inRange = (entity, mult = 1) =>
  !!entity &&
  distance(entity, character) < (character.range + character.xrange) * mult;

/** @returns {boolean} whether the attack cooldown is up */
const isAttackReady = () =>
  ms_to_next_skill("attack") === 0 &&
  !character.s.penalty_cd &&
  character.mp > character.mp_cost;

/**
 * Puts the daggers back after a candy swap; the strategy loop would skip it
 * once the swapped hit kills the target.
 * @returns {Promise}
 */
function restoreRogueWeapons() {
  const { mainhand, offhand } = calculateRogueItemsCached(get_target());
  return equipBatch(
    { mainhand, offhand },
    { preventKeySnatch: false, preventPenaltizeNextAttack: false },
  );
}

/**
 * The selected target as the rogue fights it: in pull mode the best
 * party-aggroed mob, and what to swing at, it when in reach, else the best
 * party-aggroed mob that is.
 * @param {Object} [target]
 * @returns {{focus?: Object, attackTarget?: Object}}
 */
function planFight(target) {
  // A priority boss in view is chased, never traded for a mob in reach
  const priorityBoss = getPriorityBossInView();
  if (priorityBoss)
    return {
      focus: priorityBoss,
      attackTarget: inRange(priorityBoss) ? priorityBoss : undefined,
    };

  const party = getAlliedNames();
  const allAggroedByParty = Object.values(parent.entities)
    .filter(
      (entity) =>
        entity.type === "monster" &&
        !entity.dead &&
        !isCaveFriendly(entity) &&
        (party.has(entity.target) || (entity.cooperative && entity.target)) &&
        !MELEE_IGNORE_LIST.includes(entity.mtype) &&
        inRange(entity, TARGET_SEARCH_RANGE_MULTIPLIER),
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

  if (
    typeof usePullStrategies === "function" &&
    currentStrategy === usePullStrategies &&
    !isPinnedTarget(target)
  ) {
    target = allAggroedByParty[0] ?? target;
  }

  if (!target) return {};

  const attackTarget = inRange(target)
    ? target
    : allAggroedByParty.filter((mob) => mob !== target && inRange(mob))[0];
  return { focus: target, attackTarget };
}

/**
 * Targets what to swing at, else the out-of-reach pick: hitAndRun closes the
 * gap on get_target().
 * @param {Object} [target]
 */
function aimAt(target) {
  const { focus, attackTarget } = planFight(target);
  if (focus) change_target(attackTarget ?? focus);
}

/** @returns {(() => Promise)|undefined} the swing to take now, if any */
function getRogueCast() {
  if (isOnTrip()) return getEnRouteCast();

  const { attackTarget } = planFight(fightTarget);
  if (!attackTarget || attackTarget.dead || !shouldAttack(attackTarget)) return;

  const followUp = getFollowUp(attackTarget);

  // The follow-up goes after the attack, which takes invis's bonus, and lands under the cane
  return () =>
    Promise.allSettled(
      [
        !ms_to_next_skill("invis") && use_skill("invis"),
        castOnAttackCooldown("attack", attackTarget),
        ridesCandySwap(followUp) && castFollowUp(followUp, attackTarget),
        maybeCandySwap(attackTarget, { restore: restoreRogueWeapons }),
      ].filter(Boolean),
    );
}

// --- Skills, each on its own runSkillLoop (see startSkillLoops) ---

/**
 * Nearby character (self included) whose rogue speed is missing or expiring,
 * prioritized party members first.
 * @returns {Object|null} the character to buff, or null
 */
function getRspeedBuffee() {
  const prioritized = prioritizedNames();
  return (
    [...Object.values(parent.entities), character]
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
      })[0] ?? null
  );
}

/**
 * Follow-up attack the mainhand the server holds supports; both share the
 * "quickstab" cooldown key.
 * @returns {string|undefined} "quickstab", "quickpunch", or undefined
 */
function getFollowUpAttackSkill() {
  const currentMainhand = item_info(getServerSlot("mainhand"));
  if (currentMainhand?.wtype === "dagger") return "quickstab";
  if (currentMainhand?.wtype === "fist") return "quickpunch";
  return undefined;
}

/** A follow-up attack is sent and unanswered; both the action and skill loop cast it */
let isFollowUpInFlight = false;

const damageCastMpReserve = () => G.skills["rspeed"].mp * 3;

function getDamageSkills() {
  return [getFollowUpAttackSkill(), "mentalburst"].filter(
    (skill) => skill && meetsRequirements(skill),
  );
}

function damagePerMp(skill, target) {
  const restore = gearAbilityWith({}, "restore_mp");
  const cost = castMpCost(G.skills[skill].mp, character, restore, target);
  return (
    (rogueHitDamage(skill, character, target) *
      rogueLandChance(skill, character, target)) /
    Math.max(1, cost)
  );
}

/** Mp a damage cast leaves: the reserve plus room for each skill doing more per mp */
function damageCastMpFloor(skill, target) {
  const ownRate = damagePerMp(skill, target);
  return getDamageSkills()
    .filter((other) => other !== skill && damagePerMp(other, target) > ownRate)
    .reduce((sum, other) => sum + G.skills[other].mp, damageCastMpReserve());
}

/**
 * @param {Object} [target]
 * @returns {string|undefined} the follow-up attack to cast at the target now, if any
 */
function getFollowUp(target) {
  const skill = getFollowUpAttackSkill();
  if (
    !skill ||
    !target ||
    isFollowUpInFlight ||
    !inRange(target) ||
    !shouldAttack(target) ||
    ms_to_next_skill("quickstab") !== 0 ||
    character.s.penalty_cd ||
    unansweredPenaltyMs > 0 ||
    character.mp <= damageCastMpFloor(skill, target)
  )
    return undefined;
  return skill;
}

/** A kill refunds the mob's hp as mp */
function isMentalBurstKill(mob) {
  const hpLeft = getHpAfterPending(mob);
  return (
    hpLeft > 0 &&
    hpLeft <=
      rogueHitDamage("mentalburst", character, mob, { roll: MIN_DAMAGE_ROLL })
  );
}

function getMentalBurstKill() {
  return Object.values(parent.entities)
    .filter(
      (mob) =>
        mob.type === "monster" &&
        !mob.dead &&
        !mob.cooperative &&
        !mob["1hp"] &&
        !isCaveFriendly(mob) &&
        (isMonsterEngaged(mob) || isHarmlessMob(mob)) &&
        is_in_range(mob, "mentalburst") &&
        shouldAttack(mob) &&
        isMentalBurstKill(mob),
    )
    .sort((lhs, rhs) => getHpAfterPending(rhs) - getHpAfterPending(lhs))[0];
}

/** A kill for the refund, else the target */
function getMentalBurstTarget() {
  if (
    !meetsRequirements("mentalburst") ||
    ms_to_next_skill("mentalburst") !== 0 ||
    character.s.penalty_cd ||
    unansweredPenaltyMs > 0 ||
    character.mp < G.skills["mentalburst"].mp
  )
    return undefined;

  const kill = getMentalBurstKill();
  if (kill) return kill;

  const target = get_target();
  if (
    target?.type !== "monster" ||
    target.dead ||
    !is_in_range(target, "mentalburst") ||
    !shouldAttack(target) ||
    character.mp <= damageCastMpFloor("mentalburst", target)
  )
    return undefined;
  return target;
}

/**
 * @param {string} skill - from getFollowUp
 * @param {Object} target
 * @returns {Promise}
 */
function castFollowUp(skill, target) {
  isFollowUpInFlight = true;
  return Promise.resolve(use_skill(skill, target)).finally(() => {
    isFollowUpInFlight = false;
  });
}

/**
 * @param {string} [skill] - a follow-up attack
 * @returns {boolean} whether it can roll sugarrush off the attack's candy swap
 */
const ridesCandySwap = (skill) =>
  !!skill &&
  !!G.skills[skill].procs &&
  !character.s.sugarrush &&
  findMaxLevelItem("candycanesword") !== -1;

/**
 * @param {string} skill - a follow-up attack
 * @returns {boolean} whether the attack is ready within one of its cooldowns, or was that recently
 */
function isAttackNear(skill) {
  const msToAttack = (parent.next_skill.attack?.getTime() ?? 0) - Date.now();
  return Math.abs(msToAttack) < G.skills[skill].cooldown;
}

function startSkillLoops() {
  // runSkillLoop always calls canUse right before cast, so canUse stashes what
  // it approved and cast reuses it instead of recomputing the scans.
  let pendingRspeedBuffee = null;
  let pendingFollowUpSkill = undefined;
  let pendingBurstTarget = undefined;

  runActionLoop(getRogueCast);

  // Gear only while the attack is on cooldown: equipping re-bases the attack
  // cooldown, so swapping mid-window would delay the shot. Trips included.
  runSkillLoop({
    skill: "gear",
    floorMs: 100,
    whileMoving: true,
    canUse: () => {
      const target = get_target();
      return !isAttackReady() && !!target && inRange(target) && shouldAttack();
    },
    cast: () => equipClassGear(get_target()),
  });

  runSkillLoop({
    skill: "rspeed",
    whileMoving: true,
    canUse: () => {
      if (
        ms_to_next_skill("rspeed") !== 0 ||
        character.mp <= G.skills["rspeed"].mp * 1.5 ||
        !shouldAttack()
      )
        return false;
      pendingRspeedBuffee = getRspeedBuffee();
      return pendingRspeedBuffee != null;
    },
    cast: () => use_skill("rspeed", pendingRspeedBuffee),
  });

  // Keyed on quickstab so the loop paces off that cooldown for either weapon.
  // Held near the attack so getRogueCast sends it under the candy swap.
  runSkillLoop({
    skill: "quickstab",
    canUse: () => {
      pendingFollowUpSkill = getFollowUp(get_target());
      return (
        pendingFollowUpSkill != null &&
        !(
          ridesCandySwap(pendingFollowUpSkill) &&
          isAttackNear(pendingFollowUpSkill)
        )
      );
    },
    cast: () => castFollowUp(pendingFollowUpSkill, get_target()),
  });

  runSkillLoop({
    skill: "mentalburst",
    canUse: () => {
      pendingBurstTarget = getMentalBurstTarget();
      return pendingBurstTarget != null;
    },
    cast: () => use_skill("mentalburst", pendingBurstTarget),
  });
}

async function mainLoop() {
  try {
    desiredElixir = "pumpkinspice";
    assignRoles();

    // buff();

    if (character.rip) {
      throw new Error("Character's down", {
        cause: "death",
      });
    }

    //// EVENTS, THE CRYPT, THEN THE FARMING SPOT
    // Mid-trip it only hands back a target when a higher strategy took over.
    // The action loop swings.
    fightTarget = await selectFightTarget();

    if (fightTarget && !isOnTrip()) aimAt(fightTarget);
  } catch (e) {
    if (e.cause !== "smart_move" && e.cause !== "death") console.error(e);
  }

  setTimeout(mainLoop, getLoopInterval());
}

mainLoop();
startSkillLoops();
