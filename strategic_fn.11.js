const MAX_TARGET = 5;
const BLAST_RADIUS = 17;
const TARGET_TO_SWITCH_TO_BLASTER_WEAPON = 3;
const MAX_MOB_DPS = 1000;

// Class Items logic
function calculateMageItems(target) {
  const shouldUseBlaster =
    Object.keys(parent.entities).filter(
      (entityId) =>
        parent.distance(target, parent.entities?.[entityId]) < BLAST_RADIUS &&
        partyMems.includes(parent.entities?.[entityId].target)
    ).length >= TARGET_TO_SWITCH_TO_BLASTER_WEAPON;

  return {
    mainhand:
      currentStrategy === usePullStrategies
        ? shouldUseBlaster
          ? "gstaff"
          : "firestaff"
        : "firestaff",
    offhand:
      currentStrategy === usePullStrategies
        ? shouldUseBlaster
          ? undefined
          : "wbook0"
        : "wbook0",
  };
}

function calculateWarriorItems() {
  if (["pinkgoo", "snowman"].includes(get_targeted_monster()?.mtype))
    return {
      mainhand: "rapier",
      offhand: undefined,
      orb: "talkingskull",
    };
  return {
    mainhand: "xmace",
    offhand:
      currentStrategy === usePullStrategies
        ? "glolipop"
        : character.s.sugarrush || get_targeted_monster()?.cooperative
        ? "fireblade"
        : "candycanesword",
    orb: "talkingskull",
  };
}

function calculateRangerItems() {
  return {
    mainhand: get_targeted_monster().armor > 120 ? "crossbow" : "merry",
  };
}

// Equiping Items
function findMaxLevelItem(id) {
  let maxSlot = -1;
  let maxLevel = 0;
  for (let iter = 0; iter < character.items.length; iter++) {
    const currentItem = character.items[iter];
    if (!(currentItem && currentItem.name === id)) continue;
    if (currentItem.level >= maxLevel) {
      maxSlot = iter;
      maxLevel = currentItem.level;
    }
  }

  return maxSlot;
}

async function equipBatch(suggestedItems) {
  if (character.cc > 100) return;

  Promise.all(
    Object.keys(suggestedItems).map(async (slot) => {
      if (character.slots[slot]?.name !== suggestedItems[slot])
        await unequip(slot);
    })
  );

  await equip_batch(
    Object.keys(suggestedItems)
      .filter((slot) => suggestedItems[slot] !== undefined)
      .map((slot) => ({
        slot,
        num: findMaxLevelItem(suggestedItems[slot]),
      }))
      .filter((equipInfo) => equipInfo.num >= 0)
  );
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

function avgDmgTaken(characterEntity) {
  return Object.keys(parent.entities)
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
        calculateDamage(parent.entities[id], partyTanker) < MAX_MOB_DPS
    )
    .sort(
      (lhs, rhs) =>
        distance(character, parent.entities[rhs]) -
        distance(character, parent.entities[lhs])
    );

  const result = [];

  let tankerDmgReceive = avgDmgTaken(partyTanker);
  for (const mobId of mobsList) {
    if (
      tankerDmgReceive >= partyHealer.heal * partyHealer.frequency ||
      Object.keys(parent.entities).filter(
        (id) => parent.entities[id]?.target === TANKER
      ).length +
        result.length >
        MAX_TARGET
    )
      break;

    if (
      is_in_range(parent.entities[mobId], "cburst") &&
      parent.entities[mobId].target === undefined
    )
      result.push([parent.entities[mobId], 2]);

    tankerDmgReceive += calculateDamage(parent.entities[mobId], partyTanker);
  }
  return result;
}
