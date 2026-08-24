const MAX_TARGET = 10;
const BLAST_DIVISOR = 3.6;
const BLAST_RADIUS = getMaxBlastRadius() || 17;
const TARGET_TO_SWITCH_TO_BLASTER_WEAPON = 2;
const MAX_MOB_DPS = 2500;
// Sleeping mobs a single cburst must wake to be worth the mp
const CBURST_MIN_BATCH = 3;
const EQUIP_PENALTY_MS = 120;
const SHIFT_PENALTY_MS = 240;
const BOOSTERS = ["goldbooster", "xpbooster", "luckbooster"];
const WATCHOUT_ABILITIES = ["burn", "stone"];
const IGNORE_ABILITIES = ["stone"];

function getMaxBlastRadius() {
  const classData = G.classes[character.ctype];

  const allowedMainTypes = new Set(Object.keys(classData.mainhand ?? {}));
  const allowedOffTypes = new Set(Object.keys(classData.offhand ?? {}));
  const allowedDoubleTypes = new Set(Object.keys(classData.doublehand ?? {}));

  const candidates = [
    character.slots.mainhand,
    character.slots.offhand,
    ...character.items,
  ]
    .filter(Boolean)
    .map((item) => {
      const info = item_info(item);
      if (info?.level == null) return null;

      return {
        item,
        type: info.wtype ?? info.type,
        blast: info.blast ?? info.explosion ?? 0,
        level: info.level,
      };
    })
    .filter(Boolean);

  const mainCandidates = candidates.filter(({ type }) =>
    allowedMainTypes.has(type),
  );
  const offCandidates = candidates.filter(({ type }) =>
    allowedOffTypes.has(type),
  );
  const doubleCandidates = candidates.filter(({ type }) =>
    allowedDoubleTypes.has(type),
  );

  let bestBlast = doubleCandidates.reduce(
    (accumulator, { blast }) => Math.max(accumulator, blast),
    0,
  );

  for (const main of mainCandidates) {
    for (const off of offCandidates) {
      if (main.item === off.item) continue;
      bestBlast = Math.max(bestBlast, main.blast + off.blast);
    }
  }

  return bestBlast / BLAST_DIVISOR;
}

/**
 * Radius our own splash currently covers.
 * @param {number} [fallback] - used when we carry no splash at all
 * @returns {number} the radius
 */
function getSplashRadius(fallback = BLAST_RADIUS) {
  const splash = character.explosion || character.blast || 0;
  return splash / BLAST_DIVISOR || fallback;
}

function mobsListAroundTarget(target, blastRadius = BLAST_RADIUS) {
  if (!target) return [];

  return Object.values(parent.entities).filter(
    (entity) =>
      entity.type === "monster" &&
      distance(target, entity) < blastRadius &&
      entity.target,
  );
}

function getRelevantPiercing(wtype) {
  const classData = G.classes?.[character.ctype];
  if (!classData) return 0;

  const damageType = classData.damage_type;
  const weaponData = classData.mainhand?.[wtype];

  if (!weaponData) return 0;

  if (damageType === "physical") return weaponData.apiercing ?? 0;
  if (damageType === "magical") return weaponData.rpiercing ?? 0;

  return 0;
}

function getMobDefense(mob) {
  const damageType = G.classes[character.ctype]?.damage_type;

  if (damageType === "physical") return mob.armor ?? 0;
  if (damageType === "magical") return mob.resistance ?? 0;

  return 0;
}

function rawAttackMultiplier() {
  const mainStat = G.classes[character.ctype].main_stat;

  if (character.ctype === "paladin")
    return character.str / 20 + character.int / 40;

  return character[mainStat] / 20;
}

/**
 * Attack we would have holding this weapon: the raw difference against what is
 * in hand, scaled by our stats, on top of the attack we already have.
 * @param {Object} weaponInfo - item_info of the weapon
 * @returns {number} the attack
 */
function effectiveAttackWith(weaponInfo) {
  const currentAttack = character.slots.mainhand
    ? item_info(character.slots.mainhand).attack ?? 0
    : 0;

  return (
    character.attack +
    ((weaponInfo?.attack ?? 0) - currentAttack) * (rawAttackMultiplier() + 1)
  );
}

/**
 * Whether any target dies to a single hit of this weapon.
 * @param {Object} weaponInfo - item_info of the weapon
 * @param {Object[]} targets - mobs to test
 * @param {number} [multiplier] - damage scaling of the skill, when it is not a
 * plain attack whose scaling follows the target count
 * @returns {boolean}
 */
function canOneShotWithWeapon(weaponInfo, targets, multiplier) {
  const classData = G.classes[character.ctype];
  const damageType = classData.damage_type;

  const currentInfo = character.slots.mainhand
    ? item_info(character.slots.mainhand)
    : { attack: 0, name: null, wtype: null };

  const effectiveAttack = effectiveAttackWith(weaponInfo);

  let effectivePiercing =
    damageType === "physical" ? character.apiercing : character.rpiercing;

  if (currentInfo.name !== weaponInfo.name) {
    effectivePiercing += getRelevantPiercing(weaponInfo.wtype);
  }

  const piercingMultiplier = damageType === "physical" ? 2 : 1;
  const shotMultiplier =
    multiplier ?? (targets.length >= 4 ? 0.5 : targets.length >= 2 ? 0.7 : 1);

  return targets.some((mob) => {
    const defense = getMobDefense(mob);
    const dmg =
      dps_multiplier(defense - effectivePiercing * piercingMultiplier) *
      effectiveAttack *
      0.9 *
      shotMultiplier;

    return mob.max_hp <= dmg;
  });
}

/**
 * An unaggroed mob inside the blast radius — one a splash would wake.
 * @param {Object} target - centre of the blast
 * @param {number} [blastRadius] - radius to scan
 * @param {(mob: Object) => boolean} [counts] - only count mobs passing this
 * @returns {boolean}
 */
function hasUntargetedMonsterAround(
  target,
  blastRadius = BLAST_RADIUS,
  counts = () => true,
) {
  if (!target) return false;

  return Object.values(parent.entities).some(
    (entity) =>
      entity.type === "monster" &&
      !entity.target &&
      distance(target, entity) < blastRadius &&
      counts(entity),
  );
}

function numberOfMonsterAroundTarget(target, blastRadius = BLAST_RADIUS) {
  if (!target) return 0;

  if (
    !["warrior", "priest", "paladin"].includes(character.ctype) &&
    hasUntargetedMonsterAround(target, blastRadius)
  ) {
    return 0;
  }

  return mobsListAroundTarget(target, blastRadius).length;
}

function findInvBooster() {
  return BOOSTERS.find((booster) => locate_item(booster) !== -1);
}

function haveFormidableMonsterAroundTarget(target, blastRadius = BLAST_RADIUS) {
  return hasUntargetedMonsterAround(
    target,
    blastRadius,
    (mob) => calculateDamage(mob, character, false) > FORMIDABLE_MOB_DAMAGE,
  );
}

// Mob weakness
function isDyingToOurShot(mob, multiplier = 1) {
  if (!mob) return false;

  return (
    mob.hp < calculateDamage(character, mob) * SHOT_DAMAGE_MARGIN * multiplier
  );
}

/**
 * Whether waking `mob` drags an ability we never want loose (burn, stone).
 * @param {Object} mob
 * @returns {boolean}
 */
function hasWatchoutAbility(mob) {
  return WATCHOUT_ABILITIES.some((skill) => !!mob?.abilities?.[skill]);
}

function isHarmlessMob(mob) {
  if (!mob) return false;

  return (
    !!mob["1hp"] ||
    mob.max_hp < TRIVIAL_MOB_MAX_HP ||
    calculateDamage(mob, character, false) < HARMLESS_MOB_DAMAGE
  );
}

/** A free target: someone already holds its aggro, or it dies to our next shot */
function isWeakMob(mob, multiplier = 1) {
  return isDyingToOurShot(mob, multiplier) || !!mob?.target;
}

const EQUIP_IGNORE_MOBS = ["nerfedmummy"];

function shouldWearLuckGear() {
  return Object.values(parent.entities).some(
    (mob) =>
      mob.type === "monster" &&
      !EQUIP_IGNORE_MOBS.includes(mob.mtype) &&
      !mob.rip &&
      !mob.dead &&
      mob.hp > 0 &&
      (mob.target === character.name || mob.cooperative) &&
      (mob.hp <= Math.min(mob.max_hp * 0.15, 300000) ||
        mob.max_hp < calculateDamage(character, mob, false) * 2),
  );
}

function shouldWearExpGear() {
  const party = getAlliedNames();

  return Object.values(parent.entities).some(
    (mob) =>
      mob.type === "monster" &&
      !EQUIP_IGNORE_MOBS.includes(mob.mtype) &&
      !mob.rip &&
      !mob.dead &&
      mob.hp > 0 &&
      (party.has(mob.target) || mob.cooperative) &&
      mob.hp <= Math.min(mob.max_hp * 0.1, 300000) &&
      mob.max_hp > calculateDamage(character, mob, false) * 2,
  );
}

// Ping compensation for normal attack
function attackSpeedCompensate(
  attackFrequencyBeforeCompensate,
  attackFrequencyAfterCompensate = character.frequency,
) {
  if (attackFrequencyBeforeCompensate > attackFrequencyAfterCompensate) {
    const compensateMs =
      1000 / attackFrequencyAfterCompensate -
      1000 / attackFrequencyBeforeCompensate;
    reduce_cooldown("attack", compensateMs);
  }
}

// Class Items logic
const MAGE_WEAK_MOB_TYPES = ["pinkgoo", "snowman", "wabbit", "crab"];

/**
 * Owned items passing `matches`, best first — the bag plus whatever is
 * equipped, whose `num` is -1 since it has no inventory slot.
 * @param {(entry: {num: number, name: string, info: Object}) => boolean} matches
 * @param {(entry: Object) => number} [score] - ranking, attack by default
 * @returns {{num: number, name: string, info: Object, score: number}[]}
 */
function findOwnedItems(matches, score = (entry) => entry.info.attack ?? 0) {
  const entries = character.items.map((item, num) =>
    item ? { num, name: item.name, info: item_info(item) } : null,
  );

  for (const slot of Object.values(character.slots)) {
    if (slot) entries.push({ num: -1, name: slot.name, info: item_info(slot) });
  }

  return entries
    .filter((entry) => entry && matches(entry))
    .map((entry) => ({ ...entry, score: score(entry) }))
    .sort((lhs, rhs) => rhs.score - lhs.score);
}

/**
 * item_info for an item we actually carry, at the level we carry it.
 * @param {string} id - item name
 * @returns {Object|undefined} the info, or undefined when not owned
 */
function getOwnedItemInfo(id) {
  return findOwnedItems((entry) => entry.name === id)[0]?.info;
}

function getMageMainhand(
  currentTarget,
  shouldUseBlaster,
  haveEnoughMobsToSplash,
) {
  if (character.map === "crypt" && !currentTarget?.s?.frozen)
    return "froststaff";

  const isWeakMobType = MAGE_WEAK_MOB_TYPES.includes(currentTarget?.mtype);

  // Pinkie is worth its lost attack only when it still kills in one cast
  const pinkieInfo = getOwnedItemInfo("pinkie");
  const pinkieOneShots =
    !!pinkieInfo &&
    !!currentTarget &&
    canOneShotWithWeapon(pinkieInfo, [currentTarget]) &&
    (currentStrategy !== usePullStrategies || !haveEnoughMobsToSplash);

  if (isWeakMobType || pinkieOneShots) return "pinkie";

  if (currentStrategy === usePullStrategies && shouldUseBlaster)
    return "gstaff";

  return "firestaff";
}

function calculateMageItems() {
  const currentTarget = get_target();
  const numberOfMobsAroundCurrentTarget =
    numberOfMonsterAroundTarget(currentTarget);
  const haveEnoughMobsToSplash =
    numberOfMobsAroundCurrentTarget >= TARGET_TO_SWITCH_TO_BLASTER_WEAPON;
  const shouldUseBlaster =
    haveEnoughMobsToSplash &&
    !currentTarget?.["1hp"] &&
    character.mp >
      G.skills["magiport"].mp +
        G.skills["blink"].mp +
        (ms_to_next_skill("use_mp") < ms_to_next_skill("attack" ? 0 : 500));

  const feelingLucky = shouldWearLuckGear();
  const feelingWise = shouldWearExpGear();

  return {
    mainhand: getMageMainhand(
      currentTarget,
      shouldUseBlaster,
      haveEnoughMobsToSplash,
    ),
    offhand:
      currentStrategy === usePullStrategies
        ? shouldUseBlaster
          ? undefined
          : "wbook1"
        : "wbook1",
    helmet: feelingLucky ? "wcap" : "gphelmet",
    chest: "wattire",
    pants: feelingLucky ? "wbreeches" : "starkillers",
    shoes: feelingLucky ? "wshoes" : "wingedboots",
    gloves: feelingLucky ? "wgloves" : "supermittens",
    cape: "horsecapeg",
    orb: feelingLucky ? "rabbitsfoot" : feelingWise ? "talkingskull" : "jacko",
    amulet: feelingWise ? "spookyamulet" : "intamulet",
  };
}

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
      : "orbofstr",
    chest: getWarriorChest(feelingLucky, isTanker),
    // pants: isTanker ? "frankypants" : "fallen",
    pants: "fallen",
    ring1: currentTarget?.armor > 99 ? "suckerpunch" : "strring",
    ring2: currentTarget?.armor > 99 ? "suckerpunch" : "strring",
  };
}

const RANGER_INV_ITEMS = {
  poucher: "pouchbow",
  fireBow: "firebow",
  crossBow: "crossbow",
  cupid: "cupid",
};

/**
 * Party members in cupid range that want a heal (empty while feared).
 * @param {Object[]} [playersToHeal] - candidates, defaults to getPlayersToHeal()
 * @returns {Object[]} the healees
 */
function getCupidHealees(playersToHeal = getPlayersToHeal()) {
  if (character.fear) return [];

  const characterRange = character.range + character.xrange;
  return playersToHeal.filter(
    (player) =>
      player.name !== character.name &&
      distance(player, character) < characterRange,
  );
}

function explosionScore(
  itemInfo,
  targets,
  clusterOf = numberOfMonsterAroundTarget,
) {
  if (!itemInfo || !targets?.length) return 0;

  const attack = effectiveAttackWith(itemInfo);
  const explosion =
    (character.explosion ?? 0) + (itemInfo.explosion_delta ?? 0);
  const radius = explosion / BLAST_DIVISOR || BLAST_RADIUS;

  // Expected damage with this bow's crit over the one we hold: a crit doubles
  // the hit, so each point of crit chance is worth one extra point of damage
  const crit = character.crit ?? 0;
  const critRate =
    (1 + (crit + (itemInfo.crit_delta ?? 0)) / 100) / (1 + crit / 100);

  const burnChance =
    itemInfo.ability === "burn" ? (itemInfo.attr0 ?? 0) / 100 : 0;

  const score = targets.reduce((accumulator, mob) => {
    const cluster = clusterOf(mob, radius);

    // Burn lands on every mob we shoot, never on the ones the splash catches
    const burn = burnChance
      ? dps_multiplier((mob.armor ?? 0) - (character.apiercing ?? 0) * 2) *
        ((100 - (mob.firesistance ?? 0)) / 100) *
        BURN_DAMAGE_MULTIPLIER *
        attack *
        burnChance *
        0.9
      : 0;

    return (
      accumulator +
      attack +
      ((attack * explosion) / 100) * Math.max(0, cluster - 1) +
      burn
    );
  }, 0);

  return score * critRate;
}

/**
 * Best-scoring bow to splash with, over every bow carried plus the one in hand.
 * @param {Object[]} targets - the mobs about to be shot
 * @returns {string} the bow's name
 */
function chooseBowForSplashing(targets) {
  const currentBow = character.slots.mainhand;
  const currentInfo = currentBow ? item_info(currentBow) : undefined;
  const currentExplosion = currentInfo?.explosion ?? 0;
  const currentCrit = currentInfo?.crit ?? 0;

  // Bows sharing a radius share their cluster counts, for this call only
  const clusters = new Map();
  const clusterOf = (mob, radius) => {
    const key = `${mob.id}:${Math.round(radius)}`;
    if (!clusters.has(key))
      clusters.set(key, numberOfMonsterAroundTarget(mob, radius));
    return clusters.get(key);
  };

  const best = findOwnedItems(
    (entry) =>
      ["bow", "crossbow"].includes(entry.info?.wtype) &&
      entry.name !== RANGER_INV_ITEMS.cupid,
    (entry) =>
      explosionScore(
        {
          ...entry.info,
          explosion_delta: (entry.info.explosion ?? 0) - currentExplosion,
          crit_delta: (entry.info.crit ?? 0) - currentCrit,
        },
        targets,
        clusterOf,
      ),
  )[0];

  return best?.name ?? RANGER_INV_ITEMS.fireBow;
}

/**
 * Whether waking `mob` with a splash is acceptable: it barely scratches us, or
 * the same splash kills it outright.
 * @param {Object} mob - the unaggroed bystander in the blast
 * @returns {boolean}
 */
function isNegligibleMob(mob) {
  return (
    isHarmlessMob(mob) ||
    isDyingToOurShot(mob, (character.explosion ?? 0) / 100)
  );
}

/**
 * Whether firing at `mob` is safe once splash is accounted for.
 * @param {Object} mob - the intended target
 * @param {number} [splashRadius] - blast radius to test; 0 means no splash
 * @returns {boolean}
 */
function isSafeToShoot(mob, splashRadius = getSplashRadius(0)) {
  if (!shouldAttack(mob)) return false;
  // A watchout mob nobody holds yet is ours the moment we touch it
  if (!mob?.target && hasWatchoutAbility(mob)) return false;
  if (!splashRadius) return true;

  return !hasUntargetedMonsterAround(
    mob,
    splashRadius,
    (bystander) => hasWatchoutAbility(bystander) || !isNegligibleMob(bystander),
  );
}

function calculateRangerItems(target) {
  const targets = !target ? [] : Array.isArray(target) ? target : [target];
  const feelingLucky = shouldWearLuckGear();
  const feelingWise = shouldWearExpGear();
  const someTargetCooperative = targets.some((mob) => mob.cooperative);

  // Judge splash safety against the radius we *would* have, not the one we have
  // now, or picking up the poucher would immediately make itself unsafe.
  const prospectiveSplashRadius = getSplashRadius();
  const targetsAreSafeToSplash = targets
    .filter((entity) => entity.type === "monster")
    .every((mob) => isSafeToShoot(mob, prospectiveSplashRadius));

  let mainhand = character.slots.mainhand?.name;

  // Cupid outranks every bow: the strategy hands it over whenever someone wants
  // a heal, and the ranger keeps shooting mobs until it is actually in hand.
  const cupidAvailable =
    findMaxLevelItem(RANGER_INV_ITEMS.cupid) !== -1 ||
    mainhand === RANGER_INV_ITEMS.cupid;

  if (!mainhand) mainhand = RANGER_INV_ITEMS.fireBow;

  if (cupidAvailable && getCupidHealees().length) {
    mainhand = RANGER_INV_ITEMS.cupid;
  } else if (targets.length) {
    const canSplash =
      currentStrategy === usePullStrategies &&
      targets.some(
        (mob) =>
          (mob.cluster_count ??
            numberOfMonsterAroundTarget(mob, getSplashRadius())) >=
          TARGET_TO_SWITCH_TO_BLASTER_WEAPON,
      );

    if (canSplash) {
      mainhand = chooseBowForSplashing(targets);
    } else if (someTargetCooperative) {
      mainhand = RANGER_INV_ITEMS.fireBow;
    } else {
      const current = character.slots.mainhand;
      const currentInfo = current ? item_info(current) : { attack: 0 };

      const rangedWeapons = character.items
        .map((item, slot) => {
          if (!item) return null;

          const info = item_info(item);
          if (
            !["bow", "crossbow"].includes(info.wtype) ||
            item.name === "cupid" ||
            // Keep hands off the poucher when the blast would wake a fresh mob
            (!targetsAreSafeToSplash && item.name === RANGER_INV_ITEMS.poucher)
          )
            return null;

          return {
            slot,
            name: item.name,
            info,
            attackDelta: info.attack - currentInfo.attack,
            rangeDelta: info.range - (currentInfo.range || 0),
          };
        })
        .filter(Boolean);

      if (current) {
        const info = item_info(current);
        if (
          ["bow", "crossbow"].includes(info.wtype) &&
          current.name !== "cupid"
        ) {
          rangedWeapons.push({
            slot: "mainhand",
            name: current.name,
            info,
            attackDelta: 0,
            rangeDelta: 0,
          });
        }
      }

      rangedWeapons.sort((lhs, rhs) => {
        if (lhs.info.wtype !== rhs.info.wtype) {
          return lhs.info.wtype === "crossbow" ? 1 : -1;
        }
        return (
          rhs.rangeDelta - lhs.rangeDelta || lhs.attackDelta - rhs.attackDelta
        );
      });

      const oneShotWeapon = rangedWeapons.find((weapon) =>
        canOneShotWithWeapon(weapon.info, targets),
      );
      mainhand = oneShotWeapon ? oneShotWeapon.name : RANGER_INV_ITEMS.fireBow;
    }
  }

  return {
    helmet: feelingLucky ? "wcap" : "fury",
    mainhand,
    offhand:
      !targetsAreSafeToSplash ||
      targets.some((entity) => haveFormidableMonsterAroundTarget(entity))
        ? "t2quiver"
        : "alloyquiver",
    orb: feelingLucky
      ? "rabbitsfoot"
      : feelingWise
      ? "talkingskull"
      : "orbofdex",
    amulet: feelingWise ? "spookyamulet" : "dexamulet",
    shoes: feelingLucky ? "wshoes" : "wingedboots",
    gloves: feelingLucky ? "wgloves" : "supermittens",
  };
}

let priestLastHealGearAt = 0;

function isPriestInHealGraceWindow(target) {
  if (target && target.type !== "monster") {
    priestLastHealGearAt = Date.now();
    return true;
  }

  const graceMs = 1000 / character.frequency;
  return Date.now() - priestLastHealGearAt < graceMs;
}

function getPriestMainhand(target, currentTarget, feelingLucky) {
  if (isPriestInHealGraceWindow(target)) return "lmace";

  if (character.map === "crypt") {
    return currentTarget?.s?.frozen ? "lmace" : "froststaff";
  }

  return feelingLucky ? "lmace" : "firestaff";
}

function getPriestOffhand(isTanking, feelingLucky) {
  if (character.map === "crypt") return "exoarm";
  if (feelingLucky) return "mshield";

  const facingMagicalMob = Object.values(parent.entities).some(
    (mob) =>
      mob.type === "monster" &&
      mob.target === character.name &&
      mob.damage_type === "magical",
  );

  if (isTanking || facingMagicalMob || character.fear) return "wbookhs";
  return "exoarm";
}

function getPriestOrb(target, isTanking, feelingLucky, feelingWise) {
  if (isTanking && character.s.burned) return "orba";
  if (feelingLucky) return "rabbitsfoot";
  if (feelingWise) return "talkingskull";
  if (isPriestInHealGraceWindow(target)) return "jacko";
  return "test_orb";
}

function getPriestAmulet(isTanking, feelingLucky, feelingWise) {
  if (feelingLucky || (feelingWise && !isTanking)) return "spookyamulet";

  // Re-equip sanguine to (re)apply its aura whenever we own or already wear one
  // and the buff is missing or about to expire; otherwise let it fall through.
  const haveSanguine =
    locate_item("sanguine") !== -1 ||
    character.slots.amulet?.name === "sanguine";
  if (
    haveSanguine &&
    (!character.s.sanguine || character.s.sanguine.ms < 10000)
  ) {
    return "sanguine";
  }

  return isTanking ? "t2stramulet" : "intamulet";
}

function calculatePriestItems(target) {
  const currentTarget = get_targeted_monster();
  const isTanking = isAssignedAsTanker();
  const feelingLucky = shouldWearLuckGear();
  const feelingWise = shouldWearExpGear();

  return {
    mainhand: getPriestMainhand(target, currentTarget, feelingLucky),
    offhand: getPriestOffhand(isTanking, feelingLucky),
    orb: getPriestOrb(target, isTanking, feelingLucky, feelingWise),
    gloves: "supermittens",
    amulet: getPriestAmulet(isTanking, feelingLucky, feelingWise),
    ring1: feelingLucky ? "ringhs" : "cring",
    ring2: feelingLucky ? "ringhs" : "zapper",
    cape: "angelwings",
  };
}

function calculateRogueItems(target) {
  const feelingLucky = shouldWearLuckGear();
  const fieryWeapon = "firestars";

  const baseItems = {
    helmet: feelingLucky ? "wcap" : "fury",
    mainhand: "daggerofthedead",
    offhand: "daggerofthedead",
    shoes: feelingLucky ? "wshoes" : "wingedboots",
    gloves: feelingLucky ? "wgloves" : "supermittens",
    amulet: feelingLucky ? "spookyamulet" : "dexamulet",
    orb: feelingLucky ? "rabbitsfoot" : "orbofdex",
    chest: "wattire",
    pants: "wbreeches",
  };

  if (!target) return baseItems;

  const targetStacks = target.s?.stack?.s ?? 0;
  const fieryWeaponSlot = locate_item(fieryWeapon);

  const characterFireStars =
    fieryWeaponSlot !== -1
      ? character.items[fieryWeaponSlot]
      : character.slots.offhand?.name === fieryWeapon
      ? character.slots.offhand
      : undefined;

  const equipItemAttackOffset =
    (item_info(character.slots.offhand)?.attack ?? 0) -
    (item_info(characterFireStars)?.attack ?? 0);

  const rogueBurnDmg = characterFireStars
    ? dps_multiplier((target.armor ?? 0) - (character.apiercing ?? 0) * 2) *
      ((100 - (target.firesistance ?? 0)) / 100) *
      1.5 *
      (character.attack - equipItemAttackOffset + targetStacks) *
      0.9
    : 0;

  const shouldEquipFireStar =
    rogueBurnDmg > (target.s?.burned?.intensity ?? 0) || target.cooperative;

  return {
    ...baseItems,
    offhand: shouldEquipFireStar ? fieryWeapon : "daggerofthedead",
  };
}

// What the merchant shoots with, whenever it shoots at all — a lure, a drag, an
// event boss, or a snipe (merchant_service.19.js, merchant_frenzinesss.100.js)
const ATTACK_WEAPON = "dartgun";
// Only a fallback for the bank trip: everything else takes getBestQuiver
const ATTACK_OFFHAND = "t2quiver";
// How much of xrange the merchant lets itself aim with
const ATTACK_XRANGE_RATE = 0.8;
// Best reach seen so far — see getAttackWeaponReach
var maxAttackWeaponRange = 0;

/** @returns {Object[]} everything equipped or in the bag */
function getCarriedItems() {
  return [
    character.slots.mainhand,
    character.slots.offhand,
    ...character.items,
  ].filter(Boolean);
}

/**
 * Longest-ranged quiver we are carrying. Not the by-wtype sweep getMaxBlastRadius
 * does — the merchant hauls the fighters' loot, so its bag is full of gear it
 * can't hold.
 * @returns {{name: string, range: number}|undefined}
 */
function getBestQuiver() {
  let best;

  for (const item of getCarriedItems()) {
    const info = item_info(item);
    if ((info?.wtype ?? info?.type) !== "quiver") continue;

    const range = info.range ?? 0;
    if (range > (best?.range ?? 0)) best = { name: item.name, range };
  }

  return best;
}

/**
 * Reach the dartgun would give us: the gun itself plus the best quiver's delta.
 * Name-locked on the gun — a looted crossbow would otherwise set the number.
 * @returns {number} 0 when there is no dartgun to hold
 */
function getMaxAttackWeaponRange() {
  const dartgunRange = getCarriedItems()
    .filter((item) => item.name === ATTACK_WEAPON)
    .reduce((best, item) => Math.max(best, item_info(item)?.range ?? 0), 0);

  if (!dartgunRange) return 0;

  return dartgunRange + (getBestQuiver()?.range ?? 0);
}

/**
 * How far the merchant can shoot *once geared*: with the broom in hand
 * character.range reads melee, so callers that have to decide whether gearing up
 * is worth it can't measure it live. 0 until a dartgun has been seen at all.
 * @returns {number}
 */
function getAttackWeaponReach() {
  maxAttackWeaponRange =
    character.slots.mainhand?.name === ATTACK_WEAPON
      ? character.range
      : Math.max(maxAttackWeaponRange, getMaxAttackWeaponRange());

  if (!maxAttackWeaponRange) return 0;

  return maxAttackWeaponRange + character.xrange * ATTACK_XRANGE_RATE;
}

/** Luck outranks the quiver's range: whatever we're shooting is nearly dead anyway */
function getMerchantOffhand(isArmed, feelingLucky) {
  if (feelingLucky) return "mshield";
  if (!isArmed) return "wbookhs";
  return getBestQuiver()?.name ?? ATTACK_OFFHAND;
}

function getMerchantAmulet(feelingLucky, isBusy) {
  if (feelingLucky) return "spookyamulet";
  return isBusy ? "t2intamulet" : "warmscarf";
}

/**
 * The three questions the merchant gear table branches on.
 * @returns {{isArmed: boolean, feelingLucky: boolean, isBusy: boolean}}
 */
function getMerchantGearState() {
  return {
    isArmed: shouldHoldAttackWeapon(),
    feelingLucky: shouldWearLuckGear(),
    isBusy: !!(isLuringMobs || isFightingBoss),
  };
}

/**
 * Merchant-only
 * @param {{isArmed: boolean, feelingLucky: boolean, isBusy: boolean}} [state]
 *  defaults to what we are actually doing — pass a state to ask what some other
 *  situation would want
 */
function calculateMerchantEquipments(state = getMerchantGearState()) {
  const { isArmed, feelingLucky, isBusy } = state;

  return {
    helmet: isBusy ? "xhelmet" : "eear",
    // Dartgun keeps us out of the boss' melee range while still landing hits
    mainhand: isArmed ? ATTACK_WEAPON : "broom",
    offhand: getMerchantOffhand(isArmed, feelingLucky),
    amulet: getMerchantAmulet(feelingLucky, isBusy),
    // scareAwayMobs re-equips jacko itself when something actually aggroes us
    orb: feelingLucky ? "rabbitsfoot" : "jacko",
    chest: "tshirt4",
    pants: "pants",
    ring1: "solitaire",
    ring2: isBusy ? "armorring" : "dexring",
    shoes: "eslippers",
    gloves: "gloves1",
    belt: "sbelt",
    earring1: "dexearring",
    earring2: "dexearring",
  };
}

/**
 * Every item calculateMerchantEquipments can ask for, whichever way its branches
 * fall — the whole state space evaluated, so nothing here can drift out of sync
 * with the table above.
 * @returns {Set<string>}
 */
function getMerchantGearNames() {
  const names = new Set();

  for (let state = 0; state < 8; state++) {
    const equipments = calculateMerchantEquipments({
      isArmed: !!(state & 1),
      feelingLucky: !!(state & 2),
      isBusy: !!(state & 4),
    });

    for (const name of Object.values(equipments)) names.add(name);
  }

  return names;
}

function calculateBestItems(characterClass = character.ctype) {
  switch (characterClass) {
    case "mage":
      return calculateMageItems();
    case "warrior":
      return calculateWarriorItems();
    case "ranger":
      return calculateRangerItems(get_target());
    case "priest":
      return calculatePriestItems(get_target());
    case "merchant":
      return calculateMerchantEquipments();
    default:
      return {};
  }
}

// Equipping Items
function findMaxLevelItem(id, offset = 0) {
  const matches = character.items
    .map((item, slot) => (item?.name === id ? { ...item, slot } : null))
    .filter(Boolean)
    .sort(
      (lhs, rhs) => (rhs.level ?? 0) - (lhs.level ?? 0) || rhs.slot - lhs.slot,
    );

  return matches[offset]?.slot ?? -1;
}

let isEquipingItems = false;

// withTimeout in the callers only bounds the wait — the equip promise it raced
// stays pending. Without a bound here, one unanswered equip latches
// isEquipingItems forever and silently ends all gear changes until a restart.
const EQUIP_TIMEOUT_MS = 1000;

/**
 * @param {Object} suggestedItems - slot -> item name
 * @param {Object} [options]
 * @param {Object<string, number>} [options.fallback] - slot -> inventory slot when the item isn't findable
 * @param {(penaltyMs: number) => number} [options.penaltyModifier] - adjusts the assumed penalty_cd
 * @param {boolean} [options.preventPenaltizeNextAttack=true] - false skips the penalty_cd bail and slicing
 * @param {boolean} [options.preventKeySnatch=true] - false ignores the isEquipingItems latch
 */
async function equipBatch(suggestedItems, options = {}) {
  const {
    fallback = {},
    penaltyModifier = (penalty) => penalty,
    preventPenaltizeNextAttack = true,
    preventKeySnatch = true,
  } = options;

  if (preventKeySnatch && isEquipingItems) return false;

  if (
    preventPenaltizeNextAttack &&
    (character.cc > 130 || character.s.penalty_cd || isLooting)
  )
    return false;

  // Never release a latch we didn't take — a preventKeySnatch:false call runs
  // inside someone else's swap and must leave their flag alone
  const tookLatch = !isEquipingItems;
  isEquipingItems = true;

  try {
    const promises = buildEquipPromises(suggestedItems, {
      fallback,
      penaltyModifier,
      preventPenaltizeNextAttack,
    });
    if (!promises.length) return false;

    return await withTimeout(Promise.allSettled(promises), EQUIP_TIMEOUT_MS);
  } finally {
    if (tookLatch) isEquipingItems = false;
  }
}

/**
 * Fires off the equips a suggestion asks for, within the penalty_cd budget.
 * @param {Object} suggestedItems - slot -> item name
 * @param {Object} options - resolved equipBatch options
 * @returns {Promise[]} the in-flight equip promises
 */
function buildEquipPromises(suggestedItems, options) {
  const { fallback, penaltyModifier, preventPenaltizeNextAttack } = options;
  const promises = [];
  const currentBooster = findInvBooster();

  // Budget of penalty_cd we can spend before the next attack comes off cooldown
  const msToNextAttack = ms_to_next_skill("attack");
  const timeToNextAttack =
    msToNextAttack === 0 ? 1000 / character.frequency : msToNextAttack;
  const currentPenalty = penaltyModifier(character.s.penalty_cd?.ms ?? 0);
  const equipLatency = Math.min(character.ping / 2, 100);
  let penaltyBudget = timeToNextAttack - currentPenalty - equipLatency;

  let targetBooster = null;
  if ((!isLooting || !preventPenaltizeNextAttack) && currentBooster) {
    if (suggestedItems.booster) {
      if (currentBooster !== suggestedItems.booster)
        targetBooster = suggestedItems.booster;
    } else if (currentBooster !== "luckbooster" && shouldWearLuckGear()) {
      targetBooster = "luckbooster";
    } else if (currentBooster !== "xpbooster" && !shouldWearLuckGear()) {
      targetBooster = "xpbooster";
    }
  }
  // Shifting a booster costs more penalty than a regular equip — only pay for
  // it when there's room in the budget, or when the caller forces the swap
  if (
    targetBooster &&
    (!preventPenaltizeNextAttack || penaltyBudget >= SHIFT_PENALTY_MS)
  ) {
    promises.push(shift(locate_item(currentBooster), targetBooster));
    penaltyBudget -= SHIFT_PENALTY_MS;
  }
  delete suggestedItems.booster;

  const suggestedMainhandWtype = item_info({
    name: suggestedItems["mainhand"],
  })?.wtype;
  if (
    suggestedItems["mainhand"] &&
    G.classes[character.ctype].doublehand[suggestedMainhandWtype] &&
    character.slots["offhand"]
  ) {
    promises.push(unequip("offhand"));
  }

  const usedCounts = {};

  const itemSlots = Object.keys(suggestedItems)
    .filter(
      (slot) =>
        suggestedItems[slot] &&
        // A fallback means the caller knows character.slots is stale (a swap it
        // just fired hasn't come back yet), so trust it over the comparison
        (fallback[slot] !== undefined ||
          suggestedItems[slot] !== character.slots[slot]?.name ||
          character.items[findMaxLevelItem(suggestedItems[slot])]?.level >
            character.slots[slot]?.level),
    )
    .map((slot) => {
      const id = suggestedItems[slot];
      const count = usedCounts[id] || 0;
      const num = findMaxLevelItem(id, count);
      usedCounts[id] = count + 1;
      return { slot, num: num >= 0 ? num : fallback[slot] ?? -1 };
    })
    .filter((equipInfo) => equipInfo.num >= 0);

  // Slice items to prevent penalty_cd from affecting attack cooldown
  const maxItemsToEquip = Math.max(
    0,
    Math.floor(penaltyBudget / EQUIP_PENALTY_MS),
  );

  if (itemSlots.length > maxItemsToEquip && preventPenaltizeNextAttack) {
    itemSlots.splice(maxItemsToEquip);
  }

  if (itemSlots.length <= 1) {
    for (const item of itemSlots) promises.push(equip(item.num, item.slot));
  } else {
    promises.push(equip_batch(itemSlots));
  }

  return promises;
}

function calculateHeal(fromEntity, toEntity) {
  if (!fromEntity) return 0;

  const selfPiercing = fromEntity.name === character.name;

  switch (fromEntity.damage_type) {
    case "magical":
      return (
        fromEntity.heal *
        damage_multiplier(
          toEntity.resistance -
            (selfPiercing ? (character.rpiercing ?? 0) / 2 : 0),
        )
      );
    case "physical":
      return (
        fromEntity.attack *
        damage_multiplier(
          toEntity.armor - (selfPiercing ? (character.apiercing ?? 0) / 2 : 0),
        )
      );
  }
}

// Utilities
function calculateDamage(fromEntity, toEntity, recursion = true) {
  if (!fromEntity) return 0;

  switch (fromEntity.damage_type) {
    case "magical": {
      const monsterRpiercing =
        fromEntity.type === "monster"
          ? G.monsters[fromEntity.mtype].rpiercing ?? 0
          : 0;

      const reflectionDmg =
        fromEntity.reflection && recursion && toEntity.range > 100
          ? (toEntity.type === "monster"
              ? G.monsters[toEntity.mtype].damage_type
              : G.classes[toEntity.ctype].damage_type) === "magical"
            ? (calculateDamage(toEntity, fromEntity, false) *
                (fromEntity.reflection ?? 0)) /
              100
            : 0
          : 0;

      return (
        fromEntity.attack *
          dps_multiplier(toEntity.resistance - monsterRpiercing * 2) *
          fromEntity.frequency +
        reflectionDmg
      );
    }

    case "physical": {
      const monsterApiercing =
        fromEntity.type === "monster"
          ? G.monsters[fromEntity.mtype].apiercing ?? 0
          : 0;
      const hardshellArmor = toEntity.s["hardshell"]
        ? G.conditions.hardshell.armor
        : 0;

      const dreturnDmg =
        fromEntity.dreturn && recursion && toEntity.range < 100
          ? (toEntity.type === "monster"
              ? G.monsters[toEntity.mtype].damage_type
              : G.classes[toEntity.ctype].damage_type) === "physical"
            ? (calculateDamage(toEntity, fromEntity, false) *
                (fromEntity.dreturn ?? 0)) /
              100
            : 0
          : 0;

      return (
        fromEntity.attack *
          dps_multiplier(
            toEntity.armor - hardshellArmor - monsterApiercing * 2,
          ) *
          fromEntity.frequency +
        dreturnDmg
      );
    }

    default:
      return fromEntity.attack * fromEntity.frequency;
  }
}

function listOfMonsterAttacking(characterEntity) {
  if (!characterEntity) return [];

  return Object.values(parent.entities).filter(
    (entity) =>
      entity.type === "monster" && entity.target === characterEntity.name,
  );
}

function mobbingMultiplier(numberOfMobs) {
  return numberOfMobs < 3 ? 1 : 1.5;
}

function healerHps(healer = get_entity(HEALER) ?? get_entity(RANGER)) {
  if (!healer) return 0;

  const healPerHit = healer.heal || (healer.attack ?? 0) * 0.5;
  return healPerHit * healer.frequency;
}

function totalMobDps(mobs, toEntity = character) {
  return (
    mobs.reduce(
      (accumulator, mob) => accumulator + calculateDamage(mob, toEntity),
      0,
    ) * mobbingMultiplier(mobs.length)
  );
}

function avgDmgTaken(characterEntity, dmgType = null) {
  if (!characterEntity) return 0;

  const listOfAttackingMobs = Object.values(parent.entities).filter(
    (mob) =>
      mob.target === characterEntity.name &&
      mob.type === "monster" &&
      (!dmgType || mob.damage_type === dmgType),
  );

  // When dmgType filters the list, we still need total aggro count for the mobbing multiplier
  const numberOfAttackingMobs = dmgType
    ? listOfMonsterAttacking(characterEntity).length
    : listOfAttackingMobs.length;

  const highestBurningMob = listOfAttackingMobs
    .filter((mob) => mob.abilities?.burn)
    .reduce((accumulator, mob) => {
      if (!accumulator) return mob;
      return accumulator.attack > mob.attack ? accumulator : mob;
    }, undefined);

  const fireResist =
    characterEntity.firesistance ??
    (characterEntity.slots.orb?.name === "orba" ? 15 : 0);

  const burnPadding = highestBurningMob
    ? dps_multiplier(
        highestBurningMob.damage_type === "physical"
          ? characterEntity.armor -
              (G.monsters[highestBurningMob.mtype].apiercing ?? 0) * 2
          : highestBurningMob.damage_type === "magical"
          ? characterEntity.resistance -
            (G.monsters[highestBurningMob.mtype].rpiercing ?? 0) * 2
          : 1,
      ) *
      ((100 - fireResist) / 100) *
      (highestBurningMob.abilities.burn.unlimited ? 3 : 1.5) *
      highestBurningMob.attack
    : 0;

  const currentBurnIntensity = highestBurningMob
    ? characterEntity.s.burned?.intensity ?? 0
    : 0;

  return (
    listOfAttackingMobs.reduce(
      (accumulator, mob) => accumulator + calculateDamage(mob, characterEntity),
      0,
    ) *
      mobbingMultiplier(numberOfAttackingMobs) +
    Math.max(currentBurnIntensity, burnPadding)
  );
}

function avgPartyDmgTaken(partyList = partyMems, dmgType = null) {
  return partyList.reduce(
    (accumulator, member) =>
      accumulator + avgDmgTaken(get_player(member), dmgType),
    0,
  );
}

function rotateLeader(partyList, newLeaderId) {
  const newLeaderIndex = partyList.indexOf(newLeaderId);
  if (newLeaderIndex === -1) return partyList;

  return partyList
    .slice(newLeaderIndex)
    .concat(partyList.slice(0, newLeaderIndex));
}

function assignRoles() {
  const currentTarget = get_targeted_monster();

  if (
    parent.S.franky?.live &&
    ["franky", "nerfedmummy"].includes(currentTarget?.mtype)
  ) {
    TANKER = PRIEST;
    partyMems = rotateLeader(partyMems, TANKER);
    return;
  }

  if (partyMems.includes(WARRIOR) && partyMems.includes(PRIEST)) {
    const partyDmgTaken = avgPartyDmgTaken(partyMems);
    const partyPhysicalDmgTaken = avgPartyDmgTaken(partyMems, "physical");
    const physicalDmgRatio = partyPhysicalDmgTaken / partyDmgTaken;

    TANKER = physicalDmgRatio <= 0.5 ? PRIEST : WARRIOR;
    partyMems = rotateLeader(partyMems, TANKER);
    return;
  }

  if (partyMems.includes(WARRIOR)) {
    TANKER = WARRIOR;
    partyMems = rotateLeader(partyMems, TANKER);
    return;
  }

  if (partyMems.includes(PRIEST)) {
    TANKER = PRIEST;
    partyMems = rotateLeader(partyMems, TANKER);
    return;
  }
}

function isAssignedAsTanker() {
  return character.name === TANKER;
}

function getMonstersToCBurst() {
  const partyHealer = get_entity(HEALER) ?? get_entity(RANGER);
  const partyTanker = get_entity(TANKER);

  if (!partyHealer || !partyTanker) return [];

  const healerHealPerSecond = healerHps(partyHealer);
  const MAX_SAFE_DPS = healerHealPerSecond * 0.95;
  const NEW_MOB_DMG_LIMIT = healerHealPerSecond * 0.9;

  const eligibleMobs = Object.values(parent.entities)
    .filter(
      (mob) =>
        mob.type === "monster" &&
        is_in_range(mob, "cburst") &&
        calculateDamage(mob, partyTanker) < MAX_MOB_DPS &&
        mob.range < character.range - 20 &&
        !WATCHOUT_ABILITIES.some((skill) =>
          Object.keys(mob.abilities ?? {}).includes(skill),
        ),
    )
    .sort((lhs, rhs) => distance(character, rhs) - distance(character, lhs));

  const selectedMobs = [];
  let currentPartyDmgRecieved = avgPartyDmgTaken(partyMems);
  let tankerCurrentAggroCount = listOfMonsterAttacking(partyTanker).length;

  for (const mob of eligibleMobs) {
    if (currentPartyDmgRecieved >= MAX_SAFE_DPS) break;

    const projectedDmg =
      currentPartyDmgRecieved +
      calculateDamage(mob, partyTanker) *
        mobbingMultiplier(tankerCurrentAggroCount + 1);

    if (
      is_in_range(mob, "cburst") &&
      !mob.target &&
      projectedDmg < NEW_MOB_DMG_LIMIT
    ) {
      selectedMobs.push(mob);

      const oldAggroMult = mobbingMultiplier(tankerCurrentAggroCount);
      tankerCurrentAggroCount++;
      const newAggroMult = mobbingMultiplier(tankerCurrentAggroCount);

      currentPartyDmgRecieved =
        (currentPartyDmgRecieved * newAggroMult) / oldAggroMult +
        calculateDamage(mob, partyTanker) * newAggroMult;
    }
  }

  return selectedMobs.map((mob) => [mob, 2]);
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
 * Fallback slots for a cleave/stomp restore fired before its swap resolves,
 * while character.slots/items still show the pre-swap gear: the displaced
 * mainhand lands where the swap weapon came from, the unequipped offhand in the
 * first free inventory slot.
 * @param {Object} restoreItems - the gear to go back to
 * @param {number} swapWeaponSlot - inventory slot the swap weapon came from
 * @returns {Object<string, number>} slot -> inventory slot
 */
function buildWarriorRestoreFallback(restoreItems, swapWeaponSlot) {
  const fallback = {};
  const firstEmptySlot = character.items.findIndex((item) => !item);

  if (
    swapWeaponSlot >= 0 &&
    restoreItems.mainhand === character.slots.mainhand?.name
  )
    fallback.mainhand = swapWeaponSlot;

  if (
    firstEmptySlot !== -1 &&
    character.slots.offhand &&
    restoreItems.offhand === character.slots.offhand.name
  )
    fallback.offhand = firstEmptySlot;

  return fallback;
}

let isCleaving = false;
async function warriorCleave(strategyName) {
  const mobsList = Object.values(parent.entities).filter(
    (mob) =>
      mob.type === "monster" &&
      distance(mob, character) < G.skills["cleave"].range + character.xrange,
  );

  const cleaveWeapon = getCleaveWeapon();

  if (
    !cleaveWeapon ||
    character.s.penalty_cd ||
    character.mp < G.skills["cleave"].mp + 280 ||
    is_on_cooldown("cleave") ||
    character.cc >= 100 ||
    mobsList.some((mob) => MELEE_IGNORE_LIST.includes(mob.mtype)) ||
    mobsList.length === 0 ||
    isCleaving ||
    isEquipingItems
  )
    return;

  isCleaving = true;

  const promises = [];
  const mobsTargetingSelf = listOfMonsterAttacking(character);

  const magicalMobs = [];
  const physicalMobs = [];
  const pureMobs = [];

  const categorizeMob = (mob) => {
    if (mob.damage_type === "magical") magicalMobs.push(mob);
    else if (mob.damage_type === "physical") physicalMobs.push(mob);
    else if (mob.damage_type === "pure") pureMobs.push(mob);
  };

  for (const mob of mobsTargetingSelf) categorizeMob(mob);

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

  for (const mob of listOfNoTargetMonsterInRange) categorizeMob(mob);

  const isFeared =
    magicalMobs.length > character.mcourage ||
    physicalMobs.length > character.courage ||
    pureMobs.length > character.pcourage;

  const formidableMob = listOfNoTargetMonsterInRange.some(
    (mob) => mob.attack * mob.frequency > MAX_MOB_DPS,
  );

  const allMobs = [...magicalMobs, ...physicalMobs, ...pureMobs];
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

  if (
    isSafeToAggro &&
    !hasRiskyMob &&
    !hasBurningNonAggro &&
    !isFeared &&
    !formidableMob &&
    !isEquipingItems
  ) {
    isEquipingItems = true;
    const cleaveSet = [];
    if (cleaveWeapon.num >= 0)
      cleaveSet.push({ num: cleaveWeapon.num, slot: "mainhand" });

    if (canAffordSwap(3))
      cleaveSet.push({ num: findMaxLevelItem("mpxamulet"), slot: "amulet" });

    const restoreItems = calculateWarriorItems();
    const restoreFallback = buildWarriorRestoreFallback(
      restoreItems,
      cleaveWeapon.num,
    );

    promises.push(
      Promise.all([
        unequip("offhand"),
        cleaveSet.length ? equip_batch(cleaveSet) : undefined,
      ]),
      withTimeout(use_skill("cleave"), 2500).then(() =>
        reduce_cooldown("cleave", 0.95 * character.ping),
      ),
      // Cleave procs sugarcane off whatever the server sees equipped when it
      // runs, so swap back right away instead of waiting on use_skill
      equipBatch(restoreItems, {
        fallback: restoreFallback,
        penaltyModifier: (penalty) =>
          penalty + cleaveSet.length * EQUIP_PENALTY_MS,
        preventKeySnatch: false,
      }),
    );
  }

  return Promise.allSettled(promises).finally(() => {
    isCleaving = false;
    // Only release the flag if the aggro branch above claimed it
    if (promises.length) {
      isEquipingItems = false;
      // equipBatch bails while penalty_cd is up, so hand the restore to
      // currentStrategy at the earliest moment it can actually equip
      setTimeout(
        () => currentStrategy(get_target()),
        character.s.penalty_cd?.ms ?? 0,
      );
    }
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
  const restoreFallback = buildWarriorRestoreFallback(
    restoreItems,
    findMaxLevelItem("basher"),
  );

  promises.push(
    equipBatch(
      { mainhand: "basher", offhand: undefined },
      { preventPenaltizeNextAttack: false, preventKeySnatch: false },
    ),
    use_skill("stomp").then(() =>
      reduce_cooldown("stomp", 0.95 * character.ping),
    ),
    // Same trick as cleave: the basher only has to be on when the server runs
    // stomp, so restore without waiting for the swap or the skill to resolve
    equipBatch(restoreItems, {
      fallback: restoreFallback,
      penaltyModifier: (penalty) => penalty + EQUIP_PENALTY_MS,
      preventKeySnatch: false,
    }),
  );

  return Promise.allSettled(promises).finally(() => {
    isStomping = false;
    // equipBatch bails while penalty_cd is up, so hand the restore to
    // currentStrategy at the earliest moment it can actually equip
    setTimeout(
      () => currentStrategy(get_target()),
      character.s.penalty_cd?.ms ?? 0,
    );
  });
}

function shouldAttack(target = get_target()) {
  const partyHealer = get_entity(HEALER);

  // PvP: players are always worth shooting, priest or not
  if (target?.type === "character") return true;

  if (character.map === "crypt") {
    return !!partyHealer && !partyHealer.rip;
  }

  if (
    isMelee() &&
    target &&
    MELEE_IGNORE_LIST.includes(target.mtype ?? target.ctype)
  ) {
    return false;
  }

  if (
    target &&
    calculateDamage(target, character, false) > DANGEROUS_MOB_DAMAGE &&
    (!target.target || target.target === character.name)
  ) {
    const partyPriests = [...getAlliedNames()]
      .map((id) => get_player(id))
      .filter((player) => player?.ctype === "priest");

    return partyPriests.length > 0 || (partyHealer && !partyHealer.rip);
  }

  return true;
}

async function scareAwayMobs() {
  const hasJackoAvailable =
    locate_item("jacko") !== -1 || character.slots["orb"]?.name === "jacko";

  const isMobTargetingMe = Object.values(parent.entities).some(
    (mob) => mob?.target === character.name && mob?.type === "monster",
  );

  if (
    hasJackoAvailable &&
    isMobTargetingMe &&
    !is_on_cooldown("scare") &&
    character.mp > 100
  ) {
    return Promise.all([
      equipBatch(
        { orb: "jacko" },
        { preventPenaltizeNextAttack: false, preventKeySnatch: false },
      ),
      use_skill("scare").then(() =>
        reduce_cooldown("scare", 0.95 * character.ping),
      ),
    ]).catch((e) => console.warn("useScare errors:", e));
  }
}

async function useTemporalSurge() {
  if (isAdvanceSmartMoving || smart.moving) return false;

  if (
    is_on_cooldown("temporalsurge") ||
    character.mp < G.skills["temporalsurge"].mp + 400 ||
    (isAssignedAsTanker() && character.s.burned)
  )
    return false;

  const hasTemporalOrb =
    findMaxLevelItem("orboftemporal") !== -1 ||
    character.slots.orb?.name === "orboftemporal";

  if (!hasTemporalOrb) return false;

  const currentMap = character.map;
  const temporalsurgeRange = 160;

  const isSpawnInRange = (boundary) => {
    let map, x1, y1, x2, y2;

    if (typeof boundary[0] === "string") {
      [map, x1, y1, x2, y2] = boundary;
      if (map !== currentMap) return false;
    } else {
      [x1, y1, x2, y2] = boundary;
    }

    return (
      distance(character, {
        map: currentMap,
        x: (x1 + x2) / 2,
        y: (y1 + y2) / 2,
        awidth: Math.abs(x2 - x1),
        aheight: Math.abs(y2 - y1),
      }) < temporalsurgeRange
    );
  };

  const nearbySpawn = parent.G.maps[currentMap].monsters.filter((spawn) => {
    if (Array.isArray(spawn.boundaries) && spawn.boundaries.length > 0) {
      return spawn.boundaries.some((boundary) => isSpawnInRange(boundary));
    }
    if (spawn.boundary) return isSpawnInRange(spawn.boundary);
  });

  const nearbySpawnWithSpawnMechanic = nearbySpawn.filter(
    (spawn) => G.monsters[spawn.type].spawns,
  );

  const promises = [];

  if (nearbySpawn.length && nearbySpawnWithSpawnMechanic.length === 0) {
    if (character.slots.orb?.name !== "orboftemporal") {
      promises.push(
        equipBatch(
          { orb: "orboftemporal" },
          { preventPenaltizeNextAttack: false, preventKeySnatch: false },
        ),
      );
    }
    promises.push(use_skill("temporalsurge"));
  }

  return withTimeout(Promise.allSettled(promises)).finally(() => {
    reduce_cooldown("temporalsurge", 0.95 * character.ping);
  });
}

setInterval(async () => {
  await useTemporalSurge();
}, 1000);

class ProjectileManagement {
  constructor(socket) {
    this.socket = socket;
    this.projectilesByTarget = new Map(); // entityId -> Map(pid -> projectile)
    this.pidToTarget = new Map(); // pid -> entityId for O(1) removals

    this.init();
  }

  _calculateSingleHitDamage(from, to) {
    const damage = calculateDamage({ ...from, frequency: 1 }, to, false);
    return to["1hp"] ? Math.min(damage, 1) : damage;
  }

  _onIncomingProjectile = (data) => {
    if (!data?.pid || !data?.target) return;
    if (data.source !== "attack" && data.source !== "heal") return;
    if (data.instant) return;

    const rawValue = data.damage ?? data.heal;
    if (typeof rawValue !== "number") return;

    const projectileActor = parent.entities[data.attacker];
    const projectileTarget = parent.entities[data.target];

    const projectile = {
      type: data.source, // "attack" | "heal"
      attacker: data.attacker,
      eta: data.eta,
      arrival: performance.now() + data.eta,
    };

    // damage stored as negative, heal as positive
    if (projectileActor && projectileTarget) {
      projectile.value =
        data.damage != null
          ? -this._calculateSingleHitDamage(projectileActor, projectileTarget)
          : calculateHeal(projectileActor, projectileTarget);
    } else {
      projectile.value = data.damage != null ? -rawValue : rawValue;
    }

    const { target, pid } = data;

    if (!this.projectilesByTarget.has(target)) {
      this.projectilesByTarget.set(target, new Map());
    }

    this.projectilesByTarget.get(target).set(pid, projectile);
    this.pidToTarget.set(pid, target);
  };

  _onProjectileHit = (data) => {
    if (!data?.pid) return;

    const target = this.pidToTarget.get(data.pid);
    if (!target) return;

    const targetMap = this.projectilesByTarget.get(target);
    if (targetMap) {
      targetMap.delete(data.pid);
      if (targetMap.size === 0) this.projectilesByTarget.delete(target);
    }

    this.pidToTarget.delete(data.pid);
  };

  _bindEvents() {
    this.socket.on("action", this._onIncomingProjectile);
    this.socket.on("hit", this._onProjectileHit);
  }

  _cleanExpiredProjectile() {
    const now = performance.now();

    for (const [target, map] of this.projectilesByTarget) {
      for (const [pid, projectile] of map) {
        if (projectile.arrival + 100 < now) {
          map.delete(pid);
          this.pidToTarget.delete(pid);
        }
      }

      if (map.size === 0) this.projectilesByTarget.delete(target);
    }
  }

  cleanUp() {
    if (this.socket) {
      this.socket.off("action", this._onIncomingProjectile);
      this.socket.off("hit", this._onProjectileHit);
    }

    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }

    this.projectilesByTarget.clear();
    this.pidToTarget.clear();

    this._initialized = false;
    this.socket = null;
  }

  /**
   * @param {string} target entity id
   * @returns {number} negative for damage in the air, positive for heals
   */
  getIncomingNumber(target) {
    const map = this.projectilesByTarget.get(target);
    if (!map) return 0;

    let total = 0;
    for (const projectile of map.values()) total += projectile.value;
    return total;
  }

  init() {
    if (!this.socket || this._initialized) return;

    this._initialized = true;
    this._bindEvents();

    this._cleanupInterval = setInterval(() => {
      this._cleanExpiredProjectile();
    }, 500);
  }
}

if (typeof PROJECTILE_MANAGER === "undefined" && parent.socket) {
  var PROJECTILE_MANAGER = new ProjectileManagement(parent.socket);
}
