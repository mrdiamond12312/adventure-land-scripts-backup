const MAX_TARGET = 10;
const BLAST_RADIUS = character.blast / 3.6 || 17;
const TARGET_TO_SWITCH_TO_BLASTER_WEAPON = 3;
const MAX_MOB_DPS = 1000;
const BOOSTERS = ["goldbooster", "xpbooster", "luckbooster"];
const WATCHOUT_ABILITIES = ["burn"];

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
  else return mainStat / 20;
}

function canOneShotWithWeapon(weaponInfo, targets) {
  const classData = G.classes[character.ctype];
  const damageType = classData.damage_type;

  const currentInfo = character.slots.mainhand
    ? item_info(character.slots.mainhand)
    : { attack: 0, name: null, wtype: null };

  const effectiveAttack =
    character.attack +
    (weaponInfo.attack - currentInfo.attack) * rawAttackMultiplier();

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
        entity.attack > 1100 &&
        entity.type === "monster" &&
        !entity.target,
    ).length > 0
  );
}

function shouldWearLuckGear() {
  return Object.values(parent.entities).some(
    (mob) =>
      mob.type === "monster" &&
      !mob.rip &&
      !mob.dead &&
      mob.hp > 0 &&
      (mob.target === character.name || mob.cooperative) &&
      mob.hp <= Math.min(mob.max_hp * 0.15, 300000),
  );
}

function shouldWearExpGear() {
  return Object.values(parent.entities).some(
    (mob) =>
      mob.type === "monster" &&
      !mob.rip &&
      !mob.dead &&
      mob.hp > 0 &&
      (parent.party_list.includes(mob.target) || mob.cooperative) &&
      mob.hp <= Math.min(mob.max_hp * 0.1, 300000),
  );
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
          ? "sparkstaff"
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
    orb: feelingLucky ? "rabbitsfoot" : feelingWise ? "talkingskull" : "jacko",
    amulet: feelingWise ? "spookyamulet" : "intamulet",
  };
}

const STUN_FOCUS_LIST = ["crabxx", "grinch"];
function calculateWarriorItems() {
  const currentTarget = get_target();
  const shouldUseBlaster =
    numberOfMonsterAroundTarget(currentTarget) >= 2 && !currentTarget["1hp"];

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
function calculateRangerItems(target) {
  // Sanitize input
  const targets = !target ? [] : Array.isArray(target) ? target : [target];
  const feelingLucky = shouldWearLuckGear();
  const feelingWise = shouldWearExpGear();
  const someTargetCooperative = targets.some((mob) => mob.cooperative);

  // Start with current mainhand
  let mainhand = character.slots.mainhand?.name;

  const poucherAvailable = findMaxLevelItem(RANGER_INV_ITEMS.poucher) !== -1;

  // --- Poucher priority for pull strategy ---
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
            )) > 1,
      )
    ) {
      mainhand = RANGER_INV_ITEMS.poucher;
    }
    // --- Cooperative ---
    else if (
      someTargetCooperative
      // || targets.every((mob) => mob.target)
    ) {
      mainhand = RANGER_INV_ITEMS.fireBow;
    }
    // --- Calculate oneshot with crossbow ---
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
          });
        }
      }

      // Sort by smallest upgrade first (asc)
      rangedWeapons.sort((lhs, rhs) => lhs.attackDelta - rhs.attackDelta);

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
    orb: feelingLucky
      ? "rabbitsfoot"
      : feelingWise
      ? "talkingskull"
      : "orbofdex",
    amulet: feelingWise ? "spookyamulet" : "dexamulet",
    shoes: feelingLucky ? "wshoes" : "wingedboots",
    gloves: feelingLucky ? "wgloves" : "mittens",
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
      target &&
      target.type !== "monster" &&
      !["firestaff", "oozingterror", "pmace", "lmace"].includes(
        character.slots.mainhand?.name,
      )
        ? "oozingterror"
        : // : ["pinkgoo", "snowman", "wabbit", "crab"].includes(
        //     get_targeted_monster()?.mtype,
        //   )
        // ? "pinkie"
        character.map === "crypt"
        ? currentTarget && currentTarget.s["frozen"]
          ? "oozingterror"
          : "froststaff"
        : feelingLucky
        ? "lmace"
        : currentTarget &&
          (currentTarget.cooperative ||
            currentTarget["1hp"] ||
            currentTarget["avoidance"] > 90)
        ? "firestaff"
        : "oozingterror",
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
    ring2: "zapper",
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

  if ((!isLooting && currentBooster) || forced) {
    if (suggestedItems.booster && currentBooster !== suggestedItems.booster) {
      promises.push(shift(locate_item(currentBooster), suggestedItems.booster));
      delete suggestedItems.booster;
    } else if (
      currentBooster !== "luckbooster" &&
      (get_target()?.cooperative ||
        (isAssignedAsTanker() && avgDmgTaken(character) > 300))
    ) {
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
  if (itemSlots.length)
    if (itemSlots.length <= 2 && !character.s.penalty_cd)
      for (const item of itemSlots) promises.push(equip(item.num, item.slot));
    else promises.push(equip_batch(itemSlots));
  return Promise.all(promises).finally(() => {
    isEquipingItems = false;
  });
}

// Utilities
function calculateDamage(target, characterEntity, recursion = true) {
  if (!target) return 0;
  switch (target?.damage_type) {
    case "magical":
      return (
        target.attack *
          dps_multiplier(
            characterEntity.resistance -
              (target.type === "monster"
                ? G.monsters[target.mtype].rpiercing ?? 0
                : 0),
          ) *
          target.frequency +
        (target.dreturn && recursion
          ? characterEntity.range < 100
            ? (calculateDamage(characterEntity, target, false) *
                (target.dreturn ?? 0)) /
              100
            : 0
          : 0)
      );
    case "physical":
      return (
        target.attack *
          dps_multiplier(
            characterEntity.armor -
              (characterEntity.s["hardshell"]
                ? G.conditions.hardshell.armor
                : 0) -
              (target.type === "monster"
                ? G.monsters[target.mtype].apiercing ?? 0
                : 0) *
                2,
          ) *
          target.frequency +
        (target.dreturn && recursion
          ? characterEntity.range < 100
            ? (calculateDamage(characterEntity, target, false) *
                (target.dreturn ?? 0)) /
              100
            : 0
          : 0)
      );
    default:
      return target.attack * target.frequency;
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

  return numberOfMobs < 3 ? 1 : 1.7;
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
            (G.monsters[highestBurningMob.mtype].rpiercing ?? 0)
          : 1,
      ) *
      ((100 - fireResist) / 100) *
      (highestBurningMob.abilities.burn.unlimited ? 3 : 1.5) *
      highestBurningMob.attack
    : 0;

  return (
    listOfAttackingMobs.reduce(
      (accummulator, currentMob) =>
        accummulator + calculateDamage(currentMob, characterEntity),
      0,
    ) *
      mobbingMultiplier(numberOfAttackingMobs) +
    Math.max(characterEntity.s.burned?.intensity ?? 0, burnPadding)
  );
}

function avgPartyDmgTaken(partyMems, dmgType = null) {
  return partyMems.reduce(
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
  if (partyMems.includes(WARRIOR) && partyMems.includes(HEALER)) {
    const partyDmgTaken = avgPartyDmgTaken(partyMems);
    const partyMagicalDmgTaken = avgPartyDmgTaken(partyMems, "magical");

    // If more than half of taken DMG is magical, set our HEALER to be TANKER
    const magicDmgRatio = partyMagicalDmgTaken / partyDmgTaken;
    TANKER = magicDmgRatio > 0.5 ? HEALER : WARRIOR;
    partyMems = rotateLeader(partyMems, TANKER);
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
    character.s.sugarrush ||
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
  const partyHealer = get_entity(HEALER) ?? get_entity(RANGER);

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

  if (target && target.attack > 600 && !target.target) {
    const partyPriest = [...parent.party_list, ...partyMems]
      .map((id) => get_player(id))
      .filter((player) => player?.ctype === "priest");
    return partyPriest.length > 0 || (partyHealer && !partyHealer.rip);
  }

  return true;
}

// New Temporal Surge Logic
async function useTemporalSurge() {
  if (isAdvanceSmartMoving || smart.moving) return false;
  if (
    is_on_cooldown("temporalsurge") ||
    character.mp < G.skills["temporalsurge"].mp + 400
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
