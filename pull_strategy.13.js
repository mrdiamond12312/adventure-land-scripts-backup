async function usePullStrategies(target) {
  const partyHealer = get_entity(HEALER);
  const partyTanker = get_entity(TANKER);
  const mobsList = Object.values(parent.entities).filter(
    (mob) => mob.type === "monster",
  );

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

      // if (!is_on_cooldown("energize")) {
      //   if (character.mp > 4000)
      //     use_skill("energize", get_entity(TANKER)).then(() =>
      //       reduce_cooldown("energize", character.ping * 0.95)
      //     );
      //   else {
      //     use_skill("energize", character).then(() =>
      //       reduce_cooldown("energize", character.ping * 0.95)
      //     );
      //   }
      // }

      if (
        ms_to_next_skill("cburst") === 0 &&
        character.mp > 400 &&
        !get_targeted_monster()?.["1hp"] &&
        partyHealer.ctype === "priest" &&
        distance(partyHealer, character) <
          (partyHealer.range ?? character.range * 0.7) &&
        partyHealer?.hp > 0.6 * partyHealer?.max_hp &&
        getMonstersToCBurst().length >= 1
      ) {
        use_skill("cburst", getMonstersToCBurst()).then(() =>
          reduce_cooldown("cburst", -2000),
        );
        reduce_cooldown("cburst", -2000);
      }

      if (
        character.mp > 100 &&
        !is_on_cooldown("scare") &&
        target.max_hp > 3000 &&
        character.hp < character.max_hp * 0.7 &&
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

      const formidableMonsterAppeared = mobsList.find(
        (mob) => mob.attack * mob?.frequency > MAX_MOB_DPS,
      );

      const havePulledEnoughMobs =
        mobsList.filter((mob) => mob?.target === character.name).length >=
        MAX_TARGET;

      const numberOfMonsterInRange = mobsList.filter((mob) =>
        is_in_range(mob, "agitate"),
      ).length;

      const listOfNoTargetMonsterInRange = mobsList.filter(
        (mob) => is_in_range(mob, "agitate") && mob.target !== TANKER,
      );

      const magicalMobsTargetingSelf = Object.values(parent.entities).filter(
        (mob) => mob.damage_type === "magical" && mob.target === character.name,
      );
      const physicalMobsTargetingSelf = Object.values(parent.entities).filter(
        (mob) =>
          mob.damage_type === "physical" && mob.target === character.name,
      );
      const pureMobsTargetingSelf = Object.values(parent.entities).filter(
        (mob) => mob.damage_type === "pure" && mob.target === character.name,
      );

      let magicalMobsAfterAgitating = magicalMobsTargetingSelf.length;
      let physicalMobsAfterAgitating = physicalMobsTargetingSelf.length;
      let pureMobsAfterAgitating = pureMobsTargetingSelf.length;

      for (const mob of listOfNoTargetMonsterInRange) {
        switch (parent.entities[mob]?.damage_type) {
          case "magical":
            magicalMobsAfterAgitating++;
            break;
          case "physical":
            physicalMobsAfterAgitating++;
            break;
          case "pure":
            pureMobsAfterAgitating++;
            break;
          default:
            break;
        }
      }

      const isFearedAfterAgitating =
        magicalMobsAfterAgitating > character.mcourage ||
        physicalMobsAfterAgitating > character.courage ||
        pureMobsAfterAgitating > character.pcourage;

      let partyDmgRecieved = avgPartyDmgTaken(partyMems);

      if (
        !havePulledEnoughMobs &&
        !formidableMonsterAppeared &&
        character.mp > G.skills["agitate"].mp &&
        !is_on_cooldown("agitate") &&
        // numberOfMonsterInRange <= MAX_TARGET + 2 &&
        listOfNoTargetMonsterInRange.length >= 2 &&
        !listOfNoTargetMonsterInRange.some(
          (mob) =>
            MELEE_IGNORE_LIST.includes(mob.mtype) ||
            WATCHOUT_ABILITIES.some((skill) =>
              Object.keys(mob.abilities).includes(skill),
            ),
        ) &&
        Object.values(parent.entities)
          .filter(
            (entity) =>
              entity.type === "monster" &&
              is_in_range(entity, "agitate") &&
              entity.target !== character,
          )
          .reduce((prev, curr) => prev + calculateDamage(curr, character), 0) <
          partyHealer.heal * partyHealer.frequency +
            (parent.entities["$Caroline"]?.focus &&
            distance(parent.entities["$Caroline"], character) < 250
              ? 1200
              : 0) -
            partyDmgRecieved &&
        !isFearedAfterAgitating
      ) {
        use_skill("agitate");
      }

      if (
        partyDmgRecieved <
          partyHealer.heal * partyHealer.frequency * 0.9 +
            (parent.entities["$Caroline"]?.focus &&
            distance(parent.entities["$Caroline"], character) < 250
              ? 1200
              : 0) &&
        !havePulledEnoughMobs &&
        character.mp > G.skills["taunt"].mp &&
        !is_on_cooldown("taunt")
      ) {
        const mobToPull = mobsList.find(
          (mob) =>
            calculateDamage(mob, character) < 4000 &&
            is_in_range(mob, "taunt") &&
            !WATCHOUT_ABILITIES.some((skill) =>
              Object.keys(mob.abilities).includes(skill),
            ) &&
            (!mob.target ||
              partyMems
                .filter((id) => id !== character.name)
                .includes(mob.target)) &&
            (mob.damage_type === "physical"
              ? physicalMobsTargetingSelf.length < character.courage
              : mob.damage_type === "magical"
              ? magicalMobsTargetingSelf.length < character.mcourage
              : pureMobsTargetingSelf.length < character.pcourage),
        );

        if (mobToPull)
          use_skill("taunt", parent.entities[mobToPull]).then(() =>
            reduce_cooldown("taunt", character.ping * 0.95),
          );
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
      const suggestedPriestItems = calculatePriestItems(target);
      if (
        Object.keys(suggestedPriestItems).some(
          (slot) => character.slots[slot]?.name !== suggestedPriestItems[slot],
        )
      ) {
        await equipBatch(suggestedPriestItems);
      }

      if (
        (avgPartyDmgTaken(partyMems) > character.heal * 0.95 * character.frequency &&
          character.hp <
            (character.name === TANKER ? 0.3 : 0.5) * character.max_hp) &&
        !is_on_cooldown("scare") &&
        character.cc < 100
      ) {
        scareAwayMobs();
      }
      break;
    default:
      break;
  }
}

game.on("hit", (data) => {});

character.on("mobbing", (data) => {});
