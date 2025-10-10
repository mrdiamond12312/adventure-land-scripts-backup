async function useNormalStrategy(target) {
  const promises = [];
  switch (character.ctype) {
    case "mage":
      const suggestedMageItems = calculateMageItems(target);

      if (
        Object.keys(suggestedMageItems).some(
          (slot) => character.slots[slot]?.name !== suggestedMageItems[slot],
        )
      ) {
        promises.push(equipBatch(suggestedMageItems));
      }

      if (
        character.mp > 100 &&
        !is_on_cooldown("scare") &&
        target.max_hp > 3000 &&
        Object.values(parent.entities).some(
          (entity) =>
            entity.type === "monster" && entity.target === character.name,
        )
      )
        promises.push(scareAwayMobs());

      break;

    case "warrior":
      const suggestedWarriorItems = calculateWarriorItems(target);

      if (
        Object.keys(suggestedWarriorItems).some(
          (slot) => character.slots[slot]?.name !== suggestedWarriorItems[slot],
        )
      ) {
        promises.push(equipBatch(suggestedWarriorItems));
      }
      break;

    case "ranger":
      const suggestedRangerItems = calculateRangerItems();

      if (
        Object.keys(suggestedRangerItems).some(
          (slot) => character.slots[slot]?.name !== suggestedRangerItems[slot],
        )
      ) {
        promises.push(equipBatch(suggestedRangerItems));
      }
      break;

    case "priest":
      const suggestedPriestItems = calculatePriestItems(target);
      if (
        Object.keys(suggestedPriestItems).some(
          (slot) => character.slots[slot]?.name !== suggestedPriestItems[slot],
        )
      ) {
        promises.push(equipBatch(suggestedPriestItems));
      }

      if (!isAssignedAsTanker()) promises.push(scareAwayMobs());
      break;
  }
  return Promise.all(promises);
}
