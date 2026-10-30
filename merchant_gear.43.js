// Merchant: the dartgun's reach, the best quiver, and gear

// What the merchant shoots with, whenever it shoots at all
const ATTACK_WEAPON = "dartgun";
// Only a fallback for the bank trip: everything else takes getBestQuiver
const ATTACK_OFFHAND = "t2quiver";
// How much of xrange the merchant lets itself aim with
const ATTACK_XRANGE_RATE = 0.8;
// Best reach seen so far — see getAttackWeaponReach
var maxAttackWeaponRange = 0;

/** @returns {Object[]} everything equipped or in the bag */
function getCarriedItems() {
  return [
    character.slots.mainhand,
    character.slots.offhand,
    ...character.items,
  ].filter(Boolean);
}

/**
 * Longest-ranged quiver we are carrying, dex breaking a tie.
 * @returns {{name: string, range: number, dex: number}|undefined}
 */
function getBestQuiver() {
  let best;

  for (const item of getCarriedItems()) {
    const info = item_info(item);
    if ((info?.wtype ?? info?.type) !== "quiver") continue;

    const range = info.range ?? 0;
    const dex = info.dex ?? 0;
    if (!range) continue;

    // getCarriedItems lists the equipped copy first, so range alone let it hold
    // every tie against a better twin forever
    if (!best || range > best.range || (range === best.range && dex > best.dex))
      best = { name: item.name, range, dex };
  }

  return best;
}

/**
 * Reach the dartgun would give us: the gun itself plus the best quiver's delta.
 */
function getMaxAttackWeaponRange() {
  const dartgunRange = getCarriedItems()
    .filter((item) => item.name === ATTACK_WEAPON)
    .reduce((best, item) => Math.max(best, item_info(item)?.range ?? 0), 0);

  if (!dartgunRange) return 0;

  return dartgunRange + (getBestQuiver()?.range ?? 0);
}

/**
 * How far the merchant can shoot *once geared*
 * @returns {number}
 */
function getAttackWeaponReach() {
  maxAttackWeaponRange =
    character.slots.mainhand?.name === ATTACK_WEAPON
      ? character.range
      : Math.max(maxAttackWeaponRange, getMaxAttackWeaponRange());

  if (!maxAttackWeaponRange) return 0;

  return maxAttackWeaponRange + character.xrange * ATTACK_XRANGE_RATE;
}

/** Luck outranks the quiver's range: whatever we're shooting is nearly dead anyway */
function getMerchantOffhand(isArmed, feelingLucky) {
  if (feelingLucky) return "mshield";
  if (!isArmed) return "wbookhs";
  return getBestQuiver()?.name ?? ATTACK_OFFHAND;
}

function getMerchantAmulet(feelingLucky, isBusy) {
  if (feelingLucky) return "spookyamulet";
  return isBusy ? "t2intamulet" : "warmscarf";
}

/**
 * The four questions the merchant gear table branches on.
 * @returns {{isArmed: boolean, feelingLucky: boolean, isBusy: boolean, isDraggingEnt: boolean}}
 */
function getMerchantGearState() {
  return {
    isArmed: shouldHoldAttackWeapon(),
    feelingLucky: shouldWearLuckGear(),
    isBusy: isLuring() || isOnDuty(DUTY.EVENT),
    isDraggingEnt: isOnDuty(DUTY.DRAG),
  };
}

/**
 * Merchant-only
 * @param {{isArmed: boolean, feelingLucky: boolean, isBusy: boolean, isDraggingEnt: boolean}} [state]
 *  defaults to what we are actually doing — pass a state to ask what some other
 *  situation would want
 */
function calculateMerchantEquipments(state = getMerchantGearState()) {
  const { isArmed, feelingLucky, isBusy, isDraggingEnt } = state;

  return {
    helmet: isBusy ? "xhelmet" : "partyhat",
    // Dartgun keeps us out of the boss' melee range while still landing hits
    mainhand: isArmed ? ATTACK_WEAPON : "broom",
    offhand: getMerchantOffhand(isArmed, feelingLucky),
    amulet: getMerchantAmulet(feelingLucky, isBusy),
    // scareAwayMobs re-equips jacko itself when something actually aggroes us
    orb: feelingLucky ? "rabbitsfoot" : "jacko",
    chest: "tshirt4",
    pants: "pants",
    ring1: "canopener",
    ring2: isDraggingEnt ? "armorring" : "canopener",
    shoes: "eslippers",
    gloves: "gloves1",
    belt: "sbelt",
    earring1: feelingLucky ? "cloverstud" : "dexearring",
    earring2: feelingLucky ? "cloverstud" : "dexearring",
  };
}

/**
 * Carried but never in the table above: a skill swaps these in on demand, so
 * the bag has to hold one even though no equipment state asks for it.
 * @type {string[]}
 */
const MERCHANT_CARRIED_EXTRAS = ["orboftemporal"];

/**
 * Every item calculateMerchantEquipments can ask for, with the most copies any
 * one state wears at once
 * @returns {Map<string, number>}
 */
function getMerchantGearCounts() {
  const counts = new Map(MERCHANT_CARRIED_EXTRAS.map((name) => [name, 1]));

  for (let state = 0; state < 16; state++) {
    const equipments = calculateMerchantEquipments({
      isArmed: !!(state & 1),
      feelingLucky: !!(state & 2),
      isBusy: !!(state & 4),
      isDraggingEnt: !!(state & 8),
    });

    const stateCounts = {};
    for (const name of Object.values(equipments))
      stateCounts[name] = (stateCounts[name] ?? 0) + 1;
    for (const [name, count] of Object.entries(stateCounts))
      counts.set(name, Math.max(counts.get(name) ?? 0, count));
  }

  return counts;
}
