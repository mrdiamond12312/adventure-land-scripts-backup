/** Attack below which a cooperative mob is pulled anyway */
const WEAK_COOP_MOB_ATTACK = 100;

async function usePullStrategies(target) {
  return Promise.all([equipClassGear(target), usePullSkills()]);
}

/**
 * The pull-only skills: the mage's cburst, the warrior's agitate and pull-taunt.
 * Never run on a trip: they would aggro the route.
 * @returns {Promise}
 */
async function usePullSkills() {
  const partyHealer = get_entity(HEALER) ?? get_entity(RANGER);
  const healerPower = partyHealer?.heal || partyHealer?.attack || 0;
  const healerFreq = (partyHealer && attackFrequency(partyHealer)) || 1;
  const healReceivableAmount =
    healerPower * healerFreq +
    (parent.entities["$Caroline"]?.focus &&
    distance(parent.entities["$Caroline"], character) < 250
      ? 1200
      : 0);
  const mobsList = Object.values(parent.entities).filter(
    (mob) =>
      mob.type === "monster" && !CAVE_SIDES_TO_LEAVE.includes(mob.cave?.side),
  );
  const promises = [];

  switch (character.ctype) {
    case "mage":
      // Spend spare mp to help the priest keep the party topped off, but only
      // when the healer is close, healthy and actually a priest. Only a batch
      // worth of sleeping mobs pays for the mp — the blaster keeps the mage
      // starved, so lone stragglers are left to the priest's zapper.
      const canAffordCBurst =
        ms_to_next_skill("cburst") === 0 &&
        character.mp > 400 &&
        !get_targeted_monster()?.["1hp"] &&
        partyHealer &&
        partyHealer.ctype === "priest" &&
        distance(partyHealer, character) <
          (partyHealer.range ?? character.range * 0.7) &&
        partyHealer.hp > 0.6 * partyHealer.max_hp;

      const mobsToCBurst = canAffordCBurst ? getMonstersToCBurst() : [];

      if (mobsToCBurst.length >= CBURST_MIN_BATCH) {
        promises.push(
          use_skill("cburst", mobsToCBurst).then(() =>
            reduce_cooldown("cburst", -6000),
          ),
        );
      }
      break;

    case "warrior":
      // Everything agitate would reach — what the pull is judged on
      const mobsInAgitateRange = mobsList.filter((mob) =>
        is_in_range(mob, "agitate"),
      );

      const formidableMonsterAppeared = mobsInAgitateRange.find(
        (mob) =>
          calculateDamage(mob, character) > MAX_MOB_DPS ||
          MELEE_IGNORE_LIST.includes(mob.mtype),
      );

      // Check if the character is already targeting enough mobs
      const havePulledEnoughMobs =
        mobsList.filter((mob) => mob.target === character.name).length >=
        MAX_TARGET;

      // Monsters that are in range of 'agitate' but *not* currently targeting the character
      const listOfNoTargetMonsterInRange = mobsInAgitateRange.filter(
        (mob) => mob.target !== character.name,
      );

      const mobsTargetingSelf = mobsList.filter(
        (mob) => mob.target === character.name,
      );

      // Calculate average party damage taken
      const partyDmgRecieved = avgPartyDmgTaken(partyMems);

      // Basic Requirements
      const canUseAgitate =
        isAssignedAsTanker() &&
        !havePulledEnoughMobs &&
        !formidableMonsterAppeared &&
        character.mp >= warriorAoeMpFloor() &&
        !is_on_cooldown("agitate");

      // Mob Quantity Requirement
      const sufficientNoTargetMobs =
        mobsLeftAfterCleave(listOfNoTargetMonsterInRange).length >= 2;

      // Mob Safety Check: No bad mobs in the list
      const safeToAgitateMobs = !listOfNoTargetMonsterInRange.some(
        (mob) =>
          MELEE_IGNORE_LIST.includes(mob.mtype) ||
          WATCHOUT_ABILITIES.some((skill) =>
            Object.keys(mob.abilities ?? {}).includes(skill),
          ),
      );

      // Mob Target Check: Agitate won't steal from others or cooperative mobs
      const myCharacters = getMyCharacters();
      const externalPartyMembers = parent.party_list.filter(
        (name) => !myCharacters.includes(name),
      );

      const mobsTargetingExternalParty = mobsList.some((mob) =>
        externalPartyMembers.includes(mob.target),
      );

      const wontStealOrBreakCoop =
        !listOfNoTargetMonsterInRange.some(
          (mob) =>
            mob.cooperative &&
            !mob["1hp"] &&
            mob.attack >= WEAK_COOP_MOB_ATTACK &&
            (!myCharacters.includes(mob.target) ||
              externalPartyMembers.includes(mob.target)),
        ) &&
        (!mobsTargetingExternalParty ||
          distance(character, { map: map, x: mapX, y: mapY }) > 300);

      // Nobody outside our account is tanking in range
      const nobodyElseTanking = !mobsInAgitateRange.some(
        (mob) => mob.target && !isOwnedCharacter(mob.target),
      );

      // Fear Check
      const willNotBeFeared = hasCourageFor(
        listOfNoTargetMonsterInRange,
        mobsTargetingSelf,
      );

      // Damage Check
      const currentAggroDamage = mobsInAgitateRange
        .filter((mob) => !partyMems.includes(mob.target))
        .reduce((prev, curr) => prev + calculateDamage(curr, character), 0);

      const damageIsAcceptable =
        currentAggroDamage < healReceivableAmount - partyDmgRecieved;

      if (
        canUseAgitate &&
        sufficientNoTargetMobs &&
        safeToAgitateMobs &&
        wontStealOrBreakCoop &&
        nobodyElseTanking &&
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
              !WATCHOUT_ABILITIES.some((skill) =>
                Object.keys(mob.abilities ?? {}).includes(skill),
              ) &&
              calculateDamage(mob, character) + partyDmgRecieved <
                healReceivableAmount &&
              is_in_range(mob, "taunt") &&
              !isBaitHeld(mob) &&
              (!mob.target ||
                partyMems
                  .filter((id) => id !== character.name)
                  .includes(mob.target)) &&
              hasCourageFor([mob], mobsTargetingSelf),
          );

        if (mobToPull)
          promises.push(use_skill("taunt", mobToPull));
      }

      break;

    default:
      break;
  }

  return Promise.all(promises);
}
