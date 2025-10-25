const MAX_TARGET = 5;
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

// Class Items logic
function calculateMageItems() {
  const shouldUseBlaster =
    numberOfMonsterAroundTarget(get_targeted_monster()) >=
      TARGET_TO_SWITCH_TO_BLASTER_WEAPON &&
    !get_targeted_monster()?.["1hp"] &&
    character.mp > G.skills["magiport"].mp + G.skills["blink"].mp;

  const haveLowHpMobsNearby = Object.values(parent.entities).some(
    (mob) =>
      (character.name === mob.target || mob.cooperative) &&
      mob.hp <= Math.min(mob.max_hp * 0.15, 30000),
  );

  return {
    mainhand:
      currentStrategy === usePullStrategies
        ? shouldUseBlaster
          ? "sparkstaff"
          : "firestaff"
        : character.map === "crypt" && !get_targeted_monster()?.s?.frozen
        ? "froststaff"
        : ["pinkgoo", "snowman", "wabbit", "crab"].includes(
            get_targeted_monster()?.mtype,
          ) || get_targeted_monster()?.max_hp < 2000
        ? "pinkie"
        : "firestaff",
    offhand:
      currentStrategy === usePullStrategies
        ? shouldUseBlaster
          ? undefined
          : "wbook1"
        : "wbook1",
    helmet: haveLowHpMobsNearby ? "eears" : "gphelmet",
    chest: "epyjamas",
    pants: "starkillers",
    shoes: "wingedboots",
    gloves: "supermittens",
    amulet: haveLowHpMobsNearby ? "spookyamulet" : "intamulet",
  };
}

function calculateWarriorItems() {
  const currentTarget = get_targeted_monster();
  const shouldUseBlaster =
    numberOfMonsterAroundTarget(currentTarget) >= 2 && !currentTarget["1hp"];

  const haveLowHpMobsNearby = Object.values(parent.entities).some(
    (mob) =>
      (mob.target === character.name || mob.cooperative) &&
      mob.hp <= Math.min(mob.max_hp * 0.15, 30000),
  );

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
    helmet: haveLowHpMobsNearby
      ? "oxhelmet"
      : character.map === "crypt"
      ? "xhelmet"
      : "fury",
    mainhand:
      currentStrategy === usePullStrategies && shouldUseBlaster
        ? "vhammer"
        : "xmace",
    offhand:
      (character.map === "crypt" &&
        Object.values(parent.entities).some(
          (mob) => mob.target === character.name && mob.mtype === "a2",
        )) ||
      haveLowHpMobsNearby
        ? "mshield"
        : currentStrategy === usePullStrategies && shouldUseBlaster
        ? "ololipop"
        : "fireblade",
    amulet: haveLowHpMobsNearby
      ? "spookyamulet"
      : (isAssignedAsTanker() &&
          Object.values(parent.entities)
            .filter((entity) => entity.type === "monster")
            .some((mob) => mob.target === character.name)) ||
        character.map === "crypt"
      ? "snring"
      : "stramulet",
    orb: haveLowHpMobsNearby ? "rabbitsfoot" : "orbofstr",
    chest: haveLowHpMobsNearby
      ? "cdragon"
      : character.map === "crypt"
      ? "xarmor"
      : "coat1",
    pants: character.map === "crypt" ? "frankypants" : "frankypants",
    ring2:
      currentTarget && currentTarget.armor > 125 ? "suckerpunch" : "strring",
  };
}

function calculateRangerItems() {
  return {
    mainhand: get_targeted_monster()?.cooperative ? "firebow" : "crossbow",
    orb: "rabbitsfoot",
  };
}

function calculateCupidItems() {
  return {
    mainhand: get_targeted_monster()?.cooperative ? "firebow" : "merry",
    orb: "talkingskull",
  };
}

function calculatePriestItems(target) {
  const haveLowHpMobsNearby = Object.values(parent.entities).some(
    (mob) =>
      (mob.target === character.name || mob.cooperative) &&
      mob.hp <= Math.min(mob.max_hp * 0.15, 100000),
  );
  const currentTarget = get_targeted_monster();
  return {
    mainhand:
      target &&
      target.type !== "monster" &&
      !["firestaff", "oozingterror", "pmace", "lmace"].includes(
        character.slots.mainhand?.name,
      )
        ? "oozingterror"
        : ["pinkgoo", "snowman", "wabbit", "crab"].includes(
            get_targeted_monster()?.mtype,
          )
        ? "pinkie"
        : character.map === "crypt"
        ? currentTarget && currentTarget.s["frozen"]
          ? "oozingterror"
          : "froststaff"
        : haveLowHpMobsNearby
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
        : isAssignedAsTanker() && character.s.burned
        ? "wbookhs"
        : haveLowHpMobsNearby
        ? "mshield"
        : TANKER === character.name ||
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
      isAssignedAsTanker() && character.s.burned
        ? "orba"
        : haveLowHpMobsNearby
        ? "rabbitsfoot"
        : target?.type !== "monster"
        ? "jacko"
        : "test_orb",
    amulet: isAssignedAsTanker() ? "t2stramulet" : "intamulet",
  };
}

function calculateRogueItems(target) {
  const fieryWeapon = "firestars";
  const targetStacks = target.s.stack?.s ?? 0;
  const fieryWeaponSlot = locate_item(fieryWeapon);
  const characterFireStars =
    fieryWeaponSlot !== -1
      ? character.items[fieryWeaponSlot]
      : character.slots.offhand?.name === fieryWeapon
      ? character.slots.offhand
      : undefined;
  const equipItemAttackOffset =
    item_info(character.slots.offhand).attack ??
    0 - item_info(characterFireStars).attack ??
    0;
  const rogueBurnDmg = characterFireStars
    ? dps_multiplier(target.armor - character.apiercing) *
      ((100 - (target.firesistance ?? 0)) / 100) *
      1.5 *
      (character.attack - equipItemAttackOffset + targetStacks) *
      0.9
    : 0;

  const shouldEquipFireStar = rogueBurnDmg > target.s.burn?.intensity;

  return {
    mainhand: "daggerofthedead",
    offhand: shouldEquipFireStar ? fieryWeapon : "daggerofthedead",
    amulet: haveLowHpMobsNearby ? "spookyamulet" : "dexamulet",
    orb: haveLowHpMobsNearby ? "rabbitsfoot" : "orbofdex",
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
      return calculateRangerItems();
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
  if ((character.cc > 130 || isEquipingItems) && !forced) return;

  isEquipingItems = true;

  const promises = [];

  const currentBooster = findInvBooster();

  if (!isLooting && currentBooster) {
    if (
      (get_targeted_monster()?.cooperative &&
        currentBooster !== "luckbooster") ||
      TANKER === character.name
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
          (target.frequency < 0.9 ? 0.9 : target.frequency) +
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
                : 0),
          ) *
          (target.frequency < 0.9 ? 0.9 : target.frequency) +
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
  return numberOfMobs < 5 ? 1.7 : numberOfMobs < 6 ? 1.8 : 2;
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
              (G.monsters[highestBurningMob.mtype].apiercing ?? 0)
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
    Math.max(characterEntity.s.burn?.intensity ?? 0, burnPadding)
  );
}

function avgPartyDmgTaken(partyMems, dmgType = null) {
  return partyMems.reduce(
    (accumulator, current) =>
      accumulator + avgDmgTaken(get_player(current), dmgType),
    0,
  );
}

function rotateLeader(mems, value) {
  const idx = mems.indexOf(value);
  if (idx === -1) return mems; // not found
  return mems.slice(idx).concat(mems.slice(0, idx));
}

function assignRoles() {
  if (partyMems.includes(WARRIOR) && partyMems.includes(HEALER)) {
    const partyDmgTaken = avgPartyDmgTaken(partyMems);
    const partyMagicalDmgTaken = avgPartyDmgTaken(partyMems, "magical");

    if (partyMagicalDmgTaken / partyDmgTaken >= 0.5) {
      TANKER = HEALER;
      partyMems = rotateLeader(partyMems, HEALER);
    } else {
      TANKER = WARRIOR;
      partyMems = rotateLeader(partyMems, WARRIOR);
    }
  }
}

function isAssignedAsTanker() {
  return character.name === TANKER;
}

function getMonstersToCBurst() {
  const partyHealer = get_entity(HEALER);
  const partyTanker = get_entity(TANKER);

  if (!(partyHealer && partyTanker)) return [];

  const mobsList = Object.values(parent.entities)
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

  const result = [];

  let partyDmgRecieved = avgPartyDmgTaken(partyMems);
  let tankerNumberOfAggroedMobs = listOfMonsterAttacking(partyHealer).length;

  for (const mob of mobsList) {
    if (partyDmgRecieved >= partyHealer.heal * partyHealer.frequency * 0.95)
      break;

    if (
      is_in_range(mob, "cburst") &&
      !mob.target &&
      partyDmgRecieved +
        calculateDamage(mob, partyTanker) *
          mobbingMultiplier(tankerNumberOfAggroedMobs + 1) <
        partyHealer.heal * partyHealer.frequency * 0.9
    ) {
      result.push([mob, 2]);
      tankerNumberOfAggroedMobs += 1;
      partyDmgRecieved =
        (partyDmgRecieved * mobbingMultiplier(tankerNumberOfAggroedMobs + 1)) /
          mobbingMultiplier(tankerNumberOfAggroedMobs) +
        calculateDamage(mob, partyTanker) *
          mobbingMultiplier(tankerNumberOfAggroedMobs + 1);
    }
  }
  return result;
}

isCleaving = false;
async function warriorCleave(currentStrategy) {
  const mobsList = Object.values(parent.entities).filter(
    (mob) =>
      mob.type === "monster" &&
      distance(mob, character) < G.skills["cleave"].range,
  );
  if (
    character.s.sugarrush ||
    character.s.penalty_cd ||
    character.mp < G.skills["cleave"].mp + 280 ||
    is_on_cooldown("cleave") ||
    character.cc >= 100 ||
    mobsList.some((mob) => mob.type === "porcupine") ||
    mobsList.length === 0 ||
    isCleaving ||
    isEquipingItems
  )
    return;

  isCleaving = true;
  const promises = [];
  try {
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
              dps_multiplier(mob.armor - character.apiercing) *
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
    const healer = get_entity(HEALER);
    const healThreshold =
      currentStrategy === "pull" ? (healer?.heal ?? 0) * 0.9 : 0;

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
      !listOfNoTargetMonsterInRange.some((mob) => mob.abilities.burn) &&
      !isFeared &&
      !formidableMob &&
      !isEquipingItems
    ) {
      const warriorItems = calculateWarriorItems();
      promises.push(
        // equipBatch({ mainhand: "bataxe" }),
        Promise.all([unequip("offhand"), equip(findMaxLevelItem("bataxe"))]),
        withTimeout(use_skill("cleave"), 2500).then(async () => {
          reduce_cooldown("cleave", 0.95 * character.ping);
          await equipBatch({
            mainhand: warriorItems.mainhand,
            offhand: warriorItems.offhand,
          });
        }),
      );
    }
  } catch (e) {
    isCleaving = false;
  }

  return Promise.all(promises).finally(() => {
    isCleaving = false;
    isEquipingItems = false;
  });
}

isStomping = false;
async function warriorStomp() {
  if (
    character.mp < G.skills["stomp"].mp ||
    is_on_cooldown("stomp") ||
    character.cc >= 100 ||
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

  promises.push(
    equipBatch({ mainhand: "basher", offhand: undefined }, true),
    use_skill("stomp").then(() => {
      reduce_cooldown("stomp", 0.95 * character.ping);
      equipBatch(warriorItems, true);
    }),
  );

  return Promise.all(promises)
    .then(() => {
      isStomping = false;
      isEquipingItems = false;
    })
    .catch(() => {
      isStomping = false;
      isEquipingItems = false;
    });
}

function shouldAttack() {
  const currentTarget = get_targeted_monster();
  const partyHealer = get_entity(HEALER);
  return character.map === "crypt"
    ? partyHealer && !partyHealer.rip
    : ["warrior", "rogue"].includes(character.ctype) &&
      currentTarget &&
      MELEE_IGNORE_LIST.includes(currentTarget.mtype ?? currentTarget.ctype)
    ? false
    : currentTarget && currentTarget.attack > 600 && !currentTarget.target
    ? partyHealer && !partyHealer.rip
    : true;
}
