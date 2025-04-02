const MAX_TARGET = 5;
const BLAST_RADIUS = character.blast / 3.6 || 60 / 17;
const TARGET_TO_SWITCH_TO_BLASTER_WEAPON = 3;
const MAX_MOB_DPS = 1000;

// Counting
function numberOfMonsterAroundTarget(target, blastRadius = BLAST_RADIUS) {
  if (!target) return 0;
  return Object.keys(parent.entities).filter(
    (entityId) =>
      parent.distance(target, parent.entities?.[entityId]) < blastRadius &&
      partyMems.includes(parent.entities?.[entityId].target)
  ).length;
}

function haveFormidableMonsterAroundTarget(target, blastRadius = BLAST_RADIUS) {
  return (
    Object.keys(parent.entities).filter(
      (entityId) =>
        parent.distance(target, parent.entities?.[entityId]) < blastRadius &&
        parent.entities[entityId]?.attack > 1100 &&
        parent.entities[entityId]?.type === "monster"
    ).length > 0
  );
}

// Class Items logic
function calculateMageItems(target) {
  const shouldUseBlaster =
    numberOfMonsterAroundTarget(target) >= TARGET_TO_SWITCH_TO_BLASTER_WEAPON &&
    !target["1hp"];

  return {
    mainhand:
      currentStrategy === usePullStrategies
        ? shouldUseBlaster
          ? "gstaff"
          : "firestaff"
        : character.map === "crypt" && !get_targeted_monster()?.s?.frozen
        ? "froststaff"
        : "firestaff",
    offhand:
      currentStrategy === usePullStrategies
        ? shouldUseBlaster
          ? undefined
          : "wbook1"
        : "wbook1",
  };
}

function calculateWarriorItems() {
  const haveLowHpMobsNearby = Object.values(parent.entities).some(
    (mobs) =>
      (partyMems.includes(mobs.target) || mobs.cooperative) &&
      mobs.hp <= mobs.max_hp * 0.15
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
    mainhand: currentStrategy === usePullStrategies ? "vhammer" : "xmace",
    offhand:
      (character.map === "crypt" &&
        Object.values(parent.entities).some(
          (mob) => mob.target === character.name && mob.mtype === "a2"
        )) ||
      haveLowHpMobsNearby
        ? "mshield"
        : currentStrategy === usePullStrategies
        ? "ololipop"
        : "fireblade",
    amulet: haveLowHpMobsNearby ? "spookyamulet" : "t2stramulet",
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

function calculatePriestItems() {
  const haveLowHpMobsNearby = Object.values(parent.entities).some(
    (mobs) =>
      (partyMems.includes(mobs.target) || mobs.cooperative) &&
      mobs.hp <= mobs.max_hp * 0.15
  );
  return {
    mainhand:
      character.map === "crypt" &&
      Object.values(parent.entities).some(
        (mob) => mob.type === "monster" && mob.target === character.name
      )
        ? "pmace"
        : get_targeted_monster()?.cooperative
        ? "firestaff"
        : haveLowHpMobsNearby
        ? "lmace"
        : "pmace",
    offhand: character.map === "crypt" ? "wbook1" : "mshield",
    orb: haveLowHpMobsNearby ? "rabbitsfoot" : "test_orb",
    amulet: "intamulet",
  };
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
async function equipBatch(suggestedItems) {
  if (character.cc > 100 || isEquipingItems) return;

  await Promise.all(
    Object.keys(suggestedItems).map(async (slot) => {
      if (character.slots[slot]?.name !== suggestedItems[slot]) unequip(slot);
    })
  );

  isEquipingItems = true;

  return equip_batch(
    Object.keys(suggestedItems)
      .filter((slot) => suggestedItems[slot] !== undefined)
      .map((slot) => ({
        slot,
        num: findMaxLevelItem(suggestedItems[slot]),
      }))
      .filter((equipInfo) => equipInfo.num >= 0)
  ).then(() => {
    isEquipingItems = false;
  });
}

// Utilities
function calculateDamage(target, characterEntity) {
  if (!target) return 0;
  switch (target?.damage_type) {
    case "magical":
      return (
        target.attack *
        (1 - (characterEntity.resistance - (target.rpierce ?? 0)) / 1000) *
        (target.frequency < 1 ? 1 : target.frequency)
      );
    case "physical":
      return (
        target.attack *
        (1 - (characterEntity.armor - (target.apierce ?? 0)) / 1000) *
        (target.frequency < 1 ? 1 : target.frequency)
      );
    default:
      return target.attack * target.frequency;
  }
}

function listOfMonsterAttacking(characterEntity) {
  return Object.values(parent.entities).filter(
    (entity) =>
      entity.type === "monster" && entity.target === characterEntity.name
  );
}

function mobbingMultiplier(numberOfMobs) {
  return numberOfMobs < 5 ? 1.7 : numberOfMobs < 6 ? 1.8 : 2;
}

function avgDmgTaken(characterEntity) {
  const numberOfAttackingMobs = listOfMonsterAttacking(characterEntity).length;
  return (
    Object.keys(parent.entities)
      .filter(
        (id) =>
          parent.entities[id]?.target === characterEntity.name &&
          parent.entities[id]?.type === "monster"
      )
      .reduce(
        (accummulator, currentId) =>
          accummulator +
          calculateDamage(parent.entities[currentId], characterEntity),
        0
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
        calculateDamage(parent.entities[id], partyTanker) < MAX_MOB_DPS
    )
    .sort(
      (lhs, rhs) =>
        distance(character, parent.entities[rhs]) -
        distance(character, parent.entities[lhs])
    );

  const result = [];

  if (!partyHealer) return result;

  let tankerDmgReceive = avgDmgTaken(partyHealer);
  let tankerNumberOfAggroedMobs = listOfMonsterAttacking(partyHealer).length;

  for (const mobId of mobsList) {
    if (tankerDmgReceive >= partyHealer.heal * partyHealer.frequency) break;

    if (
      is_in_range(parent.entities[mobId], "cburst") &&
      !parent.entities[mobId]?.target &&
      tankerDmgReceive +
        calculateDamage(parent.entities[mobId], partyTanker) *
          mobbingMultiplier(tankerNumberOfAggroedMobs + 1) <
        partyHealer.heal * partyHealer.frequency * 0.9
    ) {
      result.push([parent.entities[mobId], 2]);
      tankerNumberOfAggroedMobs += 1;
      tankerDmgReceive =
        (tankerDmgReceive * mobbingMultiplier(tankerNumberOfAggroedMobs + 1)) /
          mobbingMultiplier(tankerNumberOfAggroedMobs) +
        calculateDamage(parent.entities[mobId], partyTanker) *
          mobbingMultiplier(tankerNumberOfAggroedMobs + 1);
    }
  }
  return result;
}
