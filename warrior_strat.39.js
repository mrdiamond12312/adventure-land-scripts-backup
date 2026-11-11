// Warrior: gear, cleave planning, and stomp

// Cleave rolls 0.1 to 0.9 of the weapon's damage per hit — this is the floor
const CLEAVE_ONE_HIT_MULTIPLIER = 0.1;

const STUN_FOCUS_LIST = ["crabxx", "grinch"];
const WARRIOR_WEAK_MOB_TYPES = ["pinkgoo", "snowman", "wabbit"];

function getWarriorHelmet(feelingLucky) {
  if (feelingLucky) return "oxhelmet";
  if (character.map === "crypt") return "xhelmet";
  return "fury";
}

function getWarriorMainhand(currentTarget, shouldUseBlaster) {
  if (currentStrategy === usePullStrategies && shouldUseBlaster)
    return "vhammer";
  if (currentTarget && STUN_FOCUS_LIST.includes(currentTarget.mtype))
    return "xmace";
  return "fireblade";
}

function getWarriorOffhand(shouldUseBlaster, feelingLucky) {
  const hasA2InCrypt =
    character.map === "crypt" &&
    Object.values(parent.entities).some(
      (mob) => mob.target === character.name && mob.mtype === "a2",
    );

  if (hasA2InCrypt || feelingLucky) return "mshield";
  if (currentStrategy === usePullStrategies && shouldUseBlaster)
    return "ololipop";
  return "fireblade";
}

function getWarriorAmulet(feelingLucky, isTanker) {
  if (feelingLucky) return "spookyamulet";
  if (Date.now() < paleclawHoldUntil) return "paleclaw";

  const isBeingTargetedByMonster = Object.values(parent.entities)
    .filter((entity) => entity.type === "monster")
    .some((mob) => mob.target === character.name);

  if ((isTanker && isBeingTargetedByMonster) || character.map === "crypt")
    return "snring";
  return pickAmuletWithFrenzy("stramulet");
}

function getWarriorChest(feelingLucky, isTanker) {
  if (feelingLucky) return "cdragon";
  if (character.map === "crypt" || isTanker) return "vattire";
  return "coat1";
}

function calculateWarriorItems() {
  const currentTarget = get_target();
  const shouldUseBlaster =
    numberOfMonsterAroundTarget(currentTarget) >=
      TARGET_TO_SWITCH_TO_BLASTER_WEAPON && !currentTarget?.["1hp"];

  const feelingLucky = shouldWearLuckGear();
  const feelingWise = shouldWearExpGear();
  const isTanker =
    isAssignedAsTanker() && avgDmgTaken(character, "physical") > 300;

  if (currentTarget && WARRIOR_WEAK_MOB_TYPES.includes(currentTarget.mtype)) {
    return {
      mainhand: "rapier",
      offhand: undefined,
      orb: "rabbitsfoot",
      amulet: "spookyamulet",
      chest: "cdragon",
      helmet: "oxhelmet",
      shoes: "wingedboots",
    };
  }

  return {
    helmet: getWarriorHelmet(feelingLucky),
    mainhand: getWarriorMainhand(currentTarget, shouldUseBlaster),
    offhand: getWarriorOffhand(shouldUseBlaster, feelingLucky),
    amulet: getWarriorAmulet(feelingLucky, isTanker),
    shoes: "wingedboots",
    orb: feelingLucky
      ? "rabbitsfoot"
      : feelingWise
      ? "talkingskull"
      : // : "orbofstr"
        "cave_loaded_die",
    chest: getWarriorChest(feelingLucky, isTanker),
    // pants: isTanker ? "frankypants" : "fallen",
    pants: "fallen",
    belt: "strbelt",
    ring1: currentTarget?.armor > 49 ? "suckerpunch" : "strring",
    ring2: currentTarget?.armor > 49 ? "suckerpunch" : "strring",
    earring1: feelingLucky ? "cloverstud" : "cearring",
    earring2: feelingLucky ? "cloverstud" : "cearring",
  };
}

/**
 * Hardest-hitting owned weapon cleave can actually be swung with, the mainhand
 * included — `num` is -1 when it is the one already equipped.
 * @returns {{num: number, info: Object}|undefined} the weapon, or undefined
 */
function getCleaveWeapon() {
  return findOwnedItems((entry) =>
    G.skills.cleave.wtype.includes(entry.info?.wtype),
  )[0];
}

/**
 * @param {number} slots - equipment slots the swap changes
 * @returns {boolean} whether the swap clears before the next attack
 */
function canAffordSwap(slots) {
  const targetedMonster = get_targeted_monster();

  // Moving or out of range means no auto-attack is pending to protect
  const isAutoAttacking =
    !smart.moving &&
    !isAdvanceSmartMoving &&
    !!targetedMonster &&
    distance(character, targetedMonster) <= character.range + character.xrange;

  return (
    !isAutoAttacking ||
    character.ping > 1000 / character.frequency ||
    ms_to_next_skill("attack") > slots * EQUIP_PENALTY_MS + character.ping / 2
  );
}

/** @returns {number} mp the warrior needs for an AOE pull, cleave or agitate alike */
function warriorAoeMpFloor() {
  return G.skills["cleave"].mp + 400 + surgeMpReserve();
}

/** Free time a cycle must leave past the 3-equip bar for cleave to wait for it */
const CLEAVE_ROOM_MIN_MS = 240;

/** @returns {boolean} whether a cycle leaves cleave room to put the weapons back before the next attack */
function hasCleaveRoom() {
  return (
    1000 / character.frequency - 1.5 * character.ping - 3 * EQUIP_PENALTY_MS >=
    CLEAVE_ROOM_MIN_MS
  );
}

/**
 * Every check cleave makes before it swings, its cooldown and in-flight locks aside.
 * @param {string} strategyName - "pull" or "normal"
 * @returns {Object|undefined} the cleave weapon, when cleave would swing now
 */
function planCleave(strategyName) {
  const swapSlots = strategyName === "pull" && hasCleaveRoom() ? 3 : 2;
  if (
    !canAffordSwap(swapSlots) ||
    character.s.penalty_cd ||
    character.cc >= 100
  )
    return;
  return getSafeCleaveWeapon(strategyName);
}

/**
 * planCleave without its timing checks.
 * @param {string} strategyName - "pull" or "normal"
 * @returns {Object|undefined} the cleave weapon, when cleave is safe and worth a swing
 */
function getSafeCleaveWeapon(strategyName) {
  // Aggro at Dorr fails the cave entry
  const isWaitingAtDorr = isPreparingCave && !character.cave;
  if (
    isWaitingAtDorr ||
    character.mp < warriorAoeMpFloor() ||
    Object.keys(character.c).length
  )
    return;

  const mobsList = Object.values(parent.entities).filter(
    (mob) =>
      mob.type === "monster" &&
      !isCaveFriendly(mob) &&
      distance(mob, character) < G.skills["cleave"].range + character.xrange,
  );

  const cleaveWeapon = getCleaveWeapon();

  if (
    !cleaveWeapon ||
    mobsList.some((mob) => MELEE_IGNORE_LIST.includes(mob.mtype)) ||
    mobsList.length === 0
  )
    return;

  const mobsTargetingSelf = listOfMonsterAttacking(character);

  const listOfNoTargetMonsterInRange = mobsList.filter(
    (mob) =>
      !mob.target &&
      !canOneShotWithWeapon(
        cleaveWeapon.info,
        [mob],
        CLEAVE_ONE_HIT_MULTIPLIER,
      ) &&
      !isHarmlessMob(mob),
  );

  const isFeared = !hasCourageFor(
    listOfNoTargetMonsterInRange,
    mobsTargetingSelf,
  );

  const formidableMob = listOfNoTargetMonsterInRange.some(
    (mob) => mob.attack * mob.frequency > MAX_MOB_DPS,
  );

  const allMobs = [...mobsTargetingSelf, ...listOfNoTargetMonsterInRange];
  const totalDpsTaken = totalMobDps(allMobs);

  const healThreshold = strategyName === "pull" ? healerHps() * 0.9 : 0;

  const isSafeToAggro =
    strategyName === "pull"
      ? totalDpsTaken <= healThreshold ||
        listOfNoTargetMonsterInRange.length === 0
      : listOfNoTargetMonsterInRange.length === 0;

  const hasRiskyMob = allMobs.some(
    (mob) =>
      MELEE_IGNORE_LIST.includes(mob.mtype) ||
      WATCHOUT_ABILITIES.some((skill) =>
        Object.keys(mob.abilities ?? {}).includes(skill),
      ),
  );

  const hasBurningNonAggro = listOfNoTargetMonsterInRange.some(
    (mob) => mob.abilities?.burn,
  );

  const isSafeToCleave =
    isSafeToAggro &&
    !hasRiskyMob &&
    !hasBurningNonAggro &&
    !isFeared &&
    !formidableMob;

  return isSafeToCleave ? cleaveWeapon : undefined;
}

/**
 * @param {Object[]} mobs - mobs agitate would pull onto us
 * @returns {Object[]} the ones the cleave about to swing won't aggro anyway
 */
function mobsLeftAfterCleave(mobs) {
  const isCleaveSwinging =
    mobs.length > 0 &&
    character.ctype === "warrior" &&
    ms_to_next_skill("cleave") < character.ping &&
    !!planCleave(currentStrategy === usePullStrategies ? "pull" : "normal");
  if (!isCleaveSwinging) return mobs;

  const cleaveRange = G.skills["cleave"].range;
  return mobs.filter(
    (mob) =>
      mob.target ||
      isCaveFriendly(mob) ||
      distance(mob, character) >= cleaveRange,
  );
}

/** @returns {boolean} whether cleave is able to swing before the next attack */
function isCleaveDue() {
  const attackCycleMs = 1000 / character.frequency;

  // Ready a whole attack cycle without swinging: something else is holding it
  const readySinceMs = Date.now() - (parent.next_skill.cleave?.getTime() ?? 0);
  if (readySinceMs > attackCycleMs) return false;

  return (
    ms_to_next_skill("cleave") < attackCycleMs &&
    !!getSafeCleaveWeapon(
      currentStrategy === usePullStrategies ? "pull" : "normal",
    )
  );
}

/** Until then the amulet slot keeps the paleclaw for cleave's hits in flight */
let paleclawHoldUntil = 0;

/** @returns {number} ms from the cast to cleave's farthest hit, 0 to skip the paleclaw tail */
function getPaleclawTailMs(restoreItems, cleaveWeapon) {
  if (
    !restoreItems.amulet ||
    hasLuck({ name: restoreItems.amulet }) ||
    character.s.frenzied ||
    findMaxLevelItem("paleclaw") === -1
  )
    return 0;

  const projectileKey =
    cleaveWeapon.info?.projectile ?? G.classes[character.ctype].projectile;
  const projectileSpeed = G.projectiles[projectileKey]?.speed;
  const farthestHit = Math.max(
    0,
    ...Object.values(parent.entities)
      .filter(
        (mob) =>
          mob.type === "monster" &&
          distance(mob, character) < G.skills.cleave.range,
      )
      .map((mob) => distance(mob, character)),
  );
  return projectileSpeed && farthestHit > 0
    ? (farthestHit / projectileSpeed) * 1000 + 7
    : 0;
}

const CLEAVE_LEASE = "cleave";
const CLEAVE_SLOTS = ["mainhand", "offhand", "amulet"];
const CLEAVE_LEASE_MS = 2500;

let isCleaving = false;
async function warriorCleave(strategyName) {
  if (
    is_on_cooldown("cleave") ||
    isCleaving ||
    getEquipLeases().length > 0 ||
    isAnySlotBusy(CLEAVE_SLOTS)
  )
    return;

  const cleaveWeapon = planCleave(strategyName);
  if (!cleaveWeapon) return;

  isCleaving = true;
  takeEquipLease(
    CLEAVE_LEASE,
    CLEAVE_SLOTS,
    CLEAVE_LEASE_MS,
    CLEAVE_SLOTS.length * EQUIP_PENALTY_MS,
  );

  const cleaveSet = [];
  if (cleaveWeapon.num >= 0)
    cleaveSet.push({ num: cleaveWeapon.num, slot: "mainhand" });

  const restoreItems = calculateWarriorItems();
  const paleclawTailMs = getPaleclawTailMs(restoreItems, cleaveWeapon);
  if (paleclawTailMs) restoreItems.amulet = "paleclaw";

  // The paleclaw tail needs the budget the mpx swap would spend
  const mpxAmulet = findMaxLevelItem("mpxamulet");
  if (!paleclawTailMs && mpxAmulet >= 0 && canAffordSwap(3))
    cleaveSet.push({ num: mpxAmulet, slot: "amulet" });

  const cleaveSwap = Promise.all([
    getServerSlot("offhand") ? sendUnequip("offhand") : undefined,
    cleaveSet.length ? sendEquips(cleaveSet) : undefined,
  ]);
  const cleaveCast = withTimeout(use_skill("cleave"), 2500);
  // The budget slices the amulet off first, so the paleclaw only rides when it fits
  const restore = equipBatch(restoreItems, { preventKeySnatch: false });
  if (paleclawTailMs && getServerSlot("amulet")?.name === "paleclaw")
    paleclawHoldUntil = Date.now() + paleclawTailMs;

  return Promise.allSettled([cleaveSwap, cleaveCast, restore]).finally(() => {
    isCleaving = false;
    dropEquipLease(CLEAVE_LEASE);
    // equipBatch bails while penalty_cd is up, so retry the restore at the
    // earliest moment it can actually equip
    setTimeout(
      () => equipBatch(calculateWarriorItems()),
      character.s.penalty_cd?.ms ?? 0,
    );
  });
}

let isStomping = false;
async function warriorStomp() {
  const monstersInStompRange = Object.values(parent.entities).filter(
    (mob) =>
      mob.type === "monster" &&
      distance(mob, character) < G.skills["stomp"].range,
  );

  if (
    character.mp < G.skills["stomp"].mp ||
    is_on_cooldown("stomp") ||
    monstersInStompRange.length === 0 ||
    isStomping
  )
    return;

  isStomping = true;

  const promises = [];
  const restoreItems = calculateWarriorItems();

  promises.push(
    equipBatch(
      { mainhand: "basher", offhand: undefined },
      { preventPenaltizeNextAttack: false, preventKeySnatch: false },
    ),
    use_skill("stomp"),
    // Same trick as cleave: the basher only has to be on when the server runs
    // stomp, so restore without waiting for the swap or the skill to resolve
    equipBatch(restoreItems, { preventKeySnatch: false }),
  );

  return Promise.allSettled(promises).finally(() => {
    isStomping = false;
    // equipBatch bails while penalty_cd is up, so retry the restore at the
    // earliest moment it can actually equip
    setTimeout(
      () => equipBatch(calculateWarriorItems()),
      character.s.penalty_cd?.ms ?? 0,
    );
  });
}
