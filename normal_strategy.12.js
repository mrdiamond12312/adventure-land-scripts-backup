async function useNormalStrategy(target) {
  const partyHealer = get_entity(HEALER);
  const partyTanker = get_entity(TANKER);

  switch (character.ctype) {
    case "mage":
      const suggestedItems = calculateMageItems(target);

      if (character.slots.mainhand?.name !== suggestedItems.mainhand) {
        await equipBatch(suggestedItems);
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
          use_skill("energize", buffee);
        } else {
          use_skill("energize", get_entity(partyMems[0]));
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
      if (
        !get_entity(HEALER) &&
        Object.keys(parent.entities).filter(
          (id) => parent.entities[id].target === character.name
        ).length > 1 &&
        !is_on_cooldown("scare")
      ) {
        await equipBatch({
          orb: "jacko",
        });
        await use_skill("scare");
        await equipBatch({
          orb: "talkingskull",
        });
      }
      break;
  }
}
