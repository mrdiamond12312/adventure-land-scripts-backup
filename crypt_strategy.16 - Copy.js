const DEFEATABLE_BOSSES = ["a3", "a7", "a2"];
const SCARABLE_BOSSES = ["a3", "a7", "a2", "a8", "a5", "a4"];

const VBAT_LOCATION = {
  name: "vbat",
  map: "crypt",
  x: 1191,
  y: -384.5,
};

const CRYPT_STARTING_LOCATION = {
  map: "crypt",
  x: 0,
  y: -226,
};

var snowballThreshold = 10;
var currentJunction = 0;
const CRYPT_JUNCTION = [
  CRYPT_STARTING_LOCATION,
  { x: -210, y: -1085 },
  { x: 375, y: -1085 },
  { x: 741, y: -1085 },
  { x: 726, y: -636 },
  { x: 1185, y: -465 },
  { x: 1544, y: -879 },
  { x: 2039, y: -879 },
  { x: 2491, y: -681 },
  { x: 2682, y: -1100 },
  { x: 2732, y: -1729 },
  { x: 1997, y: -1754 },
  { x: 1216, y: -1485 },
  { x: 373, y: -1305 },
];
/**
 * Executes the Crypt strategy, prioritizing Vbats (up to 7) then specific bosses.
 * Manages movement, target selection, and combat reactions (taunt, absorb, snowball).
 *
 * @param {object} target - The current combat target (will be updated or returned).
 * @returns {object | undefined} The updated combat target.
 */
async function useCryptStrategy(target) {
  // 1. Initial Checks and Setup
  if (!get("cryptInstance") || character.map !== "crypt") {
    return;
  }

  // Recalculate range only if necessary (keeping this logic from original)
  rangeRate = calculateRangeRate() ?? originRangeRate ?? basicRangeRate;

  // Get current state
  const defeatedMobs = get("cryptDefeatedMobs") ?? [];
  const defeatedVbatsCount = defeatedMobs.filter(
    (mtype) => mtype === "vbat",
  ).length;
  const defeatedBossesCount = defeatedMobs.filter(
    (mtype) => mtype !== "vbat",
  ).length;

  // Check for Completion
  if (
    defeatedVbatsCount >= 7 &&
    defeatedBossesCount >= DEFEATABLE_BOSSES.length
  ) {
    set("cryptInstance", undefined);
    log("Crypt strategy complete!");
    return;
  }

  let newTarget = target;

  // 2. Vbat Phase (Prioritize up to 7 Vbats)
  if (defeatedVbatsCount < 7) {
    newTarget = await handleVbatPhase();
  }
  // 3. Boss Phase (Prioritize remaining Defeatable Bosses)
  else {
    newTarget = await handleBossPhase(target);
  }

  // 4. Combat Reaction and Safety Checks
  await handleCombatReactions(newTarget);

  // 5. Class-Specific Combat Skills
  handleClassSkills(newTarget);

  return newTarget;
}

// --- Helper Functions ---

/**
 * Handles the logic for the Vbat phase (collecting 7 Vbat kills).
 * @returns {object | undefined} The selected target for this phase.
 */
async function handleVbatPhase() {
  // Check if Vbat requirement is already met during current movement
  if (
    !get_nearest_monster({ type: "vbat" }) &&
    distance(character, VBAT_LOCATION) < 200
  ) {
    const defeatedCryptMobs = get("cryptDefeatedMobs") ?? [];
    // Add remaining vbats to reach the count of 7
    const vbatsToAdd =
      7 - defeatedCryptMobs.filter((mtype) => mtype === "vbat").length;
    if (vbatsToAdd > 0) {
      defeatedCryptMobs.push(...Array(vbatsToAdd).fill("vbat"));
      set("cryptDefeatedMobs", defeatedCryptMobs);
    }
    return; // Vbat objective met at location
  }

  // Move to Vbat Location if no Vbat is near
  if (
    !get_nearest_monster({ type: "vbat" }) &&
    distance(character, VBAT_LOCATION) > 200
  ) {
    advanceSmartMove(VBAT_LOCATION);
    return;
  }

  // Target Selection for Vbat Phase
  const vbatTarget = isAssignedAsTanker()
    ? get_nearest_monster({ type: "a2" }) ||
      get_target() ||
      get_nearest_monster({ type: "vbat" })
    : get_target_of(get_entity(TANKER)) ||
      get_nearest_monster({ type: "a2" }) ||
      get_nearest_monster({ target: TANKER }) ||
      get_nearest_monster({ target: HEALER }) ||
      get_nearest_monster({ target: MAGE }) ||
      get_nearest_monster({ type: "vbat" });

  // Safety check for dangerous mobs
  if (isTooDangerous()) {
    log("Too dangerous in Vbat phase, retreating to safer junction.");
    advanceSmartMove(getNearestJunction());
    return;
  }

  return vbatTarget;
}

/**
 * Handles the logic for the Boss phase (clearing remaining defeatable bosses).
 * @param {object} currentTarget - The current assigned target.
 * @returns {object | undefined} The selected target for this phase.
 */
async function handleBossPhase(currentTarget) {
  const lastSeenBoss = get("lastSeenDefeatableCryptBoss");

  // Case 1: No current target or current target is not the last seen boss (i.e., we are searching/moving)
  if (!currentTarget || currentTarget?.mtype !== lastSeenBoss?.mtype) {
    if (lastSeenBoss) {
      // Move to last seen boss location
      await advanceSmartMove(lastSeenBoss);
      const boss = get_nearest_monster({ type: lastSeenBoss.mtype });

      if (!boss) {
        // Boss is gone, reset and search
        set("lastSeenDefeatableCryptBoss", undefined);
      } else {
        // Boss found, set as target
        setBossLocation(boss);
        change_target(boss);
        return boss;
      }
    }

    // Case 1b: Search for a new boss
    return searchForNewBoss();
  }

  // Case 2: We are fighting the last seen boss
  const mobsNearTarget = getMobsListNearTarget(currentTarget);
  const elena = Object.values(parent.entities).find(
    (entity) => entity.type === "monster" && entity.mtype === "a5",
  );

  // Safety: Retreat if non-scarable bosses are nearby
  if (mobsNearTarget.some((mob) => !SCARABLE_BOSSES.includes(mob.mtype))) {
    log("Non-scarable boss detected near target, retreating!");
    advanceSmartMove(CRYPT_STARTING_LOCATION);
    set("lastSeenDefeatableCryptBoss", undefined);
    return;
  }

  // Elena's focus logic
  if (elena && elena.focus === currentTarget.id) {
    log("Elena focused on current target, switching to Elena.");
    setBossLocation(elena);
    change_target(elena);
    return elena;
  } else if (currentTarget && elena && currentTarget.mtype === elena.mtype) {
    const elenaPartner = elena.focus ? parent.entities[elena.focus] : undefined;
    if (elenaPartner && !elenaPartner.target) {
      log("Elena's partner found and untargeted, switching to partner.");
      setBossLocation(elenaPartner);
      change_target(elenaPartner);
      return elenaPartner;
    }
  }

  // Default: Continue targeting the current boss
  setBossLocation(currentTarget);
  return currentTarget;
}

/**
 * Searches for a nearby defeatable boss that doesn't have too many mobs nearby.
 * Moves through junctions if no boss is found immediately.
 * @returns {object | undefined} The found boss or undefined.
 */
function searchForNewBoss() {
  return new Promise(async (resolve) => {
    const checkBossInterval = setInterval(() => {
      const nearbyBoss = Object.values(parent.entities).find(
        (mob) =>
          mob.type === "monster" &&
          DEFEATABLE_BOSSES.includes(mob.mtype) &&
          getMobsListNearTarget(mob).length < 2,
      );

      if (nearbyBoss) {
        log(`Found new boss: ${nearbyBoss.mtype}`);
        setBossLocation(nearbyBoss);
        change_target(nearbyBoss);
        clearInterval(checkBossInterval);
        resolve(nearbyBoss);
      }
    }, 2000);

    // Advance to the next junction while searching
    await advanceSmartMove(
      CRYPT_JUNCTION[currentJunction++ % CRYPT_JUNCTION.length],
    ).then(() => {
      clearInterval(checkBossInterval);
      // This is necessary because the advanceSmartMove might finish before the interval finds a target
      // and we need to ensure the promise resolves. If a boss was found, it already resolved.
      // If no boss was found during the movement, we resolve with undefined.
      if (!get("lastSeenDefeatableCryptBoss")) resolve(undefined);
    });
  });
}

/**
 * Helper to check for dangerous conditions (too many non-scarable bosses or too many total mobs).
 * @returns {boolean} True if the situation is deemed too dangerous.
 */
function isTooDangerous() {
  const nearestKillableBosses = Object.values(parent.entities).filter(
    (mob) =>
      mob.type === "monster" &&
      DEFEATABLE_BOSSES.includes(mob.mtype) &&
      distance(character, mob) < 200,
  );

  const partyPriest = get_player(HEALER);

  // const nearestFormidableBosses = Object.values(parent.entities).filter(
  //   (mob) =>
  //     mob.type === "monster" &&
  //     !mob.s.sleeping &&
  //     ![...SCARABLE_BOSSES, "vbat"].includes(mob.mtype) &&
  //     distance(character, mob) < 300,
  // );

  // Retreat if formidable bosses exist OR if too many killable bosses are present
  return (
    nearestFormidableBosses.length > 0 ||
    avgPartyDmgTaken() > (partyPriest?.heal ?? 500)
  );
}

/**
 * Gets the safest junction to retreat to (the farthest one).
 * @returns {object} The location object of the safest junction.
 */
function getNearestJunction() {
  return CRYPT_JUNCTION.sort(
    (lhs, rhs) => distance(character, lhs) - distance(character, rhs),
  ).pop();
}

/**
 * Sets the last seen boss in global state.
 * @param {object} boss - The monster entity.
 */
function setBossLocation(boss) {
  if (!boss) return;
  set("lastSeenDefeatableCryptBoss", {
    mtype: boss.mtype,
    x: boss.x,
    y: boss.y,
    map: character.map,
  });
}

/**
 * Handles emergency combat reactions like scaring away mobs or retreating.
 * @param {object} currentTarget - The current target.
 */
async function handleCombatReactions(currentTarget) {
  const isOverwhelmed =
    listOfMonsterAttacking(character).length >
      (currentStrategy === usePullStrategies ? 4 : 1) ||
    character.hp < character.max_hp * 0.6;

  if (isOverwhelmed) {
    log("Overwhelmed or low HP, scaring away mobs!");
    await scareAwayMobs();

    if (!get_entity(HEALER)) {
      advanceSmartMove(CRYPT_STARTING_LOCATION);
    }
  }

  // Switch strategies based on target type
  if (currentTarget?.mtype === "vbat") {
    changeToPullStrategies();
  } else {
    changeToNormalStrategies();
  }
}

/**
 * Handles class-specific skills (Snowball, Taunt, Absorb).
 * @param {object} target - The current combat target.
 */
function handleClassSkills(target) {
  const mobTargetingAlly = Object.values(parent.entities).find((mob) => {
    return (
      [...DEFEATABLE_BOSSES, "vbat"].includes(mob.mtype) &&
      partyMems.includes(mob.target) &&
      mob.target !== character.name
    );
  });

  switch (character.ctype) {
    case "warrior":
      handleWarriorSkills(target, mobTargetingAlly);
      break;
    case "priest":
      handlePriestSkills(mobTargetingAlly);
      break;
    case "mage":
      break;
    default:
      break;
  }
}

function handleWarriorSkills(target, mobTargetingAlly) {
  // Snowball logic
  if (
    target &&
    (target.mtype === "a2" ||
      ![...DEFEATABLE_BOSSES, "vbat"].includes(target.mtype)) &&
    (!target.s?.frozen || target.s.frozen.ms < 300) &&
    locate_item("snowball") !== -1 &&
    is_in_range(target, "snowball") &&
    !is_on_cooldown("snowball")
  ) {
    if (snowballThreshold < 0) {
      use_skill("snowball", target);
      snowballThreshold = 10;
    } else {
      snowballThreshold--;
    }
  }

  // Taunt logic
  if (
    isAssignedAsTanker() &&
    character.mp > G.skills["taunt"].mp &&
    !is_on_cooldown("taunt") &&
    mobTargetingAlly &&
    character.hp > character.max_hp * 0.4
  ) {
    use_skill("taunt", mobTargetingAlly).then(() =>
      reduce_cooldown("taunt", character.ping * 0.95),
    );
  }
}

function handlePriestSkills(mobTargetingAlly) {
  // Absorb for party
  const lowHpMember = partyMems
    .map((id) => get_entity(id))
    .filter((char) => char)
    .find((char) => char.hp < char.max_hp * 0.3);

  const absorbTarget =
    isAssignedAsTanker() && mobTargetingAlly
      ? get_player(mobTargetingAlly.target) // Absorb for ally tanked by mob
      : lowHpMember; // Absorb for lowest HP member

  if (
    absorbTarget &&
    is_in_range(absorbTarget, "absorb") &&
    character.mp > G.skills["absorb"].mp &&
    !is_on_cooldown("absorb")
  ) {
    use_skill("absorb", absorbTarget);
  }
}

function addToDefeatedList(mobs) {
  const defeatedCryptMobs = get("cryptDefeatedMobs");
  defeatedCryptMobs.push(...mobs);
  set("cryptDefeatedMobs", defeatedCryptMobs);
}

character.on("target_hit", (data) => {
  if (data.kill) {
    const target = parent.entities[data?.target]?.mtype;
    if ([...DEFEATABLE_BOSSES, "vbat"].includes(target)) {
      addToDefeatedList([target]);
      set("lastSeenDefeatableCryptBoss", undefined);
    }
  }
});
