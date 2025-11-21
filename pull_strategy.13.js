async function usePullStrategies(target) {
  const partyHealer = get_entity(HEALER) ?? get_entity(RANGER);
  const healerPower = partyHealer?.heal || partyHealer?.attack || 0;
  const healerFreq = partyHealer?.frequency || 1;
  const healReceivableAmount =
    healerPower * 0.925 * healerFreq +
    (parent.entities["$Caroline"]?.focus &&
    distance(parent.entities["$Caroline"], character) < 250
      ? 1200
      : 0);
  const partyTanker = get_entity(TANKER);
  const mobsList = Object.values(parent.entities).filter(
    (mob) => mob.type === "monster",
  );
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
        ms_to_next_skill("cburst") === 0 &&
        character.mp > 400 &&
        !get_targeted_monster()?.["1hp"] &&
        partyHealer &&
        partyHealer.ctype === "priest" &&
        distance(partyHealer, character) <
          (partyHealer.range ?? character.range * 0.7) &&
        partyHealer?.hp > 0.6 * partyHealer?.max_hp &&
        getMonstersToCBurst().length >= 1
      ) {
        promises.push(
          withTimeout(
            use_skill("cburst", getMonstersToCBurst()).then(() =>
              reduce_cooldown("cburst", -2000),
            ),
            2500,
          ),
        );
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

      const formidableMonsterAppeared = mobsList.find(
        (mob) =>
          mob.attack * mob.frequency > MAX_MOB_DPS ||
          MELEE_IGNORE_LIST.includes(mob.mtype),
      );

      const havePulledEnoughMobs =
        mobsList.filter((mob) => mob.target === character.name).length >=
        MAX_TARGET;

      const listOfNoTargetMonsterInRange = mobsList.filter(
        (mob) => is_in_range(mob, "agitate") && mob.target !== character.name,
      );

      const magicalMobsTargetingSelf = mobsList.filter(
        (mob) => mob.damage_type === "magical" && mob.target === character.name,
      );
      const physicalMobsTargetingSelf = mobsList.filter(
        (mob) =>
          mob.damage_type === "physical" && mob.target === character.name,
      );
      const pureMobsTargetingSelf = mobsList.filter(
        (mob) => mob.damage_type === "pure" && mob.target === character.name,
      );

      let magicalMobsAfterAgitating = magicalMobsTargetingSelf.length;
      let physicalMobsAfterAgitating = physicalMobsTargetingSelf.length;
      let pureMobsAfterAgitating = pureMobsTargetingSelf.length;

      for (const mob of listOfNoTargetMonsterInRange) {
        switch (mob.damage_type) {
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

      const partyDmgRecieved = avgPartyDmgTaken(partyMems);

      if (
        !havePulledEnoughMobs &&
        !formidableMonsterAppeared &&
        character.mp > G.skills["agitate"].mp &&
        !is_on_cooldown("agitate") &&
        // numberOfMonsterInRange <= MAX_TARGET + 2 &&
        !listOfNoTargetMonsterInRange.some(
          (mob) => mob.cooperative && !partyMems.includes(mob.target),
        ) &&
        listOfNoTargetMonsterInRange.length >= 2 &&
        !listOfNoTargetMonsterInRange.some(
          (mob) =>
            MELEE_IGNORE_LIST.includes(mob.mtype) ||
            WATCHOUT_ABILITIES.some((skill) =>
              Object.keys(mob.abilities ?? {}).includes(skill),
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
          healReceivableAmount - partyDmgRecieved &&
        !isFearedAfterAgitating
      ) {
        promises.push(withTimeout(use_skill("agitate"), 2500));
      }
      if (
        partyDmgRecieved < healReceivableAmount &&
        !havePulledEnoughMobs &&
        character.mp > G.skills["taunt"].mp &&
        !is_on_cooldown("taunt")
      ) {
        const mobToPull = mobsList.find(
          (mob) =>
            calculateDamage(mob, character) < 4000 &&
            is_in_range(mob, "taunt") &&
            !WATCHOUT_ABILITIES.some((skill) =>
              Object.keys(mob.abilities ?? {}).includes(skill),
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
          promises.push(
            withTimeout(
              use_skill("taunt", parent.entities[mobToPull]).then(() =>
                reduce_cooldown("taunt", character.ping * 0.95),
              ),
              2500,
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

    case "ranger":
      const suggestedRangerItems = calculateRangerItems(target);

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

      if (
        avgPartyDmgTaken(partyMems) > character.heal * 0.95 * healerFreq &&
        character.hp < (isAssignedAsTanker() ? 0.3 : 0.5) * character.max_hp &&
        !is_on_cooldown("scare") &&
        character.cc < 100
      ) {
        promises.push(scareAwayMobs());
      }
      break;
    default:
      break;
  }

  return Promise.all(promises);
}
