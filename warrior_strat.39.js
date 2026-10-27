// Warrior: gear, cleave planning, and stomp

// Cleave rolls 0.1 to 0.9 of the weapon's damage per hit — this is the midpoint
const CLEAVE_ONE_HIT_MULTIPLIER = 0.5;

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

  const isBeingTargetedByMonster = Object.values(parent.entities)
    .filter((entity) => entity.type === "monster")
    .some((mob) => mob.target === character.name);

  if ((isTanker && isBeingTargetedByMonster) || character.map === "crypt")
    return "snring";
  return "stramulet";
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
    };
  }

  return {
    helmet: getWarriorHelmet(feelingLucky),
    mainhand: getWarriorMainhand(currentTarget, shouldUseBlaster),
    offhand: getWarriorOffhand(shouldUseBlaster, feelingLucky),
    amulet: getWarriorAmulet(feelingLucky, isTanker),
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

/**
 * Every check cleave makes before it swings, its cooldown and in-flight locks aside.
 * @param {string} strategyName - "pull" or "normal"
 * @returns {Object|undefined} the cleave weapon, when cleave would swing now
 */
/** @returns {number} mp the warrior needs for an AOE pull, cleave or agitate alike */
function warriorAoeMpFloor() {
  return G.skills["cleave"].mp + 400 + surgeMpReserve();
}

function planCleave(strategyName) {
  // Aggro at Dorr fails the cave entry
  const isWaitingAtDorr = isPreparingCave && !character.cave;
  if (
    isWaitingAtDorr ||
    !canAffordSwap(2) ||
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
    character.s.penalty_cd ||
    character.cc >= 100 ||
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

  const cleaveRange = G.skills["cleave"].range + character.xrange;
  return mobs.filter(
    (mob) =>
      mob.target ||
      isCaveFriendly(mob) ||
      distance(mob, character) >= cleaveRange,
  );
}

let isCleaving = false;
async function warriorCleave(strategyName) {
  if (is_on_cooldown("cleave") || isCleaving || isEquipingItems) return;

  const cleaveWeapon = planCleave(strategyName);
  if (!cleaveWeapon) return;

  isCleaving = true;
  isEquipingItems = true;

  const cleaveSet = [];
  if (cleaveWeapon.num >= 0)
    cleaveSet.push({ num: cleaveWeapon.num, slot: "mainhand" });

  const mpxAmulet = findMaxLevelItem("mpxamulet");
  if (mpxAmulet >= 0 && canAffordSwap(3))
    cleaveSet.push({ num: mpxAmulet, slot: "amulet" });

  const restoreItems = calculateWarriorItems();
  return Promise.allSettled([
    Promise.all([
      getServerSlot("offhand") ? sendUnequip("offhand") : undefined,
      cleaveSet.length ? sendEquips(cleaveSet) : undefined,
    ]),
    withTimeout(use_skill("cleave"), 2500),
    // Cleave procs sugarcane off whatever the server sees equipped when it
    // runs, so swap back right away instead of waiting on use_skill
    equipBatch(restoreItems, { preventKeySnatch: false }),
  ]).finally(() => {
    isCleaving = false;
    isEquipingItems = false;
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
