// Load basic functions from other code snippet
if (parent.caracAL) {
  parent.caracAL
    .load_scripts([
      "adventure-land-scripts-backup/basic_function.7.js",
      "adventure-land-scripts-backup/other_class_msg_listener.8.js",
    ])
    .then(() => dependenciesLoaded)
    .then(() => {
      mainLoop();
      startSkillLoops();
    });
} else {
  load_code(7);
  load_code(8);
}

// Kiting
var originRangeRate = 0.6;
rangeRate = originRangeRate;

// Utils
const isCooperative = (monster) => monster.cooperative;
const isMob = (entity) => entity.type === "monster";
const reduceCd = (skillName, isPingBased = true) =>
  reduce_cooldown(
    skillName,
    isPingBased ? Math.min(...parent.pings) : character.ping * 0.95,
  );

const tryMultiShot = async (skill, entityList) => {
  if (entityList.length === 0) return false;
  set_message(`${skill} Shooting`);
  // Snapshot at fire time: cupid<->bow swaps change frequency mid-tick, and
  // the attack cooldown must be timed with the frequency the shot went out at.
  const attackFrequencyBeforeCompensate = character.frequency;
  return use_skill(skill, entityList)
    .then(() => {
      attackSpeedCompensate(attackFrequencyBeforeCompensate);
      reduceCd("attack", false);
    })
    .catch((e) => attackErrorHandler(e));
};

const inRange = (entity) =>
  distance(entity, character) < character.range + character.xrange * 0.5;

/** @returns {boolean} whether the attack cooldown is up */
const isAttackReady = () =>
  ms_to_next_skill("attack") === 0 && !character.s.penalty_cd;

// --- Decide: one plan drives both the gear loop and the shot ---

/** @returns {boolean} whether cupid is the equipped mainhand */
// Literal, not RANGER_INV_ITEMS.cupid: strategic_fn.11.js may not be loaded yet
// on the first mainLoop tick.
const isCupidEquipped = () => character.slots.mainhand?.name === "cupid";

/**
 * Mobs worth shooting right now, annotated with cluster count and distance,
 * best first.
 * @returns {Object[]} the sorted candidates
 */
function getPotentialTargets() {
  const explosionRadius = getSplashRadius();

  return Object.values(parent.entities)
    .filter(
      (entity) =>
        entity.type === "monster" &&
        !entity.dead &&
        !entity.rip &&
        inRange(entity) &&
        !entity.s?.fullguardx &&
        (isHarmlessMob(entity) ||
          (entity.cooperative && !partyMems.includes(entity.target)) ||
          entity.target),
    )
    .map((entity) => {
      // Optimization: Pre-calculate cluster count and distance
      entity.cluster_count = numberOfMonsterAroundTarget(
        entity,
        explosionRadius,
      );
      entity.distance = distance(character, entity);
      return entity;
    })
    .sort((lhs, rhs) => {
      // Cooperative and target prioritization (Highest Priority)
      if (lhs.cooperative || (lhs.target && !rhs.target)) return -1;
      if (rhs.cooperative || (rhs.target && !lhs.target)) return 1;

      return (
        // Sort by cluster count
        rhs.cluster_count - lhs.cluster_count ||
        rhs.hp - lhs.hp ||
        lhs.distance - rhs.distance
      );
    });
}

/**
 * Cupid heal plan: 5shot > 3shot > single. Only valid while cupid is equipped;
 * currentStrategy owns the swap itself.
 * @param {Object[]} healees - from getCupidHealees
 * @returns {{mode: string, skill: string, gearTargets: Object[], shotTargets: Object[]|Object}}
 */
function getCupidPlan(healees) {
  const preservedMP = G.skills["huntersmark"].mp;
  const is5ShotReady =
    character.level >= G.skills["5shot"].level &&
    healees.length >= 4 &&
    character.mp > G.skills["5shot"].mp + preservedMP;
  const is3ShotReady =
    character.level >= G.skills["3shot"].level &&
    healees.length >= 2 &&
    character.mp > G.skills["3shot"].mp + preservedMP;

  const skill = is5ShotReady ? "5shot" : is3ShotReady ? "3shot" : "attack";
  const sliceAmount = is5ShotReady ? 5 : is3ShotReady ? 3 : 1;

  return {
    mode: "cupid",
    skill,
    gearTargets: healees,
    shotTargets:
      skill === "attack" ? healees[0] : healees.slice(0, sliceAmount),
  };
}

/**
 * Shot plan: 5shot > 3shot > single. `gearTargets` is what the gear decision
 * reads, `shotTargets` is what gets shot (they differ for cupid, which shoots
 * the wider list).
 * @param {Object} [incomingTarget] - target from mainLoop, or the current one
 * @returns {{mode: string, skill: string, target: Object, gearTargets: Object[]|Object, shotTargets: Object[]|Object}|null}
 */
function getShotPlan(incomingTarget = get_targeted_monster()) {
  const potentialTargets = getPotentialTargets();
  // Wrapped, not passed by reference: filter would hand isWeakMob the index as
  // its multiplier.
  const weakMobs = potentialTargets.filter((mob) => isWeakMob(mob));
  const canMultiShot = !character.fear;
  const isCupid = isCupidEquipped();

  let target = incomingTarget;
  if (potentialTargets.length && !target?.mtype.includes("crabx")) {
    target = potentialTargets[0];
  }

  // Reacquire target if feared (the scare itself runs on its own loop)
  if (character.fear) {
    const aggroing = potentialTargets.find(
      (mob) => mob.target === character.name,
    );
    if (aggroing) target = aggroing;
  }

  const hpOk = character.hp > character.max_hp * 0.55;
  const mobsTo5Shot = weakMobs.slice(0, 5);
  const is5ShotReady =
    character.level >= G.skills["5shot"].level &&
    canMultiShot &&
    hpOk &&
    character.mp > G.skills["5shot"].mp + G.skills["huntersmark"].mp + 400 &&
    weakMobs.length >= 4 &&
    mobsTo5Shot.every((mob) => isSafeToShoot(mob));

  const mobsTo3Shot = potentialTargets.slice(0, 3);
  const is3ShotReady =
    character.level >= G.skills["3shot"].level &&
    canMultiShot &&
    hpOk &&
    character.mp > G.skills["3shot"].mp + G.skills["huntersmark"].mp + 400 &&
    potentialTargets.length >= 2 &&
    mobsTo3Shot.every((mob) => isSafeToShoot(mob));

  const shotPlan = (skill, target, gearTargets, shotTargets) => ({
    mode: "shot",
    skill,
    target,
    gearTargets,
    shotTargets,
  });

  if (is5ShotReady)
    return shotPlan(
      "5shot",
      target,
      mobsTo5Shot,
      isCupid ? potentialTargets.slice(0, 5) : mobsTo5Shot,
    );

  if (is3ShotReady) return shotPlan("3shot", target, mobsTo3Shot, mobsTo3Shot);

  if (target && isSafeToShoot(target) && inRange(target))
    return shotPlan("attack", target, target, target);

  return null;
}

/**
 * What the ranger should do this tick. Healing only wins once currentStrategy
 * has actually put cupid in hand; until then the ranger keeps shooting mobs.
 * @param {Object} [incomingTarget] - target from mainLoop, or the current one
 * @returns {Object|null} the plan, or null when there is nothing to do
 */
function getActionPlan(incomingTarget = get_targeted_monster()) {
  const healees = isCupidEquipped() ? getCupidHealees() : [];
  return healees.length ? getCupidPlan(healees) : getShotPlan(incomingTarget);
}

// --- Act ---

/**
 * Fires the plan's skill: a cupid heal at allies, or a shot at mobs.
 * @param {Object} plan - from getActionPlan
 */
async function firePlan(plan) {
  if (!isAttackReady()) return;

  const attackFrequencyBeforeCompensate = character.frequency;
  const promisesToAwait = [];

  // Cupid heals whatever it hits, so shooting mobs with it feeds them. Swap
  // concurrently with the shot instead of waiting for the gear loop's gap.
  if (plan.mode === "shot" && isCupidEquipped()) {
    promisesToAwait.push(currentStrategy(plan.gearTargets));
  }

  if (plan.skill === "attack") {
    set_message(plan.mode === "cupid" ? "Single Cupid" : "Shooting");
    promisesToAwait.push(
      use_skill("attack", plan.shotTargets)
        .then(() => {
          attackSpeedCompensate(attackFrequencyBeforeCompensate);
          reduceCd("attack", false);
        })
        .catch((e) => attackErrorHandler(e)),
    );
  } else {
    promisesToAwait.push(tryMultiShot(plan.skill, plan.shotTargets));
  }

  try {
    await withTimeout(Promise.allSettled(promisesToAwait), 1500);
  } catch (e) {
    console.log(e);
  }
}

async function fight(target) {
  const plan = getShotPlan(target);
  if (!plan) return;

  if (plan.target) change_target(plan.target);
  return firePlan(plan);
}

// --- Skills, each on its own runSkillLoop (see startSkillLoops) ---

// Mp held back by the skill checks so a temporal surge stays affordable
const SURGE_MP_OFFSET = 1000;

// Below this hp a mob dies too fast for the mark to pay for its mp
const MARK_HP_THRESHOLD = 15_000;

/**
 * Beefiest unmarked mob aggroed onto the party and in mark range.
 * @returns {Object|null} the mob to mark, or null
 */
function getHuntersMarkTarget() {
  if (character.mp < SURGE_MP_OFFSET || is_on_cooldown("huntersmark"))
    return null;

  const party = new Set([...partyMems, partyMerchant, ...parent.party_list]);

  return (
    Object.values(parent.entities)
      .filter(
        (entity) =>
          entity.type === "monster" &&
          entity.target &&
          party.has(entity.target) &&
          !entity.s?.marked &&
          entity.hp > MARK_HP_THRESHOLD &&
          is_in_range(entity, "huntersmark"),
      )
      .sort((lhs, rhs) => rhs.hp - lhs.hp)[0] ?? null
  );
}

const EMERGENCY_HEAL_HP_RATIO = 0.45;
const SUPERSHOT_DAMAGE_MULTIPLIER = 1.5;

/**
 * Critically hurt ally in supershot range. Supershot heals through cupid and
 * outranges it, so it doubles as the emergency reach heal.
 * @returns {Object|null} the player to heal, or null
 */
function getEmergencyHealee() {
  if (character.fear) return null;

  return (
    getPlayersToHeal()
      .filter(
        (player) =>
          player.name !== character.name &&
          player.hp < player.max_hp * EMERGENCY_HEAL_HP_RATIO &&
          is_in_range(player, "supershot"),
      )
      .sort((lhs, rhs) => lhs.hp / lhs.max_hp - rhs.hp / rhs.max_hp)[0] ?? null
  );
}

/** @returns {boolean} whether a live party priest is close enough to cover us */
function isHealerNearby() {
  const partyHealer = get_entity(HEALER) ?? get_entity(RANGER);
  return (
    !!partyHealer &&
    partyHealer.ctype === "priest" &&
    !partyHealer.rip &&
    distance(partyHealer, character) <
      (partyHealer.range ?? character.range * 0.7)
  );
}

/**
 * Nearest mob the bow cannot reach but supershot can, falling back to a
 * cooperative mob then the current target.
 * @returns {Object|null} the mob to supershot, or null
 */
function getSuperShotTarget() {
  const target = get_targeted_monster();
  const entitiesInVision = Object.values(parent.entities);
  const coopTarget = target?.cooperative
    ? target
    : entitiesInVision.find((entity) => isMob(entity) && isCooperative(entity));

  // Taking the aggro is fine when the mob barely hits, already has someone
  // else, dies to the shot (isWeakMob covers both), or the priest can cover us.
  const healerNearby = isHealerNearby();
  const isSafeToSuperShot = (mob) =>
    isHarmlessMob(mob) || isWeakMob(mob, SUPERSHOT_DAMAGE_MULTIPLIER);
  // || healerNearby

  // The long shot is wasted on a mob any normal hit would kill
  const isWorthSuperShooting = (mob) =>
    !!mob && !mob["1hp"] && !inRange(mob) && is_in_range(mob, "supershot");

  return (
    entitiesInVision
      .filter(
        (entity) =>
          isMob(entity) &&
          isWorthSuperShooting(entity) &&
          isSafeToSuperShot(entity),
      )
      .sort((lhs, rhs) => distance(character, lhs) - distance(character, rhs))
      .shift() ??
    [coopTarget, target].find(isWorthSuperShooting) ??
    null
  );
}

function startSkillLoops() {
  // runSkillLoop always calls canUse right before cast, so canUse stashes what
  // it approved and cast reuses it instead of recomputing the scans.
  let pendingPlan = null;
  let pendingMarkTarget = null;
  let pendingSuperShotTarget = null;

  // Exception: cupid left in hand with no one to heal jumps the queue, so the
  // ranger is not shooting mobs with a heal bow.
  runSkillLoop({
    skill: "strategy",
    floorMs: 100,
    canUse: () => {
      // Cheap gate first: only cupid, or a bare mainhand, justifies the scan
      // mid-window.
      if (isAttackReady() && !isCupidEquipped() && character.slots.mainhand)
        return false;
      pendingPlan = getActionPlan();
      // No plan still equips: that is how a bare mainhand recovers.
      if (!pendingPlan) return true;
      return !isAttackReady() || pendingPlan.mode === "shot";
    },
    cast: () => currentStrategy(pendingPlan?.gearTargets),
  });

  // Own loop to narrow the gap between marks (was the TODO in fight).
  runSkillLoop({
    skill: "huntersmark",
    canUse: () => {
      if (isCupidEquipped()) return false;
      pendingMarkTarget = getHuntersMarkTarget();
      return pendingMarkTarget != null;
    },
    cast: () =>
      use_skill("huntersmark", pendingMarkTarget).then(() =>
        reduceCd("huntersmark"),
      ),
  });

  // Cupid in hand turns supershot into the emergency heal; a bow shoots mobs.
  runSkillLoop({
    skill: "supershot",
    canUse: () => {
      if (character.mp <= 400 + SURGE_MP_OFFSET || is_on_cooldown("supershot"))
        return false;
      pendingSuperShotTarget = isCupidEquipped()
        ? getEmergencyHealee()
        : getSuperShotTarget();
      return pendingSuperShotTarget != null;
    },
    cast: () => {
      // The mainhand can flip between canUse and cast: never supershot a mob
      // with cupid (it heals the mob), nor an ally with a bow.
      const isHealee = pendingSuperShotTarget.type === "character";
      if (isHealee !== isCupidEquipped()) return Promise.resolve();

      return use_skill("supershot", pendingSuperShotTarget).then(() =>
        reduceCd("supershot"),
      );
    },
  });

  runSkillLoop({
    skill: "scare",
    canUse: () => character.fear,
    cast: () => scareAwayMobs(),
  });
}

async function mainLoop() {
  try {
    desiredElixir = "pumpkinspice";
    assignRoles();

    if (character.rip) {
      respawn();
      throw new Error("Character's down", {
        cause: "death",
      });
    }

    publishEntFieldReport();

    // Cupid heal, only once currentStrategy put cupid in hand
    const cupidHealees = isCupidEquipped()
      ? getCupidHealees(getPlayersToHeal())
      : [];
    const isDeterminedToBeCupid = cupidHealees.length > 0;
    if (isDeterminedToBeCupid) await firePlan(getCupidPlan(cupidHealees));

    // Prevent the rest of loop while smartmoving
    const isMovingControlled =
      (smart.moving || isAdvanceSmartMoving) && !smartmoveDebug;
    if (isMovingControlled) {
      throw new Error("Smart moving", {
        cause: "smart_move",
      });
    }

    // Default target
    let target = getTarget();

    // Crypt & Events
    if (get("cryptInstance")) {
      target = await useCryptStrategy(target);
    } else {
      target = await changeToDailyEventTargets();
    }

    // Smartmove if needed
    if (!target) {
      const needsToEnterCrypt =
        get("cryptInstance") && character.map !== "crypt";
      const isPartyLeaderOrAlone =
        partyMems[0] === character.name || !get_entity(partyMems[0]);
      const isFarFromFarmingSpot =
        distance(character, { x: mapX, y: mapY, map }) > 500;

      const needsToMoveToFarmLocation =
        !get("cryptInstance") && (isPartyLeaderOrAlone || isFarFromFarmingSpot);

      if (needsToEnterCrypt) {
        changeToNormalStrategies();
        advanceSmartMove(CRYPT_STARTING_LOCATION);
      } else if (needsToMoveToFarmLocation) {
        log("Moving to farming location");
        changeToNormalStrategies();
        advanceSmartMove({
          map,
          x: mapX,
          y: mapY,
        });
      }
    } else if (!isDeterminedToBeCupid) {
      // Target found, engage in combat
      await fight(target);
    }
  } catch (e) {
    // Only log unhandled errors
    if (e.cause !== "smart_move" && e.cause !== "death") {
      console.error(e);
    }
  }

  setTimeout(mainLoop, getLoopInterval());
}

if (!parent.caracAL) {
  mainLoop();
  startSkillLoops();
}
