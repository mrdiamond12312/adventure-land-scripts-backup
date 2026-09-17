// Runs this character's own fighter script, so the rotation is the real one.
// Movement comes from manually_follow.51.js — mainLoop yields while smart.moving.

/** Entry script slot per class */
const FIGHTER_SLOTS = {
  warrior: 9,
  priest: 2,
  mage: 4,
  ranger: 32,
  rogue: 31,
};

const fighterSlot = FIGHTER_SLOTS[character.ctype];

// It pulls in slot 7 itself, and a second edge there would redeclare its consts
if (fighterSlot) load_code(fighterSlot);
else console.error("No fighter script for " + character.ctype);

/**
 * Hits what is already here, and never picks a destination of its own.
 * @returns {Promise<object>} the outcome, which always owns the tick
 */
async function useManualStrategy() {
  return engage(getTarget() ?? get_nearest_monster());
}

// Steered by hand, so the events, crypt, miniboss and farming chain stays off
fighterStrategies = [useManualStrategy];
