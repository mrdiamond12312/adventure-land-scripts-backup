// Bank storage: floors, retrieval, the store/retrieve cycle and the data sync.

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Spawn positions for each accessible bank floor */
const BANK_FLOORS = {
  bank: { map: "bank", x: 0, y: -280 },
  bank_b: { map: "bank_b", x: -210, y: -130 },
};

/**
 * Slots to skip globally (gold, personal storage).
 * items23 is reserved for personal items and is never touched.
 */
const IGNORE_BANK_SLOTS = ["gold", "items23"];
const IGNORE_RARE_GOLD_THRESHOLD = 20e8;

/** How long a batch of bank calls may take */
const BANK_OP_TIMEOUT = 2_500;

// Bag space the gear trip leaves alone for scrolls, offerings and loot
const MERCHANT_GEAR_FREE_SLOTS = 4;

/** Item types the merchant uses from the bag, never stashed */
const BAG_SUPPLY_TYPES = ["pot", "stand", "computer", "tracker"];

/** Item types upgrading burns, stashed once the bag has nothing to upgrade */
const BAG_WORK_TYPES = ["uscroll", "cscroll", "offering"];

/** Highest level the sell sweep takes, per kind */
const SALE_MAX_LEVEL = { compound: 1, upgrade: 2 };

/** Highest level sold per item once the bank is full */
const PURGE_LEVELS = { frankypants: 2 };

/** Sets sold below PURGE_GEAR_LEVEL once the bank is full, like vendor gear */
const PURGE_SETS = ["rugged"];

/** Vendor gear and PURGE_SETS are sold below this level */
const PURGE_GEAR_LEVEL = 8;

/** Copies a line keeps past its keep threshold, tightened until a victim turns up */
const PURGE_HEADROOM_STEPS = [9, 3, 0];

/** Slots the purge frees while the bank is full */
const PURGE_FREE_SLOTS = 2;

/** Victims one purge pass sells, however jammed the bag is */
const PURGE_MAX_PER_PASS = 6;

/** Free shared slots at or below which the bank counts as full */
const BANK_FULL_SLACK = 0;

/** Free shared slots at or below which the purge starts trimming surplus */
const BANK_TIGHT_SLACK = 8;

/** Rounds one stacking pass may run */
const STACK_MAX_ROUNDS = 5;

const BANK_LOOP_DELAY = 185_000;
const BANK_MIN_DELAY = 15_000;
const BANK_IDLE_POLL_MS = 5_000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

var bankCache = undefined;

// Set once bankLoop's first run has walked every floor.
var hasVisitedBank = false;

/** Whether no shared pack has an empty slot */
var isBankFull = false;

/** Whether the shared packs are down to BANK_TIGHT_SLACK, the purge's trigger */
var isBankTight = false;

// ---------------------------------------------------------------------------
// Cache & Floors
// ---------------------------------------------------------------------------

/** @returns {boolean} whether we stand on any bank map, bank_u included */
function isInBank() {
  return character.map.startsWith("bank");
}

/** Merges character.bank into bankCache */
async function updateBank() {
  if (character.bank) bankCache = { ...bankCache, ...character.bank };
}

/**
 * Returns which floor a given bank pack lives on, or undefined if unknown.
 * @param {string} pack - e.g. "items0"
 * @returns {string | undefined}
 */
function getFloorOfPack(pack) {
  return bank_packs[pack]?.[0];
}

/**
 * Navigates to the given bank floor if not already there.
 * Aborts if already smart-moving.
 * @param {string} floor - map id of the target floor
 * @returns {Promise<boolean>} false if aborted
 */
async function goToBankFloor(floor, forced = false) {
  if (character.map === floor) {
    updateBank();
    return true;
  }

  if ((smart.moving || isAdvanceSmartMoving) && !forced) {
    console.warn(`Prevent moving to ${floor} while smartMoving. Aborting.`);
    return false;
  }

  const position = BANK_FLOORS[floor];
  if (!position) {
    console.warn(`No floor entry for ${floor}`);
    return false;
  }

  await advanceSmartMove(position);
  updateBank();
  return true;
}

/**
 * Visits every cached bank slot, empty ones included.
 * @param {(item: object | null, pack: string, slot: number, floor: string) => void} visit
 * @param {{ floor?: string, includePersonal?: boolean }} [options] - floor
 *   limits the walk to one floor, includePersonal also walks IGNORE_BANK_SLOTS
 */
function forEachBankSlot(visit, { floor, includePersonal = false } = {}) {
  for (const pack in bankCache ?? {}) {
    if (!Array.isArray(bankCache[pack])) continue;
    if (!includePersonal && IGNORE_BANK_SLOTS.includes(pack)) continue;

    const packFloor = getFloorOfPack(pack);
    if (floor && packFloor !== floor) continue;

    bankCache[pack].forEach((item, slot) => visit(item, pack, slot, packFloor));
  }
}

/**
 * @param {Array<{ floor: string }>} entries
 * @returns {Object<string, Array>} entries grouped by floor
 */
function groupByFloor(entries) {
  const byFloor = {};
  for (const entry of entries)
    (byFloor[entry.floor] = byFloor[entry.floor] ?? []).push(entry);
  return byFloor;
}

// ---------------------------------------------------------------------------
// Bank Queries
// ---------------------------------------------------------------------------

/**
 * Finds the NPC merchant that sells the given item.
 * @param {string} itemName
 * @returns {string | undefined} NPC id
 */
function findVendorMerchantOf(itemName) {
  for (const id in G.npcs) {
    const npcData = G.npcs[id];
    if (npcData.role === "merchant" && npcData.items?.includes(itemName))
      return id;
  }
}

/**
 * Returns all bank slots containing the given item across all floors,
 * sorted by level ascending.
 * Filters out rare-grade items if gold is below threshold.
 * @param {string} itemId
 * @param {boolean} [forced=false] - also search the personal-storage packs
 * @param {boolean} [includeRare=false] - keep rare grades even when gold is low
 * @returns {Array<{ name: string, level: number, slot: number, pack: string, floor: string }>}
 */
function getItemBankSlots(itemId, forced = false, includeRare = false) {
  const result = [];
  forEachBankSlot(
    (item, pack, slot, floor) => {
      if (item?.name === itemId) result.push({ ...item, slot, pack, floor });
    },
    { includePersonal: forced },
  );

  if (!includeRare && character.gold < IGNORE_RARE_GOLD_THRESHOLD)
    return result
      .filter((item) => item_grade(item) < 2)
      .sort((lhs, rhs) => lhs.level - rhs.level);

  return result.sort((lhs, rhs) => lhs.level - rhs.level);
}

/** @returns {Set<string>} names of the items on the current floor */
function getItemNamesOnCurrentFloor() {
  const names = new Set();
  forEachBankSlot(
    (item) => {
      if (item?.name) names.add(item.name);
    },
    { floor: character.map, includePersonal: true },
  );
  return names;
}

// ---------------------------------------------------------------------------
// Bag Helpers
// ---------------------------------------------------------------------------

/** @returns {number[]} empty bag slots */
function getEmptyBagSlots() {
  return character.items
    .map((item, index) => (item ? -1 : index))
    .filter((index) => index !== -1);
}

/** @returns {number[]} bag slots holding an item */
function getBagSlotsOf(itemName) {
  return character.items
    .map((item, index) => (item?.name === itemName ? index : -1))
    .filter((index) => index !== -1);
}

// ---------------------------------------------------------------------------
// Retrieve & Store
// ---------------------------------------------------------------------------

/**
 * Retrieves bank slots floor by floor, each floor's all at once.
 * @param {Array<{ pack: string, slot: number, floor: string, index?: number }>} slots
 *   index picks the bag slot it lands in
 * @param {boolean} [forced=false] - walk even while smart moving
 * @returns {Promise<void>}
 */
async function retrieveAll(slots, forced = false) {
  for (const [floor, onFloor] of Object.entries(groupByFloor(slots))) {
    if (!(await goToBankFloor(floor, forced))) continue;

    await withTimeout(
      Promise.allSettled(
        onFloor.map(({ pack, slot, index }) =>
          bank_retrieve(pack, slot, index).catch((e) =>
            console.warn(`Failed retrieving ${pack}[${slot}]`, e),
          ),
        ),
      ),
      BANK_OP_TIMEOUT,
    );
    updateBank();
  }
}

/**
 * Stores bag slots on the current floor all at once.
 * @param {Array<[number, string?, number?]>} entries - [index, pack, slot];
 *   without pack the game picks the spot
 * @returns {Promise<void>}
 */
function storeAll(entries) {
  return withTimeout(
    Promise.allSettled(
      entries.map(([index, pack, slot]) =>
        bank_store(index, pack, slot).catch((e) =>
          console.warn(`Failed storing index ${index} on ${character.map}`, e),
        ),
      ),
    ),
    BANK_OP_TIMEOUT,
  ).then(updateBank);
}

/**
 * Retrieves an item from the bank by name and optional level.
 * Navigates to the floor the item lives on, which a caller on the 750ms tick
 * must opt out of with travel:false — it relocates the character.
 * @param {string} searchId
 * @param {number} [level=0] - if 0, matches any level
 * @param {{ travel?: boolean }} [options] - travel:false gives up unless the
 *   merchant already stands on the item's floor
 * @returns {Promise<void>}
 */
async function retrieveBankItem(searchId, level = 0, { travel = true } = {}) {
  let target;
  forEachBankSlot(
    (item, pack, slot, floor) => {
      if (target || item?.name !== searchId) return;
      if (!level || level === item.level) target = { pack, slot, floor };
    },
    { includePersonal: true },
  );

  if (!target) return;
  if (!travel && character.map !== target.floor) return;
  if (!(await goToBankFloor(target.floor))) return;

  return bank_retrieve(target.pack, target.slot).then(updateBank);
}

/**
 * Stores an inventory item into the bank.
 * Tries the current floor first, then falls back to other accessible floors.
 * @param {number} inventoryIndex
 * @returns {Promise<void>}
 */
async function storeToBankFloor(inventoryIndex) {
  // Try storing on the current floor first if we're already in a bank
  if (BANK_FLOORS[character.map]) {
    try {
      await bank_store(inventoryIndex);
      return;
    } catch (e) {
      console.warn(
        `bank_store failed on ${character.map}, trying other floors...`,
      );
    }
  }

  // Try each accessible floor
  for (const floor of Object.keys(BANK_FLOORS)) {
    if (!(await goToBankFloor(floor))) continue;
    try {
      await bank_store(inventoryIndex);
      return;
    } catch (e) {
      console.warn(`bank_store failed on ${floor}, trying next floor...`);
    }
  }

  console.warn(`Could not store item at index ${inventoryIndex} on any floor.`);
}

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

/** @returns {number} an item's stack size, 0 if it doesn't stack */
function getMaxStack(itemName) {
  const maxStack = G.items[itemName]?.s;
  return maxStack === true ? 9999 : maxStack || 0;
}

/** @returns {boolean} whether this stack can take more of its item */
function isStackMergeable(item) {
  const hasTitle = item.p && !G.titles?.[item.p]?.stackable;
  return (
    !item.l && !hasTitle && !item.b && !item.v && !item.data && !item.m
  );
}

/**
 * Free slots and stack room on a bank floor.
 * @param {string} floor
 * @returns {{ empty: number, stackRoom: Object<string, number[]> }}
 */
function getFloorCapacity(floor) {
  const capacity = { empty: 0, stackRoom: {} };

  forEachBankSlot(
    (item) => {
      if (!item) {
        capacity.empty++;
        return;
      }

      const maxStack = getMaxStack(item.name);
      if (!maxStack || !isStackMergeable(item)) return;

      const room = maxStack - (item.q ?? 1);
      if (room > 0)
        (capacity.stackRoom[item.name] =
          capacity.stackRoom[item.name] ?? []).push(room);
    },
    { floor, includePersonal: true },
  );

  return capacity;
}

/**
 * Empty slots across the packs a store or purge pass may actually use,
 * personal storage excluded.
 * @returns {number}
 */
function countSharedEmptySlots() {
  let empty = 0;
  forEachBankSlot((item) => {
    if (!item) empty++;
  });
  return empty;
}

/**
 * Splits inventory indices by whether they fit, using up the capacity.
 * @param {number[]} indices
 * @param {{ empty: number, stackRoom: Object<string, number[]> }} capacity
 * @returns {{ storable: number[], skipped: number[] }}
 */
function pickStorableIndices(indices, capacity) {
  const storable = [];
  const skipped = [];

  for (const index of indices) {
    const item = character.items[index];
    const quantity = item.q ?? 1;
    // A marked stack merges with nothing, so it only ever takes an empty slot
    const rooms = isStackMergeable(item)
      ? capacity.stackRoom[item.name] ?? []
      : [];
    const stack = rooms.findIndex((room) => room >= quantity);

    if (stack !== -1) {
      rooms[stack] -= quantity;
      storable.push(index);
    } else if (capacity.empty > 0) {
      capacity.empty--;
      const maxStack = getMaxStack(item.name);
      if (maxStack > quantity && isStackMergeable(item))
        (capacity.stackRoom[item.name] =
          capacity.stackRoom[item.name] ?? []).push(maxStack - quantity);
      storable.push(index);
    } else {
      skipped.push(index);
    }
  }

  return { storable, skipped };
}

// ---------------------------------------------------------------------------
// Merchant Gear
// ---------------------------------------------------------------------------

/**
 * Pulls one copy of every item calculateMerchantEquipments can ask for out of
 * the bank: locked first, then highest level. Only the swap that matches our
 * current state ever gets equipped, but the pieces for the others have to be in
 * the bag already — a swap mid-lure or mid-boss can't wait for a bank trip.
 * @returns {Promise<void>}
 */
async function retrieveMerchantGear() {
  if (character.ctype !== "merchant" || !bankCache) return;

  const carried = new Set(
    [
      ...Object.entries(character.slots)
        .filter(([slot]) => !slot.startsWith("trade"))
        .map(([, item]) => item),
      ...character.items,
    ]
      .filter(Boolean)
      .map((item) => item.name),
  );

  const targets = [];
  for (const name of getMerchantGearNames()) {
    if (carried.has(name)) continue;

    // A locked copy is the one set aside for us on purpose; level only breaks ties
    const best = getItemBankSlots(name, true, true)
      .sort(
        (lhs, rhs) =>
          (lhs.l ? 1 : 0) - (rhs.l ? 1 : 0) ||
          (lhs.level ?? 0) - (rhs.level ?? 0),
      )
      .pop();

    if (best?.floor) targets.push(best);
  }

  // Retrieved by pack/slot, not by name+level: a same-level unlocked twin would
  // otherwise be what the search hands back
  return retrieveAll(
    targets.slice(0, Math.max(0, character.esize - MERCHANT_GEAR_FREE_SLOTS)),
  );
}

/** @returns {Object<string, number>} best level worn, per item name */
function getEquippedLevels() {
  const levels = {};

  for (const slot in character.slots) {
    const item = character.slots[slot];
    if (!item) continue;

    const level = item.level ?? 0;
    if (level > (levels[item.name] ?? -1)) levels[item.name] = level;
  }

  return levels;
}

/**
 * Inventory indices holding the copy of each merchant-gear item we keep — the
 * highest level one, and only when nothing worn already beats it. Spares stay
 * bankable, so the upgrade rotation still gets them and only what a swap would
 * reach for is pinned to the bag.
 * @returns {Set<number>}
 */
function getMerchantGearKeepIndices() {
  if (character.ctype !== "merchant") return new Set();

  const gear = getMerchantGearNames();
  const worn = getEquippedLevels();
  const keepers = {};

  character.items.forEach((item, index) => {
    if (!item || !gear.has(item.name)) return;
    const level = item.level ?? 0;
    // A copy already worn at this level or better needs no spare in the bag
    if (level <= (worn[item.name] ?? -1)) return;
    if (level <= (keepers[item.name]?.level ?? -1)) return;
    keepers[item.name] = { level, index };
  });

  return new Set(Object.values(keepers).map((keeper) => keeper.index));
}

// ---------------------------------------------------------------------------
// Store Routine
// ---------------------------------------------------------------------------

/**
 * Stores every index that fits on the current floor.
 * @param {number[]} indices
 * @returns {Promise<void>}
 */
function storeIndicesOnCurrentFloor(indices) {
  const { storable, skipped } = pickStorableIndices(
    indices,
    getFloorCapacity(character.map),
  );

  if (skipped.length)
    console.log(
      `bank full: ${skipped.length} items stay in bag on ${character.map}`,
    );

  return storeAll(storable.map((index) => [index]));
}

/**
 * Bag indices of the picked items that still hold them.
 * @param {Array<{ item: object, index: number }>} picked
 * @returns {number[]}
 */
function getStoreIndices(picked) {
  return picked
    .filter(({ item, index }) => {
      const current = character.items[index];
      return current?.name === item.name && !current.l;
    })
    .map(({ index }) => index);
}

/** @returns {boolean} whether the merchant uses this item from the bag */
function isBagSupply(item) {
  const type = G.items[item.name]?.type;
  return (
    BAG_SUPPLY_TYPES.includes(type) ||
    BAG_WORK_TYPES.includes(type) ||
    isCraftIngredient(item.name) ||
    isExchangeQueued(item.name)
  );
}

/**
 * Whether an item is something upgradeInv/compoundInv may still work on.
 * @param {Set<number>} skip - bag indices already leaving the bag
 */
function isUpgradeWork(item, index, skip) {
  if (!item || item.l || skip.has(index) || IGNORE.includes(item.name))
    return false;
  const info = G.items[item.name];
  return !!(info?.upgrade || info?.compound);
}

/**
 * Stores qualifying bag items floor by floor, next to their kind first.
 * Holds off sortInv throughout, so the picked indices keep their items.
 * @param {Boolean} forced to force storing weapons without checking its level
 */
async function bankStoreRoutine(forced = false) {
  await waitUntil(() => !isInventorySorting(), 5_000);
  if (!lockInventory("mutate")) return;

  try {
    return await runBankStoreRoutine(forced);
  } finally {
    unlockInventory("mutate");
  }
}

/** bankStoreRoutine's body, run while it holds the sort hold-off */
async function runBankStoreRoutine(forced) {
  const lastRetrieved = settleLastRetrieve();

  // Indices stay valid for the whole routine: storing leaves a hole behind
  const keepIndices = getMerchantGearKeepIndices();

  // Determine which items to store
  const toStore = character.items
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => {
      if (!item) return false;
      if (item.l) return false; // skip locked items
      if (keepIndices.has(index)) return false;
      if (shouldSellItem(item)) return false;

      const info = item_info(item);

      // A compound wants three at that level, an upgrade wants nothing but the
      // item. Anything else is stranded here and belongs back in the pile.
      const isFodder = info.compound
        ? countBagKeyAtLevel(getItemKey(item), item.level ?? 0) >= 3
        : !!info.upgrade;

      // A climb only holds its ingredient back while the climb can still happen
      const targetLevel = getCraftTargetLevel(item.name);
      if (targetLevel > 0 && (item.level ?? 0) < targetLevel && isFodder)
        return false;

      const itemKey = getItemKey(item);
      const isEquipable = info.compound || info.upgrade;

      // A supply would only be pulled straight back out, STORE_ABLE or not
      if (!isEquipable && isBagSupply(item)) return false;

      const isRare = item_grade(item) >= 2;
      const isHighLevel =
        item.level >= (itemsHighestLevel[itemKey]?.level ?? 1) - 1;
      const isStoreable = STORE_ABLE.includes(item.name);
      const shouldIgnore = IGNORE.includes(item.name);

      return (
        (!shouldIgnore &&
          (isRare || (isEquipable && (forced || isHighLevel || !isFodder)))) ||
        (!isEquipable && !isBagSupply(item)) ||
        isStoreable ||
        lastRetrieved.has(itemKey)
      );
    });

  // Scrolls and offerings follow once nothing left in the bag would burn them
  const leaving = new Set(toStore.map(({ index }) => index));
  const hasUpgradeWork = character.items.some(
    (item, index) =>
      !keepIndices.has(index) && isUpgradeWork(item, index, leaving),
  );
  if (!hasUpgradeWork)
    character.items.forEach((item, index) => {
      if (item && !item.l && BAG_WORK_TYPES.includes(G.items[item.name]?.type))
        toStore.push({ item, index });
    });

  const floors = Object.keys(BANK_FLOORS);

  if (hasVisitedBank) {
    const free = countSharedEmptySlots();
    isBankFull = free <= BANK_FULL_SLACK;

    // Only the tail may clear the latch: a pull of its own empties slots the
    // bag is about to hand straight back, so free alone flaps every cycle
    if (free <= BANK_TIGHT_SLACK && !isBankTight) {
      isBankTight = true;
      console.log(`bank tight: ${free} shared slots left, purge is on`);
    }

    const toStoreIndices = toStore.map(({ index }) => index);
    const fitsSomewhere = floors.some(
      (floor) =>
        pickStorableIndices(toStoreIndices, getFloorCapacity(floor)).storable
          .length,
    );

    if (!fitsSomewhere) return;
  }

  // Forward pass: each floor takes what it already holds a copy of
  for (const floor of floors) {
    await goToBankFloor(floor, true);
    const floorItems = getItemNamesOnCurrentFloor();
    await storeIndicesOnCurrentFloor(
      getStoreIndices(toStore).filter((index) =>
        floorItems.has(character.items[index].name),
      ),
    );
  }

  // Backward pass (leftovers get another chance)
  for (const floor of [...floors].reverse()) {
    await goToBankFloor(floor, true);
    await storeIndicesOnCurrentFloor(getStoreIndices(toStore));
  }

  const free = countSharedEmptySlots();
  const stranded = getStoreIndices(toStore).length;

  isBankFull = free <= BANK_FULL_SLACK;
  // Cleared only after a real store attempt that left nothing behind
  const wasBankTight = isBankTight;
  isBankTight = free <= BANK_TIGHT_SLACK || stranded > 0;
  if (wasBankTight && !isBankTight)
    console.log(`bank has room again: ${free} shared slots, purge is off`);
}

// ---------------------------------------------------------------------------
// Purge
// ---------------------------------------------------------------------------

/** @returns {boolean} whether the sell sweep takes this item */
function isSaleableItem(item) {
  if (!item || item.l || item.p) return false;
  if (!SALE_ABLE.includes(item.name) || isCraftIngredient(item.name))
    return false;

  const maxLevel = G.items[item.name]?.compound
    ? SALE_MAX_LEVEL.compound
    : SALE_MAX_LEVEL.upgrade;
  return (item.level ?? 0) <= maxLevel;
}

/** @returns {boolean} whether a purge pass may consider this item at all */
function isPurgeCandidate(item) {
  if (!item || item.l || item.p || item.ach) return false;
  if (IGNORE.includes(item.name) || item_grade(item) >= 2) return false;

  const def = G.items[item.name];
  if (!def?.upgrade && !def?.compound) return false;
  return !isCraftIngredient(item.name) && !getMerchantGearNames().has(item.name);
}

/** @returns {boolean} whether this item is surplus to sell once the bank is full */
function isPurgeable(item) {
  if (!isPurgeCandidate(item)) return false;

  const level = item.level ?? 0;
  if (PURGE_LEVELS[item.name] !== undefined)
    return level <= PURGE_LEVELS[item.name];

  const def = G.items[item.name];
  const isPurgeGear =
    PURGE_SETS.includes(def.set) || !!findVendorMerchantOf(item.name);
  return isPurgeGear && level < PURGE_GEAR_LEVEL;
}

/** @returns {Object<string, { total: number, top: number, byLevel: object }>} */
function tallyPurgeLines() {
  const lines = {};

  const visit = (item) => {
    if (!isPurgeCandidate(item)) return;

    const key = getItemKey(item);
    const level = item.level ?? 0;
    const line = (lines[key] ??= { total: 0, top: 0, byLevel: {} });

    line.total++;
    line.top = Math.max(line.top, level);
    line.byLevel[level] = (line.byLevel[level] ?? 0) + 1;
  };

  character.items.forEach(visit);
  forEachBankSlot(visit);
  return lines;
}

/**
 * One copy worth selling: bag before bank since it needs no retrieve, then
 * compoundable lines, then a tier that keeps a set of 3 without it, then a tier
 * too small to ever compound.
 * @param {object} lines - tallyPurgeLines(), decremented as victims are taken
 * @param {Set<string>} taken - ids of victims already picked
 * @param {number} headroom - copies a line keeps past its keep threshold
 * @param {{ bagOnly?: boolean }} [options] - bagOnly skips the bank walk
 * @returns {object | undefined}
 */
function pickPurgeVictim(lines, taken, headroom, { bagOnly = false } = {}) {
  let best;
  let bestRank = Infinity;

  const consider = (item, id, where) => {
    if (!isPurgeCandidate(item) || taken.has(id)) return;

    const key = getItemKey(item);
    const line = lines[key];
    const level = item.level ?? 0;

    if (line.total <= getKeepThreshold(key) + headroom) return;
    if (level >= line.top) return;

    // A tier of exactly 3 is one compound away; taking from it breaks the set
    const tier = line.byLevel[level] ?? 0;
    if (tier === 3) return;

    const rank =
      (where.index === undefined ? 1_000_000 : 0) +
      (item_info(item).compound ? 0 : 10_000) +
      (tier >= 4 ? 0 : 100) +
      level;
    if (rank >= bestRank) return;

    best = { ...where, id, item, key, level };
    bestRank = rank;
  };

  character.items.forEach((item, index) =>
    consider(item, `bag:${index}`, { index }),
  );
  if (!bagOnly)
    forEachBankSlot((item, pack, slot, floor) =>
      consider(item, `${pack}:${slot}`, { pack, slot, floor }),
    );

  return best;
}

/**
 * @param {number} limit
 * @returns {Array<object>} up to limit copies to sell
 */
function findPurgeVictims(limit) {
  const lines = tallyPurgeLines();
  const taken = new Set();
  const victims = [];

  for (const headroom of PURGE_HEADROOM_STEPS) {
    while (victims.length < limit) {
      const pick = pickPurgeVictim(lines, taken, headroom);
      if (!pick) break;

      taken.add(pick.id);
      lines[pick.key].total--;
      lines[pick.key].byLevel[pick.level]--;
      victims.push(pick);
    }

    if (victims.length) break;
  }

  // A bank victim needs a bag slot to land in, so a full bag has to sell one of
  // its own copies first or every pick below is skipped
  if (
    victims.length &&
    isInvFull(0) &&
    !victims.some((victim) => victim.index !== undefined)
  ) {
    const opener = pickPurgeVictim(lines, taken, 0, { bagOnly: true });
    if (opener) victims.unshift(opener);
  }

  return victims;
}

/** @returns {boolean} whether this item should be sold now */
function shouldSellItem(item) {
  return isSaleableItem(item) || (isBankFull && isPurgeable(item));
}

/**
 * Sells every bag item the predicate picks. The 750ms tick leaves it at
 * isSaleableItem, so only purgeBank's own pass may reach purgeable surplus.
 * @param {(item: object) => boolean} [predicate=isSaleableItem]
 */
function sellMarkedItems(predicate = isSaleableItem) {
  const sales = [];
  character.items.forEach((item, index) => {
    if (predicate(item))
      sales.push(
        sell(index, item.q ?? 1).catch((e) =>
          console.warn(`Failed selling ${item.name}`, e),
        ),
      );
  });

  return withTimeout(Promise.allSettled(sales), BANK_OP_TIMEOUT);
}

/**
 * Pulls stray saleables, and purgeable surplus once the bank is full, then sells them.
 * @returns {Promise<number>} bank slots the surplus sale freed
 */
async function purgeBank() {
  const slots = [];
  forEachBankSlot((item, pack, slot, floor) => {
    if (shouldSellItem(item)) slots.push({ pack, slot, floor });
  });
  slots.sort((lhs, rhs) => lhs.floor.localeCompare(rhs.floor));

  while (slots.length) {
    const batch = slots.splice(0, Math.max(0, character.esize - 1));
    if (!batch.length) break;

    await retrieveAll(batch);
    await sellMarkedItems(shouldSellItem);
  }

  return isBankTight ? await freeSlotsForUpgrading() : 0;
}

/**
 * Slots to free this pass: the steady valve, or enough to unjam a bag too full
 * for retrievedBankItemToUpgrade to pull a thing, capped so one pass cannot
 * hold DUTY.ERRAND through dozens of retrieve-sell round trips.
 * @returns {number}
 */
function getPurgeSlotTarget() {
  const working = RETRIEVE_FREE_SLOTS + RETRIEVE_MAX_SLOTS;
  return Math.min(
    PURGE_MAX_PER_PASS,
    Math.max(PURGE_FREE_SLOTS, working - character.esize),
  );
}

/**
 * Sells a few surplus copies so a full bank still leaves room to work.
 * @returns {Promise<number>} slots freed
 */
async function freeSlotsForUpgrading() {
  let freed = 0;

  // Bag copies first, then one floor at a time
  const victims = findPurgeVictims(getPurgeSlotTarget()).sort(
    (lhs, rhs) =>
      (lhs.index === undefined) - (rhs.index === undefined) ||
      (lhs.floor ?? "").localeCompare(rhs.floor ?? ""),
  );

  for (const victim of victims) {
    let slot = victim.index;

    if (slot === undefined) {
      // A retrieve needs somewhere to land; bag sales above make that room
      if (isInvFull(0)) continue;

      const held = new Set(
        character.items.flatMap((item, index) =>
          matchesPurgeVictim(item, victim) ? [index] : [],
        ),
      );

      await retrieveAll([victim]);

      slot = character.items.findIndex(
        (item, index) => !held.has(index) && matchesPurgeVictim(item, victim),
      );
    }

    if (slot === -1 || !matchesPurgeVictim(character.items[slot], victim))
      continue;

    try {
      await sell(slot, 1);
      freed++;
    } catch (e) {
      console.warn(`Failed purging ${victim.item.name}`, e);
    }
  }

  return freed;
}

/**
 * Sells one surplus bag copy while the bag has no room for the scrolls an
 * upgrade or compound has to buy. Runs off the merchant tick rather than
 * bankLoop's cycle, and only once the bank can no longer take the overflow —
 * with room in the bank the drain is a stash, not a sale.
 * @returns {Promise<boolean>} whether a slot was freed
 */
async function freeBagSlotForWork() {
  if (!isBankTight) return false;
  if (!isInvFull(RETRIEVE_SCROLL_SLOTS)) return false;
  if (!hasBagUpgradeWork()) return false;
  if (!lockInventory("mutate")) return false;

  try {
    const victim = pickPurgeVictim(tallyPurgeLines(), new Set(), 0, {
      bagOnly: true,
    });
    if (!victim || !matchesPurgeVictim(character.items[victim.index], victim))
      return false;

    await sell(victim.index, 1);
    console.log(`purge: sold ${victim.item.name}+${victim.level} for bag room`);
    return true;
  } catch (e) {
    console.warn("Failed freeing a bag slot", e);
    return false;
  } finally {
    unlockInventory("mutate");
  }
}

/** @returns {boolean} whether a bag item is the copy pickPurgeVictim chose */
function matchesPurgeVictim(item, victim) {
  return (
    !!item &&
    !item.l &&
    item.name === victim.item.name &&
    (item.level ?? 0) === victim.level
  );
}

// ---------------------------------------------------------------------------
// Stacking
// ---------------------------------------------------------------------------

/**
 * Mergeable partial stacks of an item across every floor, fullest first.
 * @param {string} itemName
 * @returns {Array<{ pack: string, slot: number, q: number, floor: string }>}
 */
function getPartialStacks(itemName) {
  const maxStack = getMaxStack(itemName);
  const stacks = [];

  forEachBankSlot((item, pack, slot, floor) => {
    if (item?.name !== itemName || !isStackMergeable(item)) return;
    const q = item.q ?? 1;
    if (q < maxStack) stacks.push({ pack, slot, q, floor });
  });

  return stacks.sort((lhs, rhs) => rhs.q - lhs.q);
}

/**
 * An item's smallest partial stack split across the fullest others.
 * @param {string} name
 * @param {number} bagSlots - most bag slots the drain may take
 * @returns {object | undefined}
 */
function buildStackDrain(name, bagSlots) {
  const stacks = getPartialStacks(name);
  if (stacks.length < 2) return;

  const source = stacks.pop();
  const maxStack = getMaxStack(name);
  const pieces = [];
  let left = source.q;

  // The game fills a pack's first stack with room, so each pack's lowest slot is its target
  const firstInPack = {};
  for (const stack of stacks)
    if (!(firstInPack[stack.pack]?.slot < stack.slot))
      firstInPack[stack.pack] = stack;
  const targets = Object.values(firstInPack).sort((lhs, rhs) => rhs.q - lhs.q);

  for (const target of targets) {
    if (!left) break;
    const amount = Math.min(maxStack - target.q, left);
    if (pieces.length + 1 + (left - amount > 0 ? 1 : 0) > bagSlots) break;

    pieces.push({ target, amount });
    left -= amount;
  }

  if (!pieces.length) return;
  return {
    name,
    source,
    pieces,
    left,
    slots: pieces.length + (left > 0 ? 1 : 0),
  };
}

/**
 * Plans one drain per item, those that free a bank slot first, sharing out the
 * bag slots.
 * @param {string[]} names
 * @param {number} bagSlots
 * @returns {Array<object>}
 */
function planStackDrains(names, bagSlots) {
  const candidates = names
    .map((name) => buildStackDrain(name, Infinity))
    .filter(Boolean)
    .sort(
      (lhs, rhs) => (lhs.left > 0) - (rhs.left > 0) || lhs.slots - rhs.slots,
    );

  const drains = [];
  for (const candidate of candidates) {
    const drain =
      candidate.slots <= bagSlots
        ? candidate
        : buildStackDrain(candidate.name, bagSlots);
    if (!drain) continue;

    bagSlots -= drain.slots;
    drains.push(drain);
  }

  return drains;
}

/**
 * Pairs a drain's bag stacks with its pieces by quantity; what's left over is
 * the remainder.
 * @returns {boolean} false if the bag doesn't hold what the drain expects
 */
function assignDrainSlots(drain) {
  const free = getBagSlotsOf(drain.name);
  if (free.length !== drain.slots) return false;

  for (const piece of drain.pieces) {
    const at = free.findIndex(
      (index) => character.items[index].q === piece.amount,
    );
    if (at === -1) return false;
    piece.index = free.splice(at, 1)[0];
  }

  drain.remainderIndex = free[0];
  return drain.left > 0 ? free.length === 1 : !free.length;
}

/** Stores back any bag copy of an item a failed stack move left behind */
async function returnStrays(itemName) {
  if (!BANK_FLOORS[character.map]) return;

  const strays = getBagSlotsOf(itemName);
  if (strays.length) await storeAll(strays.map((index) => [index]));
}

/**
 * Runs the drains floor by floor: every retrieve, then every split, then every
 * store at once.
 * @param {Array<object>} drains
 * @returns {Promise<void>}
 */
async function runStackDrains(drains) {
  for (const [floor, group] of Object.entries(
    groupByFloor(drains.map((drain) => ({ ...drain, floor: drain.source.floor }))),
  )) {
    const empty = getEmptyBagSlots();
    group.forEach((drain, i) => (drain.index = empty[i]));

    await retrieveAll(
      group.map((drain) => ({ ...drain.source, index: drain.index })),
      true,
    );
    if (character.map !== floor) continue;

    await waitUntil(
      () => group.every((drain) => character.items[drain.index]),
      BANK_OP_TIMEOUT,
    );

    const ready = group.filter(
      (drain) => character.items[drain.index]?.q === drain.source.q,
    );

    const splits = ready.flatMap((drain) =>
      drain.pieces
        .slice(0, drain.left > 0 ? undefined : -1)
        .map((piece) => split(drain.index, piece.amount)),
    );
    await withTimeout(Promise.allSettled(splits), BANK_OP_TIMEOUT);
    await waitUntil(
      () =>
        ready.every(
          (drain) => getBagSlotsOf(drain.name).length === drain.slots,
        ),
      BANK_OP_TIMEOUT,
    );

    // Stored by pack alone: onto an occupied slot the game swaps, it doesn't merge
    const assigned = ready.filter(assignDrainSlots);
    const toStore = (onFloor) =>
      assigned.flatMap((drain) =>
        drain.pieces
          .filter((piece) => piece.target.floor === onFloor)
          .map((piece) => [piece.index, piece.target.pack]),
      );

    await storeAll([
      ...toStore(floor),
      ...assigned
        .filter((drain) => drain.left > 0)
        .map((drain) => [
          drain.remainderIndex,
          drain.source.pack,
          drain.source.slot,
        ]),
    ]);

    const targetFloors = new Set(
      assigned.flatMap((drain) =>
        drain.pieces.map((piece) => piece.target.floor),
      ),
    );
    for (const other of targetFloors) {
      if (other === floor || !(await goToBankFloor(other, true))) continue;
      await storeAll(toStore(other));
    }

    await Promise.all(group.map((drain) => returnStrays(drain.name)));
  }
}

/**
 * Merges partial bank stacks so each item has at most one, fullest first.
 * @returns {Promise<void>}
 */
async function stackBank() {
  const names = new Set();
  forEachBankSlot((item) => {
    if (item && getMaxStack(item.name) && locate_item(item.name) === -1)
      names.add(item.name);
  });

  const countPartials = () =>
    [...names].reduce(
      (total, name) => total + getPartialStacks(name).length,
      0,
    );

  await waitUntil(() => !isInventorySorting(), 5_000);
  if (!lockInventory("mutate")) return;

  try {
    for (let round = 0; round < STACK_MAX_ROUNDS; round++) {
      const drains = planStackDrains([...names], character.esize);
      if (!drains.length) break;

      const before = countPartials();
      await runStackDrains(drains);
      if (countPartials() >= before) break;
    }
  } catch (e) {
    console.warn("Failed stacking", e);
  } finally {
    unlockInventory("mutate");
  }
}

// ---------------------------------------------------------------------------
// Bank Loop
// ---------------------------------------------------------------------------

/** @returns {boolean} whether the bag still holds something to upgrade or compound */
function hasBagUpgradeWork() {
  const nothingLeaving = new Set();
  return character.items.some((item, index) =>
    isUpgradeWork(item, index, nothingLeaving),
  );
}

/**
 * @returns {boolean} whether a waiting run should cut its delay short: nothing
 *   left in the bag to work, too little room left to work any of it, or enough
 *   room for a full pull while sets wait in the bank
 */
function shouldWakeBankEarly() {
  const spare = character.esize - RETRIEVE_SCROLL_SLOTS - RETRIEVE_FREE_SLOTS;
  return !hasBagUpgradeWork() || isInvFull(RETRIEVE_SCROLL_SLOTS) || spare > 0;
}

/**
 * Re-runs bankLoop after delay, or early once shouldWakeBankEarly agrees.
 * @param {number} delay
 * @param {boolean} allowEarly - whether the last visit made any progress
 */
function scheduleNextBankRun(delay, allowEarly) {
  if (!allowEarly) return setTimeout(bankLoop, delay);

  const now = Date.now();
  const earliest = now + Math.min(delay, BANK_MIN_DELAY);
  const due = now + delay;

  const poll = () => {
    const at = Date.now();
    if (at >= due || (at >= earliest && shouldWakeBankEarly()))
      return bankLoop();
    setTimeout(poll, BANK_IDLE_POLL_MS);
  };

  setTimeout(poll, BANK_IDLE_POLL_MS);
}

async function bankLoop() {
  let delay = BANK_LOOP_DELAY;
  let pulled = false;
  let freed = 0;

  if (isAwaitingParcel() && !hasVisitedBank) return setTimeout(bankLoop, 5_000);

  // An event fight holds the duty too, so banking waits for it to end
  const lock = takeDuty(DUTY.ERRAND);
  if (!lock) return setTimeout(bankLoop, 5_000);

  try {
    // First run: build item level map then fetch items
    if (Object.keys(itemsHighestLevel).length === 0) {
      for (const floor of Object.keys(BANK_FLOORS)) {
        await goToBankFloor(floor, true);
      }

      hasVisitedBank = true;

      retrieveMaxItemsLevel();
      await retrieveMerchantGear();
      pulled = await retrievedBankItemToUpgrade();
      delay = 60_000;
      return;
    }

    await bankStoreRoutine();
    // The purge frees room after the store pass gave up, so retry it
    freed = await purgeBank();
    if (freed) await bankStoreRoutine();
    await stackBank();

    retrieveMaxItemsLevel();
    await retrieveMerchantGear();
    pulled = await retrievedBankItemToUpgrade();
  } catch (e) {
    console.warn("bank loop error:", e);
    delay = 15_000;
    pulled = false;
    freed = 0;
  } finally {
    releaseDuty(lock);
    // Only real progress earns an early retry, or a stuck bag would round-trip
    // to the bank every BANK_MIN_DELAY achieving nothing
    scheduleNextBankRun(delay, pulled || freed > 0);
  }
}

// ---------------------------------------------------------------------------
// Bank Sync
// ---------------------------------------------------------------------------

/** Pushes bank + inventory data to earthiverse's API every 60s. */
const syncBankData = async () => {
  try {
    if (!bankCache) throw new Error("Have yet enter the bank once!");

    await fetch(
      `https://aldata.earthiverse.ca/bank/${character.owner}/${character.name}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...bankCache, inv: character.items }),
      },
    );

    console.log(
      "Bank & inventory data synced to aldata.earthiverse.ca successfully!",
    );
  } catch (error) {
    console.error("Sync failed:", error);
  } finally {
    setTimeout(syncBankData, 60_000);
  }
};
