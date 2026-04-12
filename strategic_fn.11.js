const MAX_TARGET = 10;
const BLAST_DIVISOR = 3.6;
const BLAST_RADIUS = getMaxBlastRadius() || 17;
const TARGET_TO_SWITCH_TO_BLASTER_WEAPON = 2;
const MAX_MOB_DPS = 2500;
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
      if (!info?.level) return null;

      return {
        item,
        type: info.wtype ?? info.type,
        blast: info.blast ?? info.explosion ?? 0,
        level: info.level,
      };
    });

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
    (best, { blast }) => Math.max(best, blast),
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

  if (damageType === "physical") {
    return weaponData.apiercing ?? 0;
  }

  if (damageType === "magical") {
    return weaponData.rpiercing ?? 0;
  }

  return 0;
}

function getMobDefense(mob) {
  const damageType = G.classes[character.ctype]?.damage_type;

  if (damageType === "physical") {
    return mob.armor ?? 0;
  }

  if (damageType === "magical") {
    return mob.resistance ?? 0;
  }

  return 0;
}

function rawAttackMultiplier() {
  const mainStat = G.classes[character.ctype].main_stat;

  if (character.ctype === "paladin")
    return character.str / 20 + character.int / 40;
  else return character[mainStat] / 20;
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

// Counting
function numberOfMonsterAroundTarget(target, blastRadius = BLAST_RADIUS) {
  if (!target) return 0;
  if (
    !["warrior", "priest", "paladin"].includes(character.ctype) &&
    Object.values(parent.entities).some(
      (entity) =>
        distance(target, entity) < blastRadius &&
        !entity.target &&
        entity.type === "monster",
    )
  )
    return 0;

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
  return (
    Object.values(parent.entities).filter(
      (entity) =>
        parent.distance(target, entity) < blastRadius &&
        calculateDamage(target, character, false) > 1100 &&
        entity.type === "monster" &&
        !entity.target,
    ).length > 0
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
  attackFrequencyBeforeComponsate,
  attackFrequencyAfterComponsate = character.frequency,
) {
  if (attackFrequencyBeforeComponsate > attackFrequencyAfterComponsate) {
    const compensateMs =
      1000 / attackFrequencyAfterComponsate -
      1000 / attackFrequencyBeforeComponsate;
    reduce_cooldown("attack", compensateMs);
  }
}

// Class Items logic
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
    mainhand:
      character.map === "crypt" && !currentTarget?.s?.frozen
        ? "froststaff"
        : ["pinkgoo", "snowman", "wabbit", "crab"].includes(
            currentTarget?.mtype,
          ) ||
          (currentTarget?.max_hp < 2000 &&
            (currentStrategy !== usePullStrategies || !haveEnoughMobsToSplash))
        ? "pinkie"
        : currentStrategy === usePullStrategies
        ? shouldUseBlaster
          ? "gstaff" // or "sparkstaff"
          : "firestaff"
        : "firestaff",
    offhand:
      currentStrategy === usePullStrategies
        ? shouldUseBlaster
          ? undefined
          : "wbook1"
        : "wbook1",
    helmet: feelingLucky ? "eears" : "gphelmet",
    chest: "epyjamas",
    pants: "starkillers",
    shoes: "wingedboots",
    gloves: "supermittens",
    cape: "horsecapeg",
    orb: feelingLucky ? "rabbitsfoot" : feelingWise ? "talkingskull" : "jacko",
    amulet: feelingWise ? "spookyamulet" : "intamulet",
  };
}

const STUN_FOCUS_LIST = ["crabxx", "grinch"];
function calculateWarriorItems() {
  const currentTarget = get_target();
  const shouldUseBlaster =
    numberOfMonsterAroundTarget(currentTarget) >=
      TARGET_TO_SWITCH_TO_BLASTER_WEAPON && !currentTarget["1hp"];

  const feelingLucky = shouldWearLuckGear();
  const feelingWise = shouldWearExpGear();
  const isTanker =
    isAssignedAsTanker() && avgDmgTaken(character, "physical") > 300;

  if (
    currentTarget &&
    ["pinkgoo", "snowman", "wabbit"].includes(currentTarget.mtype)
  )
    return {
      mainhand: "rapier",
      offhand: undefined,
      orb: "rabbitsfoot",
      amulet: "spookyamulet",
      chest: "cdragon",
      helmet: "oxhelmet",
    };

  return {
    helmet: feelingLucky
      ? "oxhelmet"
      : character.map === "crypt"
      ? "xhelmet"
      : "fury",
    mainhand:
      currentStrategy === usePullStrategies && shouldUseBlaster
        ? "vhammer"
        : currentTarget && STUN_FOCUS_LIST.includes(currentTarget.mtype)
        ? "xmace"
        : "fireblade",
    offhand:
      (character.map === "crypt" &&
        Object.values(parent.entities).some(
          (mob) => mob.target === character.name && mob.mtype === "a2",
        )) ||
      feelingLucky
        ? "mshield"
        : currentStrategy === usePullStrategies && shouldUseBlaster
        ? "ololipop"
        : "fireblade",
    amulet: feelingLucky
      ? "spookyamulet"
      : (isTanker &&
          Object.values(parent.entities)
            .filter((entity) => entity.type === "monster")
            .some((mob) => mob.target === character.name)) ||
        character.map === "crypt"
      ? "snring"
      : "stramulet",
    orb: feelingLucky
      ? "rabbitsfoot"
      : feelingWise
      ? "talkingskull"
      : "orbofstr",
    chest: feelingLucky
      ? "cdragon"
      : character.map === "crypt"
      ? "xarmor"
      : "coat1",
    pants: isTanker ? "frankypants" : "fallen",
    ring2:
      currentTarget && currentTarget.armor > 125 ? "suckerpunch" : "strring",
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

  return targets.reduce((sum, mob) => {
    const cluster = numberOfMonsterAroundTarget(
      mob,
      explosion / 3.6 || BLAST_RADIUS,
    );

    return (
      sum + attack + ((attack * explosion) / 100) * Math.max(0, cluster - 1)
    );
  }, 0);
}

function chooseFireOrPouchForSplashing(targets) {
  const currentBow = {
    ...(item_info(character.slots.mainhand) ?? {}),
    explosion_delta: 0,
  };
  const currentBowExplosion = currentBow.explosion ?? 0;

  const firebowSlot = findMaxLevelItem(RANGER_INV_ITEMS.fireBow);
  const fireInfo =
    currentBow?.id === RANGER_INV_ITEMS.fireBow
      ? currentBow
      : firebowSlot !== -1
      ? item_info(character.items[firebowSlot])
      : undefined;

  const pouchbowSlot = findMaxLevelItem(RANGER_INV_ITEMS.poucher);
  const pouchInfo =
    currentBow?.id === RANGER_INV_ITEMS.poucher
      ? currentBow
      : pouchbowSlot !== -1
      ? item_info(character.items[pouchbowSlot])
      : undefined;

  if (!pouchInfo) return RANGER_INV_ITEMS.fireBow;
  if (!fireInfo) return RANGER_INV_ITEMS.poucher;

  if (pouchInfo.explosion_delta == null) {
    pouchInfo.explosion_delta = pouchInfo.explosion - currentBowExplosion;
  }

  if (fireInfo.explosion_delta == null) {
    fireInfo.explosion_delta = fireInfo.explosion - currentBowExplosion;
  }

  const fireScore = explosionScore(fireInfo, targets);
  const pouchScore = explosionScore(pouchInfo, targets);

  return pouchScore > fireScore
    ? RANGER_INV_ITEMS.poucher
    : RANGER_INV_ITEMS.fireBow;
}

function calculateRangerItems(target) {
  // Sanitize input
  const targets = !target ? [] : Array.isArray(target) ? target : [target];
  const feelingLucky = shouldWearLuckGear();
  const feelingWise = shouldWearExpGear();
  const someTargetCooperative = targets.some((mob) => mob.cooperative);

  // Start with current mainhand
  let mainhand = character.slots.mainhand?.name;

  const poucherAvailable = findMaxLevelItem(RANGER_INV_ITEMS.poucher) !== -1;

  // Splashing equipment choice
  if (targets.length)
    if (
      (poucherAvailable || mainhand === RANGER_INV_ITEMS.poucher) &&
      currentStrategy === usePullStrategies &&
      targets.some(
        (mob) =>
          (mob.cluster_count ??
            numberOfMonsterAroundTarget(
              mob,
              character.explosion / 3.6 || BLAST_RADIUS,
            )) >= TARGET_TO_SWITCH_TO_BLASTER_WEAPON,
      )
    ) {
      mainhand = chooseFireOrPouchForSplashing(targets);
    } else if (someTargetCooperative) {
      mainhand = RANGER_INV_ITEMS.fireBow;
    }
    // Check for one-shot possibility with other bows
    else {
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

      if (oneShotWeapon) {
        mainhand = oneShotWeapon.name;
      } else {
        mainhand = RANGER_INV_ITEMS.fireBow;
      }
    }

  return {
    helmet: feelingLucky ? "wcap" : "fury",
    mainhand,
    offhand: haveFormidableMonsterAroundTarget(target)
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

function calculateCupidItems() {
  const haveLowHpMobsNearby = shouldWearLuckGear();
  return {
    mainhand,
    orb: haveLowHpMobsNearby ? "rabbitsfoot" : "orbofdex",
  };
}

function calculatePriestItems(target) {
  const currentTarget = get_targeted_monster();
  const isTanking = isAssignedAsTanker();
  const feelingLucky = shouldWearLuckGear();
  const feelingWise = shouldWearExpGear();

  return {
    mainhand:
      target && target.type !== "monster"
        ? "lmace"
        : character.map === "crypt"
        ? currentTarget && currentTarget.s["frozen"]
          ? "lmace"
          : "froststaff"
        : feelingLucky
        ? "lmace"
        : "firestaff",
    offhand:
      character.map === "crypt"
        ? "wbook1"
        : isTanking && character.s.burned
        ? "wbookhs"
        : feelingLucky
        ? "mshield"
        : isTanking ||
          Object.values(parent.entities).some(
            (mob) =>
              mob.type === "monster" &&
              mob.target === character.name &&
              mob.damage_type === "magical",
          ) ||
          character.fear
        ? "wbookhs"
        : "wbook1",
    orb:
      isTanking && character.s.burned
        ? "orba"
        : feelingLucky
        ? "rabbitsfoot"
        : target?.type !== "monster"
        ? "jacko"
        : feelingWise
        ? "talkingskull"
        : "test_orb",
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

  // Safely handle missing target
  if (!target) {
    return {
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
  }

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
    ? dps_multiplier((target.armor ?? 0) - (character.apiercing * 2 ?? 0)) *
      ((100 - (target.firesistance ?? 0)) / 100) *
      1.5 *
      (character.attack - equipItemAttackOffset + targetStacks) *
      0.9
    : 0;

  const shouldEquipFireStar =
    rogueBurnDmg > (target.s?.burned?.intensity ?? 0) || target.cooperative;

  return {
    helmet: feelingLucky ? "wcap" : "fury",
    mainhand: "daggerofthedead",
    shoes: feelingLucky ? "wshoes" : "wingedboots",
    gloves: feelingLucky ? "wgloves" : "supermittens",
    offhand: shouldEquipFireStar ? fieryWeapon : "daggerofthedead",
    amulet: feelingLucky ? "spookyamulet" : "dexamulet",
    orb: feelingLucky ? "rabbitsfoot" : "orbofdex",
    chest: "wattire",
    pants: "wbreeches",
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
    case "cupid":
      return calculateCupidItems();
    case "priest":
      return calculatePriestItems(get_target());
    default:
      return {};
  }
}

// Equiping Items
function findMaxLevelItem(id, offset = 0) {
  let maxSlot = -1;
  let maxLevel = 0;
  const allItemOfId = [];
  for (let iter = 0; iter < character.items.length; iter++) {
    const currentItem = character.items[iter];
    if (currentItem && currentItem.name === id) {
      allItemOfId.push({ ...currentItem, slot: iter });
    }
    if (!(currentItem && currentItem.name === id)) continue;
    if ((currentItem.level ?? 0) >= maxLevel) {
      maxSlot = iter;
      maxLevel = currentItem.level;
    }
  }

  if (offset === 0) return maxSlot;
  else {
    return allItemOfId.sort((lhs, rhs) => {
      if (rhs.level === lhs.level) return rhs.slot - lhs.slot;
      return rhs.level - lhs.level;
    })[offset]?.slot;
  }
}

var isEquipingItems = false;
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

  if ((!isLooting || forced) && currentBooster) {
    if (suggestedItems.booster && currentBooster !== suggestedItems.booster) {
      promises.push(shift(locate_item(currentBooster), suggestedItems.booster));
      delete suggestedItems.booster;
    } else if (currentBooster !== "luckbooster" && shouldWearLuckGear()) {
      promises.push(shift(locate_item(currentBooster), "luckbooster"));
    } else if (currentBooster !== "xpbooster") {
      promises.push(shift(locate_item(currentBooster), "xpbooster"));
    }
  }

  if (
    suggestedItems["mainhand"] &&
    G.classes[character.ctype].doublehand[
      item_info({ name: suggestedItems["mainhand"] })?.wtype
    ] &&
    character.slots["offhand"]
  )
    promises.push(unequip("offhand"));

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
      const num = findMaxLevelItem(id, count); // pick nth item
      usedCounts[id] = count + 1; // increment for next use
      return { slot, num };
    })
    .filter((equipInfo) => equipInfo.num >= 0);

  // Slice items to prevent penalty_cd from affecting attack cooldown
  const msToNextAttack = ms_to_next_skill("attack");
  const timeToNextAttack =
    msToNextAttack === 0 ? 1000 / character.frequency : msToNextAttack;
  const maxItemsToEquip = Math.max(
    0,
    Math.floor((timeToNextAttack - (character.s.penalty_cd?.ms ?? 0)) / 120),
  );
  if (itemSlots.length > maxItemsToEquip && !forced) {
    itemSlots.splice(maxItemsToEquip);
  }

  if (itemSlots.length) {
    if (itemSlots.length <= 1)
      for (const item of itemSlots) promises.push(equip(item.num, item.slot));
    else promises.push(equip_batch(itemSlots));
    return Promise.all(promises).finally(() => {
      isEquipingItems = false;
    });
  } else {
    isEquipingItems = false;
    return false;
  }
}

function calculateHeal(fromEntity, toEntity) {
  if (!fromEntity) return 0;
  switch (fromEntity?.damage_type) {
    case "magical":
      return (
        fromEntity.heal *
        damage_multiplier(
          toEntity.resistance -
            (fromEntity.name === character.name
              ? character.rpiercing / 2 ?? 0
              : 0),
        )
      );
    case "physical":
      return (
        fromEntity.attack *
        damage_multiplier(
          toEntity.armor -
            (fromEntity.name === character.name
              ? character.apiercing / 2 ?? 0
              : 0),
        )
      );
  }
}

// Utilities
function calculateDamage(fromEntity, toEntity, recursion = true) {
  if (!fromEntity) return 0;

  switch (fromEntity?.damage_type) {
    case "magical":
      return (
        fromEntity.attack *
          dps_multiplier(
            toEntity.resistance -
              (fromEntity.type === "monster"
                ? G.monsters[fromEntity.mtype].rpiercing ?? 0
                : 0) *
                2,
          ) *
          fromEntity.frequency +
        (fromEntity.reflection && recursion
          ? toEntity.range > 100 &&
            (toEntity.type === "monster"
              ? G.monsters[toEntity.mtype].damage_type
              : G.classes[toEntity.ctype].damage_type) === "magical"
            ? (calculateDamage(toEntity, fromEntity, false) *
                (fromEntity.reflection ?? 0)) /
              100
            : 0
          : 0)
      );
    case "physical":
      return (
        fromEntity.attack *
          dps_multiplier(
            toEntity.armor -
              (toEntity.s["hardshell"] ? G.conditions.hardshell.armor : 0) -
              (fromEntity.type === "monster"
                ? G.monsters[fromEntity.mtype].apiercing ?? 0
                : 0) *
                2,
          ) *
          fromEntity.frequency +
        (fromEntity.dreturn && recursion
          ? toEntity.range < 100 &&
            (toEntity.type === "monster"
              ? G.monsters[toEntity.mtype].damage_type
              : G.classes[toEntity.ctype].damage_type) === "physical"
            ? (calculateDamage(toEntity, fromEntity, false) *
                (fromEntity.dreturn ?? 0)) /
              100
            : 0
          : 0)
      );
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
  // return numberOfMobs < 5 ? 1.7 : numberOfMobs < 6 ? 1.8 : 2;

  return numberOfMobs < 3 ? 1 : 1.5;
}

function avgDmgTaken(characterEntity, dmgType = null) {
  if (!characterEntity) return 0;
  const numberOfAttackingMobs = listOfMonsterAttacking(characterEntity).length;
  const listOfAttackingMobs = Object.values(parent.entities).filter(
    (mob) =>
      mob.target === characterEntity.name &&
      mob.type === "monster" &&
      (!dmgType || mob.damage_type === dmgType),
  );

  // Burn Damage padding
  const highestBurningMob = listOfAttackingMobs
    .filter((mob) => mob.abilities?.burn)
    .reduce((prev, current) => {
      if (!prev) return current;
      return prev.attack > current.attack ? prev : current;
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
      (accummulator, currentMob) =>
        accummulator + calculateDamage(currentMob, characterEntity),
      0,
    ) *
      mobbingMultiplier(numberOfAttackingMobs) +
    Math.max(currentBurnIntensity, burnPadding)
  );
}

function avgPartyDmgTaken(partyList = partyMems, dmgType = null) {
  return partyList.reduce(
    (accumulator, current) =>
      accumulator + avgDmgTaken(get_player(current), dmgType),
    0,
  );
}

function rotateLeader(partyList, newLeaderId) {
  const newLeaderIndex = partyList.indexOf(newLeaderId);
  if (newLeaderIndex === -1) return partyList; // not found
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
    const partyMagicalDmgTaken = avgPartyDmgTaken(partyMems, "physical");

    // If more than half of taken DMG is magical, set our HEALER to be TANKER
    const physicalDmgRatio = partyMagicalDmgTaken / partyDmgTaken;
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
  // 1. Party Data and Early Exit Preparation
  const partyHealer = get_entity(HEALER) ?? get_entity(RANGER);
  const partyTanker = get_entity(TANKER);
  // Calculate the healer's effective power (Heal > Attack > 0)
  const healerPower = partyHealer?.heal || partyHealer?.attack * 0.5 || 0;

  if (!partyHealer || !partyTanker) return [];

  // Healer's effective healing output (with a 5% buffer)
  const MAX_SAFE_DPS = healerPower * partyHealer.frequency * 0.95;
  // The damage threshold for adding a new mob (with a 10% buffer)
  const NEW_MOB_DMG_LIMIT = healerPower * partyHealer.frequency * 0.9;

  // 2. Identify and Filter Eligible Monsters
  // This section filters the world for mobs that are:
  // - A 'monster'
  // - Within 'cburst' range
  // - Safe for the tank (DPS < MAX_MOB_DPS)
  // - Out of the mage's range (mob.range < character.range - 20)
  // - Does NOT have any abilities in the WATCHOUT_ABILITIES list
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

  // 3. Iterative Selection Logic
  const selectedMobs = [];

  // Initial State Variables
  let currentPartyDmgRecieved = avgPartyDmgTaken(partyMems);
  let tankerCurrentAggroCount = listOfMonsterAttacking(partyTanker).length;

  for (const mob of eligibleMobs) {
    // Stop adding mobs if the party is already taking too much damage
    if (currentPartyDmgRecieved >= MAX_SAFE_DPS) break;

    // Check if the mob can be safely added:
    if (
      is_in_range(mob, "cburst") && // Check range again (safety/original code)
      !mob.target && // Mob must be untargeted
      currentPartyDmgRecieved +
        calculateDamage(mob, partyTanker) *
          mobbingMultiplier(tankerCurrentAggroCount + 1) <
        NEW_MOB_DMG_LIMIT // Aggroing the mob must be within the safe limit
    ) {
      // Select the mob
      selectedMobs.push(mob);

      // Update state variables for the next iteration
      const oldAggroMult = mobbingMultiplier(tankerCurrentAggroCount);
      tankerCurrentAggroCount += 1;
      const newAggroMult = mobbingMultiplier(tankerCurrentAggroCount);

      // Scale previous DPS to the new multiplier context and add the new mob's contribution
      // This ensures the damage calculation correctly accounts for the change
      // in the mobbing multiplier when aggro count increases.
      currentPartyDmgRecieved =
        (currentPartyDmgRecieved * newAggroMult) / oldAggroMult +
        calculateDamage(mob, partyTanker) * newAggroMult;
    }
  }

  // Return a ready to use list for mage to cburst, with 2 mp per target
  return selectedMobs.map((mob) => [mob, 2]);
}

isCleaving = false;
async function warriorCleave(currentStrategy) {
  const mobsList = Object.values(parent.entities).filter(
    (mob) =>
      mob.type === "monster" &&
      distance(mob, character) < G.skills["cleave"].range + character.xrange,
  );

  if (
    // character.s.sugarrush ||
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

  // List monsters attacking the character
  const mobsTargetingSelf = listOfMonsterAttacking(character);
  const magicalMobs = [],
    physicalMobs = [],
    pureMobs = [];

  for (const mob of mobsTargetingSelf) {
    if (mob.damage_type === "magical") magicalMobs.push(mob);
    else if (mob.damage_type === "physical") physicalMobs.push(mob);
    else if (mob.damage_type === "pure") pureMobs.push(mob);
  }

  // Get non-targeted monsters in cleave range
  const listOfNoTargetMonsterInRange = Object.values(parent.entities).filter(
    (mob) => {
      return (
        distance(mob, character) <
          G.skills["cleave"].range + character.xrange &&
        !mob.target &&
        mob.type === "monster" &&
        mob.hp >
          character.attack *
            dps_multiplier(mob.armor - character.apiercing * 2) *
            1.5 &&
        mob.attack > 150
      );
    },
  );

  // Categorize additional mobs that would be cleaved
  for (const mob of listOfNoTargetMonsterInRange) {
    if (mob.damage_type === "magical") magicalMobs.push(mob);
    else if (mob.damage_type === "physical") physicalMobs.push(mob);
    else if (mob.damage_type === "pure") pureMobs.push(mob);
  }

  // Check if cleaving would cause fear
  const isFeared =
    magicalMobs.length > character.mcourage ||
    physicalMobs.length > character.courage ||
    pureMobs.length > character.pcourage;

  // Identify strong mobs that might be risky
  const formidableMob = listOfNoTargetMonsterInRange.some(
    (mob) => mob.attack * mob.frequency > MAX_MOB_DPS,
  );

  // Calculate DPS after cleaving
  const allMobs = [...magicalMobs, ...physicalMobs, ...pureMobs];
  const totalDpsTaken =
    allMobs
      .map((mob) => calculateDamage(mob, character) * mob.frequency)
      .reduce((acc, dmg) => acc + dmg, 0) * mobbingMultiplier(allMobs.length);

  // Check if cleaving is safe and beneficial
  const healer = get_entity(HEALER) ?? get_entity(RANGER);
  const healerPower = healer?.heal ?? healer?.attack ?? 0;
  const healThreshold = currentStrategy === "pull" ? healerPower * 0.9 : 0;
  if (
    (currentStrategy === "pull"
      ? totalDpsTaken <= healThreshold ||
        listOfNoTargetMonsterInRange.length === 0
      : listOfNoTargetMonsterInRange.length === 0) &&
    !allMobs.some(
      (mob) =>
        MELEE_IGNORE_LIST.includes(mob.mtype) ||
        WATCHOUT_ABILITIES.some((skill) =>
          Object.keys(mob.abilities ?? {}).includes(skill),
        ),
    ) &&
    !listOfNoTargetMonsterInRange.some((mob) => mob.abilities?.burn) &&
    !isFeared &&
    !formidableMob &&
    !isEquipingItems
  ) {
    isEquipingItems = true;
    isCleaving = true;
    const warriorItems = calculateWarriorItems();
    promises.push(
      // equipBatch({ mainhand: "bataxe" }),
      Promise.all([unequip("offhand"), equip(findMaxLevelItem("bataxe"))]),
      withTimeout(use_skill("cleave"), 2500).then(async () => {
        reduce_cooldown("cleave", 0.95 * character.ping);
        await equipBatch(
          {
            mainhand: warriorItems.mainhand,
            offhand: warriorItems.offhand,
          },
          true,
        );
      }),
    );
  }

  return Promise.allSettled(promises).finally(() => {
    isCleaving = false;
    isEquipingItems = false;
  });
}

isStomping = false;
async function warriorStomp() {
  if (
    character.mp < G.skills["stomp"].mp ||
    is_on_cooldown("stomp") ||
    Object.values(parent.entities).filter(
      (mob) =>
        mob.type === "monster" &&
        distance(mob, character) < G.skills["stomp"].range,
    ).length === 0 ||
    isStomping
  )
    return;

  isStomping = true;
  const promises = [];
  const warriorItems = calculateWarriorItems();
  promises.push(
    equipBatch({ mainhand: "basher", offhand: undefined }, true),
    use_skill("stomp").then(async () => {
      reduce_cooldown("stomp", 0.95 * character.ping);
      await equipBatch(warriorItems, true);
    }),
  );

  return Promise.allSettled(promises).finally(() => {
    isStomping = false;
    isEquipingItems = false;
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
    const partyPriest = [...parent.party_list, ...partyMems]
      .map((id) => get_player(id))
      .filter((player) => player?.ctype === "priest");
    return partyPriest.length > 0 || (partyHealer && !partyHealer.rip);
  }

  return true;
}

async function scareAwayMobs() {
  if (
    (locate_item("jacko") !== -1 || character.slots["orb"].name === "jacko") &&
    Object.values(parent.entities).some(
      (mob) => mob?.target === character.name && mob?.type === "monster",
    ) &&
    !is_on_cooldown("scare") &&
    character.mp > 100
  ) {
    return Promise.all([
      equipBatch(
        {
          orb: "jacko",
        },
        true,
      ),
      use_skill("scare"),
    ]);
  }
}

// New Temporal Surge Logic
async function useTemporalSurge() {
  if (isAdvanceSmartMoving || smart.moving) return false;
  if (
    is_on_cooldown("temporalsurge") ||
    character.mp < G.skills["temporalsurge"].mp + 400 ||
    (isAssignedAsTanker() && character.s.burned)
  )
    return false;

  if (
    findMaxLevelItem("orboftemporal") === -1 &&
    character.slots.orb?.name !== "orboftemporal"
  ) {
    return false;
  }

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

    if (spawn.boundary) {
      return isSpawnInRange(spawn.boundary);
    }
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

// Surge loop
setInterval(async () => {
  await useTemporalSurge();
}, 1000);

class ProjectileManagement {
  constructor(socket) {
    this.socket = socket;
    this.projectilesByTarget = new Map(); // name/ID -> Map(pid -> projectile)
    this.pidToTarget = new Map(); // pid -> target for O(1) removals

    this.init();
  }

  _calculateSingleHitDamage(from, to) {
    const clone = { ...from, frequency: 1 };
    return calculateDamage(clone, to, false);
  }

  _onIncomingProjectile = (data) => {
    if (!data?.pid || !data?.target) return;
    if (data.source !== "attack" && data.source !== "heal") return;
    if (data.instant) return;

    // Only consider projectiles that have a damage or heal value
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

    // damage as negative and heal as positive
    if (projectileActor && projectileTarget) {
      projectile.value =
        data.damage != null
          ? -this._calculateSingleHitDamage(projectileActor, projectileTarget)
          : calculateHeal(projectileActor, projectileTarget);
    } else {
      projectile.value = data.damage != null ? -rawValue : rawValue;
    }

    const { target, pid } = data;

    // Init map for target if undefined
    if (!this.projectilesByTarget.has(target)) {
      this.projectilesByTarget.set(target, new Map());
    }

    // Store projectile under target -> pid
    this.projectilesByTarget.get(target).set(pid, projectile);

    // Optional but strongly recommended for O(1) removal later
    this.pidToTarget.set(pid, target);
  };

  _onProjectileHit = (data) => {
    if (!data?.pid) return;

    const target = this.pidToTarget.get(data.pid);
    if (!target) return;

    const targetMap = this.projectilesByTarget.get(target);
    if (targetMap) {
      targetMap.delete(data.pid);
      if (targetMap.size === 0) {
        this.projectilesByTarget.delete(target);
      }
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

      if (map.size === 0) {
        this.projectilesByTarget.delete(target);
      }
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
    for (const projectile of map.values()) {
      total += projectile.value;
    }
    return total;
  }

  init() {
    if (!this.socket) return;

    // Prevent double init
    if (this._initialized) return;
    this._initialized = true;

    // Bind socket listeners
    this._bindEvents();

    this._cleanupInterval = setInterval(() => {
      this._cleanExpiredProjectile();
    }, 500); // clear projectile once every 500ms
  }
}

if (!PROJECTILE_MANAGER && parent.socket) {
  var PROJECTILE_MANAGER = new ProjectileManagement(parent.socket);
}
