async function useNormalStrategy(target) {
  const partyHealer = get_entity(HEALER);
  const partyTanker = get_entity(TANKER);

  switch (character.ctype) {
    case "mage":
      const suggestedMageItems = calculateMageItems(target);

      if (character.slots.mainhand?.name !== suggestedMageItems.mainhand) {
        await equipBatch(suggestedMageItems);
      }

      if (
        !is_on_cooldown("burst") &&
        target.hp > 3000 &&
        target.resistance > 400 &&
        character.mp > 2000
      ) {
        log("Maxima Burst!");
        use_skill("burst");
      }

      if (!is_on_cooldown("energize") && character.mp > 1200) {
        const buffee = getLowestMana();
        if (
          buffee.max_mp - buffee.mp > 500 &&
          buffee.mp < buffee.max_mp * 0.8
        ) {
          log("Energize " + buffee?.name);
          use_skill("energize", buffee).then(() =>
            reduce_cooldown("energize", character.ping * 0.95)
          );
        } else {
          use_skill("energize", get_entity(partyMems[0])).then(() =>
            reduce_cooldown("energize", character.ping * 0.95)
          );
        }
      }

      if (
        character.mp > 100 &&
        !is_on_cooldown("scare") &&
        target.max_hp > 3000 &&
        Object.keys(parent.entities).some(
          (entity) => parent.entities[entity]?.target === character.name
        )
      )
        use_skill("scare");

      break;

    case "warrior":
      const suggestedWarriorItems = calculateWarriorItems(target);

      if (
        Object.keys(suggestedWarriorItems).some(
          (slot) => character.slots[slot]?.name !== suggestedWarriorItems[slot]
        )
      ) {
        await equipBatch(suggestedWarriorItems);
      }
      break;

    case "ranger":
      const suggestedRangerItems = calculateRangerItems();

      if (
        Object.keys(suggestedRangerItems).some(
          (slot) => character.slots[slot]?.name !== suggestedRangerItems[slot]
        )
      ) {
        await equipBatch(suggestedRangerItems);
      }
      break;
  }
}
