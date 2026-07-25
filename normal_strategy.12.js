async function useNormalStrategy(target) {
  const promises = [];
  switch (character.ctype) {
    // NOTE: mage skills (gear / scare) moved to per-skill loops in
    // basic_mage.4.js (startSkillLoops) so they no longer gate the attack loop.

    // NOTE: warrior warcry / hardshell / stomp / defensive-taunt / scare moved to
    // per-skill loops in basic_warrior.9.js (startSkillLoops). Gear stays here,
    // driven on a fixed cadence by that file's strategy loop calling currentStrategy.
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

    // NOTE: priest skills (gear / scare) moved to per-skill loops in
    // basic_priest.2.js (startSkillLoops) so they no longer gate the attack loop.
  }
  return Promise.all(promises);
}
