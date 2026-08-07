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
      const suggestedRangerItems = calculateRangerItems(target);

      if (
        Object.keys(suggestedRangerItems).some(
          (slot) => character.slots[slot]?.name !== suggestedRangerItems[slot],
        )
      ) {
        promises.push(
          equipBatch(suggestedRangerItems, {
            preventPenaltizeNextAttack:
              character.slots.mainhand?.name !== "cupid",
            preventKeySnatch: character.slots.mainhand?.name !== "cupid",
          }),
        );
      }
      break;

    case "rogue":
      const suggestedRogueItems = calculateRogueItems(target);
      if (
        Object.keys(suggestedRogueItems).some(
          (slot) => character.slots[slot]?.name !== suggestedRogueItems[slot],
        )
      ) {
        promises.push(equipBatch(suggestedRogueItems));
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
      break;
  }
  return Promise.all(promises);
}
