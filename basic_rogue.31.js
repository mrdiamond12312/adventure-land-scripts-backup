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

const reduceCd = (skillName, isPingBased = true) =>
  reduce_cooldown(
    skillName,
    isPingBased ? Math.min(...parent.pings) : character.ping * 0.95,
  );

/**
 * @param {Object} entity - the entity to measure against
 * @returns {boolean} whether the entity is within attack range
 */
const inRange = (entity) =>
  distance(entity, character) < character.range + character.xrange;

/** @returns {boolean} whether the attack cooldown is up */
const isAttackReady = () =>
  ms_to_next_skill("attack") === 0 && !character.s.penalty_cd;

async function fight(target) {
  // Snapshot for attackSpeedCompensate: weapon swaps mid-tick change frequency,
  // and the attack cooldown must be timed with the frequency at fire time.
  const attackFrequencyBeforeCompensate = character.frequency;

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

  if (isAttackReady() && inRange(target) && shouldAttack()) {
    if (!ms_to_next_skill("invis")) {
      promisesToAwait.push(use_skill("invis").then(() => reduceCd("invis")));
    }
    promisesToAwait.push(
      attack(target)
        .then(() => {
          attackSpeedCompensate(attackFrequencyBeforeCompensate);
          reduceCd("attack", false);
        })
        .catch((e) => {
          attackErrorHandler(e);
        }),
    );

    set_message("Attacking");
  }

  try {
    await withTimeout(Promise.allSettled(promisesToAwait), 2500);
  } catch (e) {}
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
 * Follow-up attack the current mainhand supports; both share the "quickstab"
 * cooldown key.
 * @returns {string|undefined} "quickstab", "quickpunch", or undefined
 */
function getFollowUpAttackSkill() {
  const currentMainhand = item_info(character.slots.mainhand);
  if (currentMainhand?.wtype === "dagger") return "quickstab";
  if (currentMainhand?.wtype === "fist") return "quickpunch";
  return undefined;
}

function startSkillLoops() {
  // runSkillLoop always calls canUse right before cast, so canUse stashes what
  // it approved and cast reuses it instead of recomputing the scans.
  let pendingRspeedBuffee = null;
  let pendingFollowUpSkill = undefined;

  // Gear only while the attack is on cooldown: equipping re-bases the attack
  // cooldown, so swapping mid-window would delay the shot.
  runSkillLoop({
    skill: "strategy",
    floorMs: 100,
    canUse: () => {
      const target = get_target();
      return (
        !isAttackReady() && !!target && inRange(target) && shouldAttack()
      );
    },
    cast: () => currentStrategy(get_target()),
  });

  runSkillLoop({
    skill: "rspeed",
    whileMoving: true,
    canUse: () => {
      if (
        ms_to_next_skill("rspeed") !== 0 ||
        character.mp <= G.skills["rspeed"].mp ||
        !shouldAttack()
      )
        return false;
      pendingRspeedBuffee = getRspeedBuffee();
      return pendingRspeedBuffee != null;
    },
    cast: () => use_skill("rspeed", pendingRspeedBuffee),
  });

  // Keyed on quickstab so the loop paces off that cooldown for either weapon.
  runSkillLoop({
    skill: "quickstab",
    canUse: () => {
      const target = get_target();
      if (!target) return false;
      if (
        !inRange(target) ||
        !shouldAttack(target) ||
        ms_to_next_skill("quickstab") !== 0 ||
        character.mp <= G.skills["rspeed"].mp * 2
      )
        return false;
      pendingFollowUpSkill = getFollowUpAttackSkill();
      return pendingFollowUpSkill != null;
    },
    cast: () =>
      use_skill(pendingFollowUpSkill, get_target()).then(() =>
        reduceCd(pendingFollowUpSkill),
      ),
  });
}

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

mainLoop();
startSkillLoops();
