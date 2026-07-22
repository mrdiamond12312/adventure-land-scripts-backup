const MAX_TARGET = 10;
const BLAST_DIVISOR = 3.6;
const BLAST_RADIUS = getMaxBlastRadius() || 17;
const TARGET_TO_SWITCH_TO_BLASTER_WEAPON = 2;
const MAX_MOB_DPS = 2500;
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

function canOneShotWithWeapon(weaponInfo, targets) {
  const classData = G.classes[character.ctype];
  const damageType = classData.damage_type;

  const currentInfo = character.slots.mainhand
    ? item_info(character.slots.mainhand)
    : { attack: 0, name: null, wtype: null };

  const effectiveAttack =
    character.attack +
    (weaponInfo.attack - currentInfo.attack) * (rawAttackMultiplier() + 1);

  let effectivePiercing =
    damageType === "physical" ? character.apiercing : character.rpiercing;

  if (currentInfo.name !== weaponInfo.name) {
    effectivePiercing += getRelevantPiercing(weaponInfo.wtype);
  }

  const piercingMultiplier = damageType === "physical" ? 2 : 1;
  const shotMultiplier =
    targets.length >= 4 ? 0.5 : targets.length >= 2 ? 0.7 : 1;

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

function numberOfMonsterAroundTarget(target, blastRadius = BLAST_RADIUS) {
  if (!target) return 0;

  const hasUntargetedMonsterNearby = Object.values(parent.entities).some(
    (entity) =>
      entity.type === "monster" &&
      distance(target, entity) < blastRadius &&
      !entity.target,
  );

  if (
    !["warrior", "priest", "paladin"].includes(character.ctype) &&
    hasUntargetedMonsterNearby
  ) {
    return 0;
  }

  return Object.values(parent.entities).filter(
    (entity) =>
      entity.type === "monster" &&
      distance(target, entity) < blastRadius &&
      entity.target,
  ).length;
}

function findInvBooster() {
  return BOOSTERS.find((booster) => locate_item(booster) !== -1);
}

function haveFormidableMonsterAroundTarget(target, blastRadius = BLAST_RADIUS) {
  return Object.values(parent.entities).some(
    (entity) =>
      entity.type === "monster" &&
      !entity.target &&
      parent.distance(target, entity) < blastRadius &&
      calculateDamage(entity, character, false) > 1100,
  );
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
  return Object.values(parent.entities).some(
    (mob) =>
      mob.type === "monster" &&
      !EQUIP_IGNORE_MOBS.includes(mob.mtype) &&
      !mob.rip &&
      !mob.dead &&
      mob.hp > 0 &&
      (parent.party_list.includes(mob.target) || mob.cooperative) &&
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

function getMageMainhand(
  currentTarget,
  shouldUseBlaster,
  haveEnoughMobsToSplash,
) {
  if (character.map === "crypt" && !currentTarget?.s?.frozen)
    return "froststaff";

  const isWeakMob = MAGE_WEAK_MOB_TYPES.includes(currentTarget?.mtype);
  const isLowHpMob =
    currentTarget?.max_hp < 2000 &&
    (currentStrategy !== usePullStrategies || !haveEnoughMobsToSplash);

  if (isWeakMob || isLowHpMob) return "pinkie";

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
    character.mp > G.skills["magiport"].mp + G.skills["blink"].mp;

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

function getWarriorChest(feelingLucky) {
  if (feelingLucky) return "cdragon";
  if (character.map === "crypt") return "xarmor";
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
    chest: getWarriorChest(feelingLucky),
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
};

function explosionScore(itemInfo, targets) {
  if (!itemInfo || !targets?.length) return 0;

  const attack = itemInfo.attack || 0;
  const explosion =
    (character.explosion ?? 0) + (itemInfo.explosion_delta ?? 0);

  return targets.reduce((accumulator, mob) => {
    const cluster = numberOfMonsterAroundTarget(
      mob,
      explosion / 3.6 || BLAST_RADIUS,
    );
    return (
      accumulator +
      attack +
      ((attack * explosion) / 100) * Math.max(0, cluster - 1)
    );
  }, 0);
}

function chooseFireOrPouchForSplashing(targets) {
  const currentBow = {
    ...(item_info(character.slots.mainhand) ?? {}),
    explosion_delta: 0,
  };
  const currentBowExplosion = currentBow.explosion ?? 0;

  const resolveBowInfo = (id) => {
    if (currentBow.id === id) return currentBow;

    const slot = findMaxLevelItem(id);
    if (slot === -1) return undefined;

    const info = item_info(character.items[slot]);
    return {
      ...info,
      explosion_delta: (info.explosion ?? 0) - currentBowExplosion,
    };
  };

  const fireInfo = resolveBowInfo(RANGER_INV_ITEMS.fireBow);
  const pouchInfo = resolveBowInfo(RANGER_INV_ITEMS.poucher);

  if (!pouchInfo) return RANGER_INV_ITEMS.fireBow;
  if (!fireInfo) return RANGER_INV_ITEMS.poucher;

  const fireScore = explosionScore(fireInfo, targets);
  const pouchScore = explosionScore(pouchInfo, targets);

  return pouchScore > fireScore
    ? RANGER_INV_ITEMS.poucher
    : RANGER_INV_ITEMS.fireBow;
}

function calculateRangerItems(target) {
  const targets = !target ? [] : Array.isArray(target) ? target : [target];
  const feelingLucky = shouldWearLuckGear();
  const feelingWise = shouldWearExpGear();
  const someTargetCooperative = targets.some((mob) => mob.cooperative);

  let mainhand = character.slots.mainhand?.name;
  const poucherAvailable = findMaxLevelItem(RANGER_INV_ITEMS.poucher) !== -1;

  if (targets.length) {
    const canSplash =
      (poucherAvailable || mainhand === RANGER_INV_ITEMS.poucher) &&
      currentStrategy === usePullStrategies &&
      targets.some(
        (mob) =>
          (mob.cluster_count ??
            numberOfMonsterAroundTarget(
              mob,
              character.explosion / 3.6 || BLAST_RADIUS,
            )) >= TARGET_TO_SWITCH_TO_BLASTER_WEAPON,
      );

    if (canSplash) {
      mainhand = chooseFireOrPouchForSplashing(targets);
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
            item.name === "cupid"
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
    offhand: targets.some((entity) => haveFormidableMonsterAroundTarget(entity))
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

// Keep the heal mace equipped for a short grace window after the last time we
// wanted it, so a healee that another player tops up doesn't make us flicker
// the wand back and forth (each swap also costs EQUIP_PENALTY_MS).
let priestLastHealMainhandAt = 0;

function getPriestMainhand(target, currentTarget, feelingLucky) {
  const now = Date.now();

  if (target && target.type !== "monster") {
    priestLastHealMainhandAt = now;
    return "lmace";
  }

  // Guard until the end of next attack
  const graceMs = ms_to_next_skill("attack") + 1000 / character.frequency;
  if (now - priestLastHealMainhandAt < graceMs) {
    return "lmace";
  }

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
  if (target?.type !== "monster") return "jacko";
  if (feelingWise) return "talkingskull";
  return "test_orb";
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
    amulet: isTanking ? "t2stramulet" : "intamulet",
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
async function equipBatch(suggestedItems, forced = false) {
  if (
    (character.cc > 130 ||
      isEquipingItems ||
      character.s.penalty_cd ||
      isLooting) &&
    !forced
  )
    return false;

  isEquipingItems = true;

  const promises = [];
  const currentBooster = findInvBooster();

  // Budget of penalty_cd we can spend before the next attack comes off cooldown
  const msToNextAttack = ms_to_next_skill("attack");
  const timeToNextAttack =
    msToNextAttack === 0 ? 1000 / character.frequency : msToNextAttack;
  const currentPenalty = character.s.penalty_cd?.ms ?? 0;
  const equipLatency = Math.min(character.ping / 2, 100);
  let penaltyBudget = timeToNextAttack - currentPenalty - equipLatency;

  let targetBooster = null;
  if ((!isLooting || forced) && currentBooster) {
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
  if (targetBooster && (forced || penaltyBudget >= SHIFT_PENALTY_MS)) {
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
        (suggestedItems[slot] !== character.slots[slot]?.name ||
          character.items[findMaxLevelItem(suggestedItems[slot])]?.level >
            character.slots[slot]?.level),
    )
    .map((slot) => {
      const id = suggestedItems[slot];
      const count = usedCounts[id] || 0;
      const num = findMaxLevelItem(id, count);
      usedCounts[id] = count + 1;
      return { slot, num };
    })
    .filter((equipInfo) => equipInfo.num >= 0);

  // Slice items to prevent penalty_cd from affecting attack cooldown
  const maxItemsToEquip = Math.max(
    0,
    Math.floor(penaltyBudget / EQUIP_PENALTY_MS),
  );

  if (itemSlots.length > maxItemsToEquip && !forced) {
    itemSlots.splice(maxItemsToEquip);
  }

  if (itemSlots.length <= 1) {
    for (const item of itemSlots) promises.push(equip(item.num, item.slot));
  } else {
    promises.push(equip_batch(itemSlots));
  }

  if (!promises.length) {
    isEquipingItems = false;
    return false;
  }

  return Promise.all(promises).finally(() => {
    isEquipingItems = false;
  });
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
          ? (G.monsters[fromEntity.mtype].rpiercing ?? 0)
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
          ? (G.monsters[fromEntity.mtype].apiercing ?? 0)
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
    ? (characterEntity.s.burned?.intensity ?? 0)
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

let isCleaving = false;
async function warriorCleave(currentStrategy) {
  const mobsList = Object.values(parent.entities).filter(
    (mob) =>
      mob.type === "monster" &&
      distance(mob, character) < G.skills["cleave"].range + character.xrange,
  );

  if (
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

  const listOfNoTargetMonsterInRange = Object.values(parent.entities).filter(
    (mob) =>
      mob.type === "monster" &&
      !mob.target &&
      distance(mob, character) < G.skills["cleave"].range + character.xrange &&
      mob.hp >
        character.attack *
          dps_multiplier(mob.armor - character.apiercing * 2) *
          1.5 &&
      mob.attack > 150,
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

  const healThreshold = currentStrategy === "pull" ? healerHps() * 0.9 : 0;

  const isSafeToAggro =
    currentStrategy === "pull"
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
    const msToNextAttack = ms_to_next_skill("attack");
    const cleaveSet = [{ num: findMaxLevelItem("bataxe"), slot: "mainhand" }];

    if (msToNextAttack > 320)
      cleaveSet.push({ num: findMaxLevelItem("mpxamulet"), slot: "amulet" });

    promises.push(
      Promise.all([unequip("offhand"), equip_batch(cleaveSet)]),
      withTimeout(use_skill("cleave"), 2500).then(async () => {
        const warriorItems = calculateWarriorItems();
        reduce_cooldown("cleave", 0.95 * character.ping);
        await equipBatch(
          { mainhand: warriorItems.mainhand, offhand: warriorItems.offhand },
          true,
        );
      }),
    );
  }

  return Promise.allSettled(promises).finally(() => {
    isCleaving = false;
    // Only release the flag if the aggro branch above claimed it
    if (promises.length) isEquipingItems = false;
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

  promises.push(
    equipBatch({ mainhand: "basher", offhand: undefined }, true),
    use_skill("stomp").then(async () => {
      const warriorItems = calculateWarriorItems();
      reduce_cooldown("stomp", 0.95 * character.ping);
      await equipBatch(warriorItems, true);
    }),
  );

  return Promise.allSettled(promises).finally(() => {
    isStomping = false;
  });
}

function shouldAttack(target = get_target()) {
  const partyHealer = get_entity(HEALER);

  if (character.map === "crypt") {
    return !!partyHealer && !partyHealer.rip;
  }

  if (
    ["warrior", "rogue"].includes(character.ctype) &&
    target &&
    MELEE_IGNORE_LIST.includes(target.mtype ?? target.ctype)
  ) {
    return false;
  }

  if (
    target &&
    target.attack > 600 &&
    (!target.target || target.target === character.name)
  ) {
    const partyPriests = [...parent.party_list, ...partyMems]
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
      equipBatch({ orb: "jacko" }, true),
      use_skill("scare").then(() =>
        reduce_cooldown("scare", 0.95 * character.ping),
      ),
    ]);
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
      promises.push(equipBatch({ orb: "orboftemporal" }, true));
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
    return calculateDamage({ ...from, frequency: 1 }, to, false);
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
