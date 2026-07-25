async function useNormalStrategy(target) {
  const promises = [];
  switch (character.ctype) {
    // NOTE: mage skills (gear / scare) moved to per-skill loops in
    // basic_mage.4.js (startSkillLoops) so they no longer gate the attack loop.

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
          equipBatch(
            suggestedRangerItems,
            character.slots.mainhand?.name === "cupid",
          ),
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

      if (
        avgPartyDmgTaken(partyMems) >
          character.heal * 0.95 * character.frequency &&
        character.hp < (isAssignedAsTanker() ? 0.2 : 0.5) * character.max_hp 
      ) {
        promises.push(scareAwayMobs());
      }

      if (!isAssignedAsTanker()) promises.push(scareAwayMobs());
      break;
  }
  return Promise.all(promises);
}
