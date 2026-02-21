async function usePullStrategies(target) {
  const partyHealer = get_entity(HEALER) ?? get_entity(RANGER);
  const healerPower = partyHealer?.heal || partyHealer?.attack || 0;
  const healerFreq = partyHealer?.frequency || 1;
  const healReceivableAmount =
    healerPower * healerFreq +
    (parent.entities["$Caroline"]?.focus &&
    distance(parent.entities["$Caroline"], character) < 250
      ? 1200
      : 0);
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
          use_skill("cburst", getMonstersToCBurst()).then(() =>
            reduce_cooldown("cburst", -2000),
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
          calculateDamage(mob, character) > MAX_MOB_DPS ||
          MELEE_IGNORE_LIST.includes(mob.mtype),
      );

      // Check if the character is already targeting enough mobs
      const havePulledEnoughMobs =
        mobsList.filter((mob) => mob.target === character.name).length >=
        MAX_TARGET;

      // Monsters that are in range of 'agitate' but *not* currently targeting the character
      const listOfNoTargetMonsterInRange = mobsList.filter(
        (mob) => is_in_range(mob, "agitate") && mob.target !== character.name,
      );

      // Count mobs targeting self
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

      // Initialize counters
      let magicalMobsAfterAgitating = magicalMobsTargetingSelf.length;
      let physicalMobsAfterAgitating = physicalMobsTargetingSelf.length;
      let pureMobsAfterAgitating = pureMobsTargetingSelf.length;

      // Add counts for mobs that *will* target self after 'agitate'
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

      // Check if the character would be feared after the new mobs are pulled (based on courage stats)
      const isFearedAfterAgitating =
        magicalMobsAfterAgitating > character.mcourage ||
        physicalMobsAfterAgitating > character.courage ||
        pureMobsAfterAgitating > character.pcourage;

      // Calculate average party damage taken
      const partyDmgRecieved = avgPartyDmgTaken(partyMems);

      // Basic Requirements
      const canUseAgitate =
        !havePulledEnoughMobs &&
        !formidableMonsterAppeared &&
        character.mp >= G.skills["agitate"].mp &&
        !is_on_cooldown("agitate");

      // Mob Quantity Requirement
      const sufficientNoTargetMobs = listOfNoTargetMonsterInRange.length >= 2;

      // Mob Safety Check: No bad mobs in the list
      const safeToAgitateMobs = !listOfNoTargetMonsterInRange.some(
        (mob) =>
          MELEE_IGNORE_LIST.includes(mob.mtype) ||
          WATCHOUT_ABILITIES.some((skill) =>
            Object.keys(mob.abilities ?? {}).includes(skill),
          ),
      );

      // Mob Target Check: Agitate won't steal from others or cooperative mobs
      const wontStealOrBreakCoop = !listOfNoTargetMonsterInRange.some(
        (mob) =>
          mob.cooperative &&
          !mob["1hp"] &&
          (!partyMems.includes(mob.target) ||
            parent.party_list
              .filter((id) => !partyMems.includes(id))
              .includes(mob.target)),
      );

      // Fear Check
      const willNotBeFeared = !isFearedAfterAgitating;

      // Damage Check
      const currentAggroDamage = Object.values(parent.entities)
        .filter(
          (entity) =>
            entity.type === "monster" &&
            is_in_range(entity, "agitate") &&
            !partyMems.includes(entity.target),
        )
        .reduce((prev, curr) => prev + calculateDamage(curr, character), 0);

      const damageIsAcceptable =
        currentAggroDamage < healReceivableAmount - partyDmgRecieved;

      if (
        canUseAgitate &&
        sufficientNoTargetMobs &&
        safeToAgitateMobs &&
        wontStealOrBreakCoop &&
        willNotBeFeared &&
        damageIsAcceptable
      ) {
        promises.push(use_skill("agitate"));
      }

      if (
        partyDmgRecieved < healReceivableAmount &&
        !havePulledEnoughMobs &&
        character.mp > G.skills["taunt"].mp &&
        !is_on_cooldown("taunt") &&
        isAssignedAsTanker()
      ) {
        const mobToPull = mobsList
          .sort(
            (lhs, rhs) =>
              rhs.attack * rhs.frequency - lhs.attack * lhs.frequency,
          )
          .find(
            (mob) =>
              calculateDamage(mob, character) + partyDmgRecieved <
                healReceivableAmount &&
              is_in_range(mob, "taunt") &&
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
            use_skill("taunt", mobToPull).then(() =>
              reduce_cooldown("taunt", character.ping * 0.95),
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
      const suggestedRangerItems = calculateRangerItems(
        target,
        character.slots.mainhand?.name === "cupid",
      );

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
        avgPartyDmgTaken(partyMems) > character.heal * 0.95 * character.frequency &&
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
