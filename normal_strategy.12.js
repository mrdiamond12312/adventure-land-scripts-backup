async function useNormalStrategy(target) {
  const promises = [];
  switch (character.ctype) {
    case "mage":
      promises.push(equipBatch(calculateMageItems(target)));
      break;

    case "warrior":
      promises.push(equipBatch(calculateWarriorItems()));
      break;

    case "ranger":
      promises.push(
        equipBatch(calculateRangerItems(target), {
          preventPenaltizeNextAttack: character.slots.mainhand?.name !== "cupid",
          preventKeySnatch: character.slots.mainhand?.name !== "cupid",
        }),
      );
      break;

    case "rogue":
      promises.push(equipBatch(calculateRogueItems(target)));
      break;

    case "priest":
      promises.push(equipBatch(calculatePriestItems(target)));
      break;
  }
  return Promise.all(promises);
}
