async function usePullStrategies(target) {
  const partyHealer = get_entity(HEALER);
  const partyTanker = get_entity(TANKER);
  const mobsList = Object.keys(parent.entities).filter(
    (id) => parent.entities[id]?.type === "monster"
  );

  switch (character.ctype) {
    case "mage":
      const suggestedItems = calculateMageItems(target);

      if (character.slots.mainhand?.name !== suggestedItems.mainhand) {
        await equipBatch(suggestedItems);
      }

      if (!is_on_cooldown("energize") && character.mp > 1200) {
        use_skill("energize", get_entity(TANKER));
      }

      if (
        !is_on_cooldown("cburst") &&
        character.mp > 400 &&
        !get_targeted_monster().hp?.["1hp"]
      ) {
        if (getMonstersToCBurst().length >= 2)
          use_skill("cburst", getMonstersToCBurst());
      }

      break;

    case "warrior":
      const suggestedWarriorItems = calculateWarriorItems(target);

      if (character.slots.mainhand?.name !== suggestedWarriorItems.mainhand) {
        await equipBatch(suggestedWarriorItems);
      }

      const formidableMonsterAppeared = mobsList.find(
        (id) =>
          parent.entities[id]?.attack * parent.entities[id]?.frequency >
          MAX_MOB_DPS
      );

      const havePulledEnoughMobs =
        mobsList.filter((id) => parent.entities[id]?.target === character.name)
          .length >= MAX_TARGET;

      const numberOfMonsterInRange = mobsList.filter((id) =>
        is_in_range(parent.entities[id], "agitate")
      ).length;
      const numberOfNoTargetMonsterInRange = mobsList.filter(
        (id) =>
          is_in_range(parent.entities[id], "agitate") &&
          parent.entities[id] !== TANKER
      ).length;

      if (
        character.mp > G.skills["stomp"].mp &&
        !is_on_cooldown("stomp") &&
        locate_item("basher") !== -1 &&
        character.hp < character.max_hp * 0.7
      ) {
        await equipBatch({ mainhand: "basher", offhand: undefined });
        await use_skill("stomp");
        await equipBatch(suggestedWarriorItems);
      }

      if (
        !havePulledEnoughMobs &&
        !formidableMonsterAppeared &&
        character.mp > G.skills["agitate"].mp &&
        !is_on_cooldown("agitate") &&
        numberOfMonsterInRange <= MAX_TARGET + 2 &&
        numberOfNoTargetMonsterInRange >= 3 &&
        Object.keys(parent.entities)
          .filter((id) => parent.entities[id]?.type === "monster")
          .filter(
            (id) =>
              is_in_range(parent.entities[id], "agitate") ||
              parent.entities[id].target === TANKER
          )
          .reduce(
            (prev, curr) =>
              prev + calculateDamage(parent.entities[curr], character),
            0
          ) <
          partyHealer.heal * partyHealer.frequency * 0.4
      ) {
        use_skill("agitate");
      }

      if (
        avgDmgTaken(character) <
          partyHealer.heal * partyHealer.frequency * 0.4 &&
        !havePulledEnoughMobs &&
        character.mp > G.skills["taunt"].mp &&
        !is_on_cooldown("taunt")
      ) {
        const mobToPull = mobsList.find(
          (id) =>
            calculateDamage(parent.entities[id], character) < 1000 &&
            is_in_range(parent.entities[id], "taunt") &&
            (!parent.entities[id].target ||
              partyMems
                .filter((id) => id !== character.name)
                .includes(parent.entities[id].target))
        );

        if (mobToPull) use_skill("taunt", parent.entities[mobToPull]);
      }

      break;
    default:
      break;
  }
}
