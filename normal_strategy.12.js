async function useNormalStrategy(target) {
  const partyHealer = get_entity(HEALER);
  const partyTanker = get_entity(TANKER);

  switch (character.ctype) {
    case "mage":
      const suggestedMageItems = calculateMageItems(target);

      if (
        Object.keys(suggestedMageItems).some(
          (slot) => character.slots[slot]?.name !== suggestedMageItems[slot],
        )
      ) {
        await equipBatch(suggestedMageItems);
      }

      if (!is_on_cooldown("energize")) {
        const buffee = getLowestMana();
        if (
          buffee.max_mp - buffee.mp > 500 &&
          buffee.mp < buffee.max_mp * 0.5
        ) {
          log("Energize " + buffee?.name);
          use_skill("energize", buffee).then(() =>
            reduce_cooldown("energize", character.ping * 0.95),
          );
        } else {
          use_skill("energize", character).then(() =>
            reduce_cooldown("energize", character.ping * 0.95),
          );
        }
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
        scareAwayMobs();

      break;

    case "warrior":
      const suggestedWarriorItems = calculateWarriorItems(target);

      if (
        Object.keys(suggestedWarriorItems).some(
          (slot) => character.slots[slot]?.name !== suggestedWarriorItems[slot],
        )
      ) {
        await equipBatch(suggestedWarriorItems);
      }
      break;

    case "ranger":
      const suggestedRangerItems = calculateRangerItems();

      if (
        Object.keys(suggestedRangerItems).some(
          (slot) => character.slots[slot]?.name !== suggestedRangerItems[slot],
        )
      ) {
        await equipBatch(suggestedRangerItems);
      }
      break;

    case "priest":
      const suggestedPriestItems = calculatePriestItems();
      if (
        Object.keys(suggestedPriestItems).some(
          (slot) => character.slots[slot]?.name !== suggestedPriestItems[slot],
        )
      ) {
        await equipBatch(suggestedPriestItems);
      }

      await scareAwayMobs();
      break;
  }
}
