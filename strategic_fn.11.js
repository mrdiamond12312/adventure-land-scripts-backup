const MAX_TARGET = 5;
const BLAST_RADIUS = character.blast / 3.6 || 17;
const TARGET_TO_SWITCH_TO_BLASTER_WEAPON = 3;
const MAX_MOB_DPS = 1000;
const BOOSTERS = ["goldbooster", "xpbooster", "luckbooster"];

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
      TARGET_TO_SWITCH_TO_BLASTER_WEAPON && !get_targeted_monster()?.["1hp"];

  const haveLowHpMobsNearby = Object.values(parent.entities).some(
    (mob) =>
      (partyMems.includes(mob.target) || mob.cooperative) &&
      mob.hp <= mob.max_hp * 0.15,
  );

  return {
    mainhand:
      currentStrategy === usePullStrategies
        ? shouldUseBlaster
          ? "sparkstaff"
          : "firestaff"
        : character.map === "crypt" && !get_targeted_monster()?.s?.frozen
        ? "froststaff"
        : ["pinkgoo", "snowman", "wabbit", "crabxx", "crabx", "crab"].includes(
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
    helmet: "helmet1",
    chest: "coat1",
    pants: "starkillers",
    shoes: "wingedboots",
    gloves: "supermittens",
    amulet: haveLowHpMobsNearby ? "spookyamulet" : "intamulet",
  };
}

function calculateWarriorItems() {
  // const shouldUseBlaster =
  //   numberOfMonsterAroundTarget(get_targeted_monster()) >= 2 &&
  //   !get_targeted_monster()["1hp"];

  const haveLowHpMobsNearby = Object.values(parent.entities).some(
    (mobs) =>
      (mobs.target === character.name || mobs.cooperative) &&
      mobs.hp <= mobs.max_hp * 0.15,
  );

  if (["pinkgoo", "snowman", "wabbit"].includes(get_targeted_monster()?.mtype))
    return {
      mainhand: "rapier",
      offhand: undefined,
      orb: "rabbitsfoot",
      amulet: "spookyamulet",
      chest: "cdragon",
      helmet: "oxhelmet",
    };

  return {
    helmet: character.map === "crypt" ? "xhelmet" : "oxhelmet",
    mainhand:
      currentStrategy === usePullStrategies
        ? // && shouldUseBlaster
          "vhammer"
        : "xmace",
    offhand:
      (character.map === "crypt" &&
        Object.values(parent.entities).some(
          (mob) => mob.target === character.name && mob.mtype === "a2",
        )) ||
      haveLowHpMobsNearby
        ? "mshield"
        : currentStrategy === usePullStrategies
        ? // && shouldUseBlaster
          "ololipop"
        : "fireblade",
    amulet: haveLowHpMobsNearby
      ? "spookyamulet"
      : (character.name === TANKER &&
          Object.values(parent.entities)
            .filter((entity) => entity.type === "monster")
            .some((mob) => mob.target === character.name)) ||
        character.map === "crypt"
      ? "t2stramulet"
      : "stramulet",
    orb: haveLowHpMobsNearby ? "rabbitsfoot" : "orbofstr",
    chest: character.map === "crypt" ? "xarmor" : "cdragon",
    pants: character.map === "crypt" ? "frankypants" : "frankypants",
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

function calculatePriestItems() {
  const haveLowHpMobsNearby = Object.values(parent.entities).some(
    (mobs) =>
      (mobs.target === character.name || mobs.cooperative) &&
      mobs.hp <= mobs.max_hp * 0.15,
  );
  const currentTarget = get_targeted_monster();
  return {
    mainhand: [
      "pinkgoo",
      "snowman",
      "wabbit",
      "crabxx",
      "crabx",
      "crab",
    ].includes(get_targeted_monster()?.mtype)
      ? "pinkie"
      : character.map === "crypt"
      ? "froststaff"
      : currentTarget &&
        (currentTarget.cooperative ||
          currentTarget["1hp"] ||
          currentTarget["avoidance"] > 90)
      ? "firestaff"
      : haveLowHpMobsNearby
      ? "lmace"
      : character.name === TANKER ||
        (currentTarget &&
          currentTarget.type === "monster " &&
          currentTarget.max_hp < 8000)
      ? "harbringer"
      : "oozingterror",
    offhand:
      character.map === "crypt"
        ? "wbook1"
        : haveLowHpMobsNearby
        ? "mshield"
        : Object.values(parent.entities).some(
            (mob) => mob.type === "monster" && mob.target === character.name,
          ) && !character.fear
        ? "wbookhs"
        : "mshield",
    orb: haveLowHpMobsNearby ? "rabbitsfoot" : "test_orb",
    amulet: "intamulet",
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
      return calculatePriestItems();
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
  if ((character.cc > 100 || isEquipingItems) && !forced) return;

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

  promises.push(
    equip_batch(
      Object.keys(suggestedItems)
        .filter(
          (slot) =>
            suggestedItems[slot] &&
            (suggestedItems[slot] !== character.slots[slot]?.name ||
              character.items[findMaxLevelItem(suggestedItems[slot])]?.level >
                character.slots[slot]?.level),
        )
        .map((slot) => ({
          slot,
          num: findMaxLevelItem(suggestedItems[slot]),
        }))
        .filter((equipInfo) => equipInfo.num >= 0),
    )
      .then(() => {
        isEquipingItems = false;
      })
      .catch(() => {
        isEquipingItems = false;
      }),
  );
  return promises;
}

// Utilities
function calculateDamage(target, characterEntity, recursion = true) {
  if (!target) return 0;
  switch (target?.damage_type) {
    case "magical":
      return (
        target.attack *
          dps_multiplier(characterEntity.resistance - (target.rpiercing ?? 0)) *
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
          dps_multiplier(characterEntity.armor - (target.apiercing ?? 0)) *
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

function avgDmgTaken(characterEntity) {
  if (!characterEntity) return Infinity;
  const numberOfAttackingMobs = listOfMonsterAttacking(characterEntity).length;
  return (
    Object.keys(parent.entities)
      .filter(
        (id) =>
          parent.entities[id]?.target === characterEntity.name &&
          parent.entities[id]?.type === "monster",
      )
      .reduce(
        (accummulator, currentId) =>
          accummulator +
          calculateDamage(parent.entities[currentId], characterEntity),
        0,
      ) * mobbingMultiplier(numberOfAttackingMobs)
  );
}

function getMonstersToCBurst() {
  const partyHealer = get_entity(HEALER);
  const partyTanker = get_entity(TANKER);

  if (!(partyHealer && partyTanker)) return [];

  const mobsList = Object.keys(parent.entities)
    .filter(
      (id) =>
        parent.entities[id]?.type === "monster" &&
        is_in_range(parent.entities[id], "cburst") &&
        calculateDamage(parent.entities[id], partyTanker) < MAX_MOB_DPS &&
        parent.entities[id].range < character.range - 20,
    )
    .sort(
      (lhs, rhs) =>
        distance(character, parent.entities[rhs]) -
        distance(character, parent.entities[lhs]),
    );

  const result = [];

  let partyDmgRecieved = partyMems.reduce(
    (accumulator, current) => accumulator + avgDmgTaken(get_player(current)),
    0,
  );
  let tankerNumberOfAggroedMobs = listOfMonsterAttacking(partyHealer).length;

  for (const mobId of mobsList) {
    if (partyDmgRecieved >= partyHealer.heal * partyHealer.frequency * 0.95)
      break;

    if (
      is_in_range(parent.entities[mobId], "cburst") &&
      !parent.entities[mobId]?.target &&
      partyDmgRecieved +
        calculateDamage(parent.entities[mobId], partyTanker) *
          mobbingMultiplier(tankerNumberOfAggroedMobs + 1) <
        partyHealer.heal * partyHealer.frequency * 0.9
    ) {
      result.push([parent.entities[mobId], 2]);
      tankerNumberOfAggroedMobs += 1;
      partyDmgRecieved =
        (partyDmgRecieved * mobbingMultiplier(tankerNumberOfAggroedMobs + 1)) /
          mobbingMultiplier(tankerNumberOfAggroedMobs) +
        calculateDamage(parent.entities[mobId], partyTanker) *
          mobbingMultiplier(tankerNumberOfAggroedMobs + 1);
    }
  }
  return result;
}

isCleaving = false;
async function warriorCleave(currentStrategy) {
  if (
    character.mp < G.skills["cleave"].mp + 280 ||
    is_on_cooldown("cleave") ||
    character.cc >= 95 ||
    Object.values(parent.entities).filter(
      (mob) =>
        mob.type === "monster" &&
        distance(mob, character) < G.skills["cleave"].range,
    ).length === 0 ||
    isCleaving
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
        ? totalDpsTaken <= healThreshold
        : listOfNoTargetMonsterInRange.length === 0) &&
      !isFeared &&
      !formidableMob &&
      !isEquipingItems
    ) {
      await equipBatch({ mainhand: "bataxe", offhand: undefined });
      promises.push();

      const warriorItems = calculateWarriorItems();
      isEquipingItems = true;

      await use_skill("cleave").then(() => {
        reduce_cooldown("cleave", 0.95 * character.ping);
        equip_batch([
          {
            slot: "mainhand",
            num: findMaxLevelItem(warriorItems.mainhand),
          },
          {
            slot: "offhand",
            num: findMaxLevelItem(warriorItems.offhand),
          },
        ]);
      });
    }
  } catch (e) {
    isCleaving = false;
    isEquipingItems = false;
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

  await equipBatch({ mainhand: "basher", offhand: undefined });

  const warriorItems = calculateWarriorItems();
  isEquipingItems = true;

  promises.push(
    use_skill("stomp").then(() => {
      reduce_cooldown("stomp", 0.95 * character.ping);
      equip_batch([
        {
          slot: "mainhand",
          num: findMaxLevelItem(warriorItems.mainhand),
        },
        {
          slot: "offhand",
          num: findMaxLevelItem(warriorItems.offhand),
        },
      ]);
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
  return character.map === "crypt"
    ? get_entity(HEALER)
    : currentTarget &&
      currentTarget.attack > 600 &&
      partyMems.includes(currentTarget.target)
    ? get_entity(HEALER)
    : true;
}
