/**
 * Puts on the class's gear for the target, the same under either strategy.
 * Each class runs it on its own gear loop, trips included.
 * @param {Object|Object[]} [target] - the ranger passes its plan's gear targets
 * @returns {Promise|undefined}
 */
function equipClassGear(target) {
  switch (character.ctype) {
    case "mage":
      return equipBatch(calculateMageItems(target));
    case "warrior":
      return equipBatch(calculateWarriorItems());
    case "ranger":
      return equipRangerItems(target);
    case "rogue":
      return equipBatch(calculateRogueItemsCached(target));
    case "priest":
      return equipBatch(calculatePriestItems(target));
  }
}

async function useNormalStrategy(target) {
  return equipClassGear(target);
}
