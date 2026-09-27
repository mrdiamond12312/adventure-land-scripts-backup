// Bank storage: floors, retrieval, the store/retrieve cycle and the data sync.

var BANK_CACHE = undefined;

/** Spawn positions for each accessible bank floor */
const BANK_FLOORS = {
  bank: { map: "bank", x: 0, y: -280 },
  bank_b: { map: "bank_b", x: -210, y: -130 },
};

// Set once bankLoop's first run has walked every floor.
var hasVisitedBank = false;

/** Whether no floor has an empty slot */
var isBankFull = false;

/**
 * Slots to skip globally (gold, personal storage).
 * items10 is reserved for personal items and is never touched.
 */
const IGNORE_BANK_SLOTS = ["gold", "items10"];
const IGNORE_RARE_GOLD_THRESHOLD = 20e8;

/** Highest level sold per item once the bank is full */
const PURGE_LEVELS = { frankypants: 2 };

/** Sets sold below PURGE_GEAR_LEVEL once the bank is full, like vendor gear */
const PURGE_SETS = ["rugged"];

/** Vendor gear and PURGE_SETS are sold below this level */
const PURGE_GEAR_LEVEL = 8;

// ---------------------------------------------------------------------------
// Bank Helpers
// ---------------------------------------------------------------------------

/** Merges character.bank into BANK_CACHE */
async function updateBank() {
  if (character.bank) BANK_CACHE = { ...BANK_CACHE, ...character.bank };
}

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
 * Returns all pack keys that belong to the given bank floor.
 * @param {string} floor - e.g. "bank", "bank_u"
 * @returns {string[]}
 */
function getPacksOnFloor(floor) {
  const packs = [];
  for (const key in bank_packs) {
    if (bank_packs[key][0] === floor) packs.push(key);
  }
  return packs;
}

function getItemNamesOnCurrentFloor() {
  const names = new Set();
  const packs = getPacksOnFloor(character.map);
  const bank = BANK_CACHE ?? character.bank ?? {};

  for (const pack of packs) {
    const items = bank[pack];
    if (!items) continue;

    for (const item of items) {
      if (item?.name) names.add(item.name);
    }
  }

  return names;
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
 * Returns all bank slots containing the given item across all floors,
 * sorted by level ascending.
 * Filters out rare-grade items if gold is below threshold.
 * @param {string} itemId
 * @param {boolean} [forced=false] - also search the personal-storage packs
 * @param {boolean} [includeRare=false] - keep rare grades even when gold is low
 * @returns {Array<{ name: string, level: number, slot: number, pack: string, floor: string }>}
 */
function getItemBankSlots(itemId, forced = false, includeRare = false) {
  if (!BANK_CACHE) return [];

  const result = [];
  for (const id in BANK_CACHE) {
    if (id === "gold") continue;
    if (IGNORE_BANK_SLOTS.includes(id) && !forced) continue;
    BANK_CACHE[id].forEach((item, index) => {
      if (item?.name === itemId)
        result.push({
          ...item,
          slot: index,
          pack: id,
          floor: getFloorOfPack(id),
        });
    });
  }

  if (!includeRare && character.gold < IGNORE_RARE_GOLD_THRESHOLD)
    return result
      .filter((item) => item_grade(item) < 2)
      .sort((lhs, rhs) => lhs.level - rhs.level);

  return result.sort((lhs, rhs) => lhs.level - rhs.level);
}

/**
 * Retrieves an item from the bank by name and optional level.
 * Automatically navigates to the correct floor where the item lives.
 * @param {string} searchId
 * @param {number} [level=0] - if 0, matches any level
 * @returns {Promise<void>}
 */
async function retrieveBankItem(searchId, level = 0) {
  // Find which pack (and floor) holds this item
  let targetPack, targetSlot;
  for (const [pack, items] of Object.entries(BANK_CACHE ?? {})) {
    if (pack === "gold") continue;
    const slot = items.findIndex(
      (item) => item?.name === searchId && (!level || level === item.level),
    );
    if (slot !== -1) {
      targetPack = pack;
      targetSlot = slot;
      break;
    }
  }

  if (targetPack === undefined) return;

  const floor = getFloorOfPack(targetPack);
  if (!(await goToBankFloor(floor))) return;

  return bank_retrieve(targetPack, targetSlot).then(updateBank);
}

// Bag space the gear trip leaves alone for scrolls, offerings and loot
const MERCHANT_GEAR_FREE_SLOTS = 4;

/**
 * Pulls one copy of every item calculateMerchantEquipments can ask for out of
 * the bank: locked first, then highest level. Only the swap that matches our
 * current state ever gets equipped, but the pieces for the others have to be in
 * the bag already — a swap mid-lure or mid-boss can't wait for a bank trip.
 * @returns {Promise<void>}
 */
async function retrieveMerchantGear() {
  if (character.ctype !== "merchant" || !BANK_CACHE) return;

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

  const allowed = targets.slice(
    0,
    Math.max(0, character.esize - MERCHANT_GEAR_FREE_SLOTS),
  );

  // Retrieved by pack/slot, not by name+level: a same-level unlocked twin would
  // otherwise be what the search hands back
  for (const floor of new Set(allowed.map((target) => target.floor))) {
    if (!(await goToBankFloor(floor))) continue;

    await withTimeout(
      Promise.allSettled(
        allowed
          .filter((target) => target.floor === floor)
          .map((target) =>
            bank_retrieve(target.pack, target.slot).catch((error) =>
              console.warn(`Failed retrieving ${target.name}`, error),
            ),
          ),
      ),
      2_500,
    );
  }

  return updateBank();
}

/**
 * Inventory indices holding the copy of each merchant-gear item we keep — the
 * highest level one. Spares stay bankable, so the upgrade rotation still gets
 * them and only what a swap would reach for is pinned to the bag.
 * @returns {Set<number>}
 */
function getMerchantGearKeepIndices() {
  if (character.ctype !== "merchant") return new Set();

  const gear = getMerchantGearNames();
  const keepers = {};

  character.items.forEach((item, index) => {
    if (!item || !gear.has(item.name)) return;
    if ((item.level ?? 0) <= (keepers[item.name]?.level ?? -1)) return;
    keepers[item.name] = { level: item.level ?? 0, index };
  });

  return new Set(Object.values(keepers).map((keeper) => keeper.index));
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
      bank_store(inventoryIndex);
      return;
    } catch (e) {
      console.warn(`bank_store failed on ${floor}, trying next floor...`);
    }
  }

  console.warn(`Could not store item at index ${inventoryIndex} on any floor.`);
}

/** @returns {number} an item's stack size, 0 if it doesn't stack */
function getMaxStack(itemName) {
  const maxStack = G.items[itemName]?.s;
  return maxStack === true ? 9999 : maxStack || 0;
}

/** @returns {boolean} whether this stack can take more of its item */
function isStackMergeable(item) {
  return !item.l && !item.p && !item.b && !item.v && !item.data;
}

/**
 * Free slots and stack room on a bank floor.
 * @param {string} floor
 * @returns {{ empty: number, stackRoom: Object<string, number[]> }}
 */
function getFloorCapacity(floor) {
  const bank = BANK_CACHE ?? character.bank ?? {};
  const capacity = { empty: 0, stackRoom: {} };

  for (const pack of getPacksOnFloor(floor)) {
    const items = bank[pack];
    if (!items) continue;

    for (const item of items) {
      if (!item) {
        capacity.empty++;
        continue;
      }

      const maxStack = getMaxStack(item.name);
      if (!maxStack || !isStackMergeable(item)) continue;

      const room = maxStack - (item.q ?? 1);
      if (room > 0)
        (capacity.stackRoom[item.name] =
          capacity.stackRoom[item.name] ?? []).push(room);
    }
  }

  return capacity;
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
    const rooms = capacity.stackRoom[item.name] ?? [];
    const stack = rooms.findIndex((room) => room >= quantity);

    if (stack !== -1) {
      rooms[stack] -= quantity;
      storable.push(index);
    } else if (capacity.empty > 0) {
      capacity.empty--;
      const maxStack = getMaxStack(item.name);
      if (maxStack > quantity)
        (capacity.stackRoom[item.name] =
          capacity.stackRoom[item.name] ?? []).push(maxStack - quantity);
      storable.push(index);
    } else {
      skipped.push(index);
    }
  }

  return { storable, skipped };
}

/**
 * Stores every index that fits on the current floor.
 * @param {number[]} indices
 * @param {number} timeout
 * @returns {Promise<void>}
 */
async function storeIndicesOnCurrentFloor(indices, timeout) {
  const { storable, skipped } = pickStorableIndices(
    indices,
    getFloorCapacity(character.map),
  );

  if (skipped.length)
    console.log(
      `bank full: ${skipped.length} items stay in bag on ${character.map}`,
    );

  const promises = storable.map((index) =>
    bank_store(index).catch((e) => {
      console.warn(`Failed storing index ${index} on ${character.map}`, e);
    }),
  );

  return withTimeout(Promise.allSettled(promises), timeout).then(updateBank);
}

async function storeMatchingItemsOnFloor(
  toStoreItemSet,
  keepIndices = new Set(),
) {
  const floorItems = getItemNamesOnCurrentFloor();

  if (!floorItems.size) return;

  // collect matching inventory indices
  const indices = [];

  for (let i = 0; i < character.items.length; i++) {
    const item = character.items[i];
    if (!item) continue;
    if (keepIndices.has(i)) continue;
    if (!toStoreItemSet.has(item.name)) continue;
    if (floorItems.has(item.name)) {
      indices.push(i);
    }
  }

  return storeIndicesOnCurrentFloor(indices, 1000);
}

// ---------------------------------------------------------------------------
// Purge
// ---------------------------------------------------------------------------

/** Highest level the sell sweep takes, per kind */
const SALE_MAX_LEVEL = { compound: 1, upgrade: 2 };

/** @returns {boolean} whether the sell sweep takes this item */
function isSaleableItem(item) {
  if (!item || item.l || item.shiny) return false;
  if (!SALE_ABLE.includes(item.name) || isCraftIngredient(item.name))
    return false;

  const maxLevel = G.items[item.name]?.compound
    ? SALE_MAX_LEVEL.compound
    : SALE_MAX_LEVEL.upgrade;
  return (item.level ?? 0) <= maxLevel;
}

/** @returns {boolean} whether this item is surplus to sell once the bank is full */
function isPurgeable(item) {
  if (!item || item.l || item.p) return false;

  const def = G.items[item.name];
  if (!def?.upgrade && !def?.compound) return false;
  if (isCraftIngredient(item.name) || getMerchantGearNames().has(item.name))
    return false;

  const level = item.level ?? 0;
  if (PURGE_LEVELS[item.name] !== undefined)
    return level <= PURGE_LEVELS[item.name];

  const isPurgeGear =
    PURGE_SETS.includes(def.set) || !!findVendorMerchantOf(item.name);
  return isPurgeGear && level < PURGE_GEAR_LEVEL;
}

/** @returns {boolean} whether this item should be sold now */
function shouldSellItem(item) {
  return isSaleableItem(item) || (isBankFull && isPurgeable(item));
}

/**
 * Pulls stray saleables, and purgeable surplus once the bank is full, then sells them.
 * @returns {Promise<void>}
 */
async function purgeBank() {
  const byFloor = {};
  for (const pack in BANK_CACHE ?? {}) {
    if (IGNORE_BANK_SLOTS.includes(pack)) continue;

    BANK_CACHE[pack].forEach((item, slot) => {
      if (!shouldSellItem(item)) return;
      const floor = getFloorOfPack(pack);
      (byFloor[floor] = byFloor[floor] ?? []).push({ pack, slot });
    });
  }

  for (const [floor, slots] of Object.entries(byFloor)) {
    if (!(await goToBankFloor(floor))) continue;

    while (slots.length) {
      const batch = slots.splice(0, Math.max(0, character.esize - 1));
      if (!batch.length) break;

      await withTimeout(
        Promise.allSettled(batch.map((s) => bank_retrieve(s.pack, s.slot))),
        2500,
      );
      updateBank();
      await sellMarkedItems();
    }
  }
}

/** Sells every bag item shouldSellItem picks */
async function sellMarkedItems() {
  const sales = [];
  character.items.forEach((item, index) => {
    if (shouldSellItem(item))
      sales.push(
        sell(index, item.q ?? 1).catch((e) =>
          console.warn(`Failed selling ${item.name}`, e),
        ),
      );
  });

  return withTimeout(Promise.allSettled(sales), 2500);
}

// ---------------------------------------------------------------------------
// Stacking
// ---------------------------------------------------------------------------

/** Rounds one stacking pass may run */
const STACK_MAX_ROUNDS = 5;

/**
 * Mergeable partial stacks of an item across every floor, fullest first.
 * @param {string} itemName
 * @returns {Array<{ pack: string, slot: number, q: number, floor: string }>}
 */
function getPartialStacks(itemName) {
  const maxStack = getMaxStack(itemName);
  const stacks = [];

  for (const pack in BANK_CACHE ?? {}) {
    if (IGNORE_BANK_SLOTS.includes(pack)) continue;

    BANK_CACHE[pack].forEach((item, slot) => {
      if (item?.name !== itemName || !isStackMergeable(item)) return;
      const q = item.q ?? 1;
      if (q < maxStack)
        stacks.push({ pack, slot, q, floor: getFloorOfPack(pack) });
    });
  }

  return stacks.sort((lhs, rhs) => rhs.q - lhs.q);
}

/** @returns {number[]} bag slots holding an item */
function getBagSlotsOf(itemName) {
  return character.items
    .map((item, index) => (item?.name === itemName ? index : -1))
    .filter((index) => index !== -1);
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

  for (const target of stacks) {
    if (!left) break;
    const amount = Math.min(maxStack - target.q, left);
    if (pieces.length + 1 + (left - amount > 0 ? 1 : 0) > bagSlots) break;

    pieces.push({ target, amount });
    left -= amount;
  }

  if (!pieces.length) return;
  return { name, source, pieces, left, slots: pieces.length + (left > 0 ? 1 : 0) };
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
      (lhs, rhs) =>
        (lhs.left > 0) - (rhs.left > 0) || lhs.slots - rhs.slots,
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
    const at = free.findIndex((index) => character.items[index].q === piece.amount);
    if (at === -1) return false;
    piece.index = free.splice(at, 1)[0];
  }

  drain.remainderIndex = free[0];
  return drain.left > 0 ? free.length === 1 : !free.length;
}

/** Stores [index, pack, slot] entries all at once */
function storeAll(entries) {
  return withTimeout(
    Promise.allSettled(
      entries.map(([index, pack, slot]) => bank_store(index, pack, slot)),
    ),
    2_500,
  ).then(updateBank);
}

/**
 * Runs the drains floor by floor: every retrieve, then every split, then every
 * store at once.
 * @param {Array<object>} drains
 * @returns {Promise<void>}
 */
async function runStackDrains(drains) {
  const sourceFloors = [...new Set(drains.map((drain) => drain.source.floor))];

  for (const floor of sourceFloors) {
    const group = drains.filter((drain) => drain.source.floor === floor);
    if (!(await goToBankFloor(floor, true))) continue;

    const empty = character.items
      .map((item, index) => (item ? -1 : index))
      .filter((index) => index !== -1);
    group.forEach((drain, i) => (drain.index = empty[i]));

    await withTimeout(
      Promise.allSettled(
        group.map((drain) =>
          bank_retrieve(drain.source.pack, drain.source.slot, drain.index),
        ),
      ),
      2_500,
    );
    await waitUntil(
      () => group.every((drain) => character.items[drain.index]),
      2_500,
    );

    const ready = group.filter(
      (drain) => character.items[drain.index]?.q === drain.source.q,
    );

    const splits = ready.flatMap((drain) =>
      drain.pieces
        .slice(0, drain.left > 0 ? undefined : -1)
        .map((piece) => split(drain.index, piece.amount)),
    );
    await withTimeout(Promise.allSettled(splits), 2_500);
    await waitUntil(
      () =>
        ready.every(
          (drain) => getBagSlotsOf(drain.name).length === drain.slots,
        ),
      2_500,
    );

    const assigned = ready.filter(assignDrainSlots);
    const toStore = (onFloor) =>
      assigned.flatMap((drain) =>
        drain.pieces
          .filter((piece) => piece.target.floor === onFloor)
          .map((piece) => [piece.index, piece.target.pack, piece.target.slot]),
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

/** Stores back any bag copy of an item a failed stack move left behind */
async function returnStrays(itemName) {
  if (!BANK_FLOORS[character.map]) return;

  const promises = getBagSlotsOf(itemName).map((index) =>
    bank_store(index).catch(() => {}),
  );
  if (!promises.length) return;

  await withTimeout(Promise.allSettled(promises), 2_500);
  updateBank();
}

/**
 * Merges partial bank stacks so each item has at most one, fullest first.
 * @returns {Promise<void>}
 */
async function stackBank() {
  const names = new Set();
  for (const pack in BANK_CACHE ?? {}) {
    if (IGNORE_BANK_SLOTS.includes(pack)) continue;
    for (const item of BANK_CACHE[pack])
      if (item && getMaxStack(item.name) && locate_item(item.name) === -1)
        names.add(item.name);
  }

  const countPartials = () =>
    [...names].reduce((total, name) => total + getPartialStacks(name).length, 0);

  await waitUntil(() => !isSortingInventory, 5_000);
  pendingItemMutations++;
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
    pendingItemMutations--;
  }
}

// ---------------------------------------------------------------------------
// Bank Loop
// ---------------------------------------------------------------------------

/**
 * Main bank loop: visits all accessible floors, stores qualifying items,
 * then retrieves items to upgrade/compound.
 * Skips if onDuty. Reschedules itself on completion or error.
 * @param {Boolean} forced to force storing weapons without checking its level
 */
async function bankStoreRoutine(forced = false) {
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
        ? countInventoryAtLevel(item.name, item.level ?? 0) >= 3
        : !!info.upgrade;

      // A climb only holds its ingredient back while the climb can still happen
      const targetLevel = getCraftTargetLevel(item.name);
      if (targetLevel > 0 && (item.level ?? 0) < targetLevel && isFodder)
        return false;

      const isRare = item_grade(item) >= 2;
      const isHighLevel =
        item.level >= (ITEMS_HIGHEST_LEVEL[item.name]?.level ?? 1) - 1;
      const isStoreable = STORE_ABLE.includes(item.name);
      const isEquipable = info.compound || info.upgrade;
      const shouldIgnore = IGNORE.includes(item.name);

      return (
        (!shouldIgnore &&
          (isRare || (isEquipable && (forced || isHighLevel || !isFodder)))) ||
        isStoreable ||
        lastRetrieved.has(item.name)
      );
    });

  const toStoreItemSet = new Set(toStore.map(({ item }) => item.name));
  const floors = Object.keys(BANK_FLOORS);

  if (hasVisitedBank) {
    const toStoreIndices = toStore.map(({ index }) => index);
    const fitsSomewhere = floors.some(
      (floor) =>
        pickStorableIndices(toStoreIndices, getFloorCapacity(floor)).storable
          .length,
    );

    if (!fitsSomewhere) {
      const wasBankFull = isBankFull;
      isBankFull = floors.every(
        (floor) => getFloorCapacity(floor).empty === 0,
      );
      if (isBankFull && !wasBankFull)
        console.log("bank full: nothing in the bag fits, skipping bank trips");
      return;
    }
  }

  // Group items by floor so we only travel to each floor once, and store matching items in bulk
  for (const floor of floors) {
    await goToBankFloor(floor, true);
    await storeMatchingItemsOnFloor(toStoreItemSet, keepIndices);
  }

  // Backward pass (leftovers get another chance)
  for (const floor of [...floors].reverse()) {
    await goToBankFloor(floor, true);
    const indices = [];
    for (let i = 0; i < character.items.length; i++) {
      const item = character.items[i];
      if (!item) continue;
      if (keepIndices.has(i)) continue;
      if (toStoreItemSet.has(item.name)) indices.push(i);
    }
    await storeIndicesOnCurrentFloor(indices, 2000);
  }

  isBankFull = floors.every((floor) => getFloorCapacity(floor).empty === 0);
}

async function bankLoop() {
  let delay = 185_000;

  // isFightingBoss is checked separately from onDuty: an event fight holds the
  // duty, but this makes it explicit that banking waits for the fight to end
  if (onDuty || (typeof isFightingBoss !== "undefined" && isFightingBoss)) {
    return setTimeout(bankLoop, 5_000);
  }

  if (isAwaitingParcel() && !hasVisitedBank) return setTimeout(bankLoop, 5_000);

  try {
    onDuty = true;

    // First run: build item level map then fetch items
    if (Object.keys(ITEMS_HIGHEST_LEVEL).length === 0) {
      for (const floor of Object.keys(BANK_FLOORS)) {
        await goToBankFloor(floor, true);
      }

      hasVisitedBank = true;

      retrieveMaxItemsLevel();
      await retrieveMerchantGear();
      await retrievedBankItemToUpgrade();
      delay = 60_000;
      return;
    }

    await bankStoreRoutine();
    await purgeBank();
    await stackBank();

    retrieveMaxItemsLevel();
    await retrieveMerchantGear();
    await retrievedBankItemToUpgrade();
  } catch (e) {
    console.warn("bank loop error:", e);
    delay = 15_000;
  } finally {
    onDuty = false;
    setTimeout(bankLoop, delay);
  }
}

// ---------------------------------------------------------------------------
// Bank Sync
// ---------------------------------------------------------------------------

/** Pushes bank + inventory data to earthiverse's API every 60s. */
const syncBankData = async () => {
  try {
    if (!BANK_CACHE) throw new Error("Have yet enter the bank once!");

    await fetch(
      `https://aldata.earthiverse.ca/bank/${character.owner}/${character.name}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BANK_CACHE, inv: character.items }),
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
