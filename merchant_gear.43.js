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
const MERCHANT_CARRIED_EXTRAS = ["orboftemporal", "warpvest"];

const WARP_CONFIG = {
  /** Same-map trips shorter than this walk: the vest regains about a charge an hour */
  MIN_SAME_MAP_DISTANCE: 600,
  /** Charges left on the vest for manual use */
  RESERVED_CHARGES: 3,
  /** Wait for the warp's landing before giving up on it */
  ARRIVAL_TIMEOUT_MS: 3000,
};

let isWarping = false;

/**
 * Carried warp vest with a charge to spare beyond the reserved ones.
 * @returns {number|undefined} its bag slot, -1 when it is the one worn, undefined when none qualifies
 */
function findSpareWarpVest() {
  const { charge } = G.items.warpvest;
  const hasSpareCharge = (item) =>
    item?.name === "warpvest" &&
    (item.charges ?? 0) >= charge * (WARP_CONFIG.RESERVED_CHARGES + 1);

  if (hasSpareCharge(getServerSlot("chest"))) return -1;
  const num = character.items.findIndex((_, i) =>
    hasSpareCharge(getServerItem(i)),
  );
  return num >= 0 ? num : undefined;
}

/**
 * Whether the server would take a warp there: never into or out of the bank,
 * never into an instance, and far enough to be worth a charge.
 * @param {Object} position - destination with `map`, `x`, `y`
 * @returns {boolean}
 */
function canWarpTo(position) {
  const fromMap = G.maps[character.map];
  const toMap = G.maps[position?.map];
  return (
    !!toMap &&
    !toMap.instance &&
    !toMap.ignore &&
    character.map !== "jail" &&
    !!fromMap?.mount === !!toMap.mount &&
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    (position.map !== character.map ||
      distance(character, position) >= WARP_CONFIG.MIN_SAME_MAP_DISTANCE)
  );
}

/** @returns {Promise<Object>} the warp's new_map, rejecting on timeout (a dampened warp never lands) */
function waitForWarpLanding() {
  return new Promise((resolve, reject) => {
    const handler = (data) => {
      if (data.effect !== "blink") return;
      cleanup();
      resolve(data);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("warp landing timeout"));
    }, WARP_CONFIG.ARRIVAL_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      parent.socket.off("new_map", handler);
    };
    parent.socket.on("new_map", handler);
  });
}

/**
 * Merchant-only: warps to the destination off a carried warp vest's spare
 * charge, swapping the vest in for the cast only.
 * @param {Object} position - destination with `map`, `x`, `y`
 * @returns {Promise<boolean>} whether he landed there
 */
async function useWarp(position) {
  if (
    character.ctype !== "merchant" ||
    isWarping ||
    typeof position !== "object" ||
    !canWarpTo(position) ||
    character.mp < G.skills.warp.mp ||
    is_on_cooldown("warp") ||
    character.c.town
  )
    return false;

  const vestNum = findSpareWarpVest();
  if (vestNum === undefined) return false;

  isWarping = true;
  try {
    const landing = waitForWarpLanding();
    landing.catch(() => undefined);

    const isSwapping = vestNum >= 0;
    const isWearingChest = !!getServerSlot("chest");
    if (isSwapping) sendEquips([{ num: vestNum, slot: "chest" }]);
    const cast = use_skill("warp", [position.x, position.y, position.map]);
    // The vest only has to be on when the server takes the charge
    if (isSwapping && isWearingChest)
      sendEquips([{ num: vestNum, slot: "chest" }]);

    await withTimeout(cast);
    await landing;
    return true;
  } catch (e) {
    console.warn("Warp failed:", e);
    return false;
  } finally {
    isWarping = false;
  }
}

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
