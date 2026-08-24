// Bank storage: floors, retrieval, the store/retrieve cycle and the data sync.

var BANK_CACHE = undefined;

/** Spawn positions for each accessible bank floor */
const BANK_FLOORS = {
  bank: { map: "bank", x: 0, y: -280 },
  bank_b: { map: "bank_b", x: -210, y: -130 },
};

// Set once bankLoop's first run has walked every floor.
var hasVisitedBank = false;

/**
 * Slots to skip globally (gold, personal storage).
 * items10 is reserved for personal items and is never touched.
 */
const IGNORE_BANK_SLOTS = ["gold", "items10"];
const IGNORE_RARE_GOLD_THRESHOLD = 20e8;

// ---------------------------------------------------------------------------
// Bank Helpers
// ---------------------------------------------------------------------------

/** Syncs character bank data into BANK_CACHE */
async function updateBank() {
  if (character.bank) BANK_CACHE = character.bank;
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

async function storeMatchingItemsOnFloor(toStoreItemSet) {
  const floorItems = getItemNamesOnCurrentFloor();

  if (!floorItems.size) return;

  // collect matching inventory indices
  const indices = [];

  for (let i = 0; i < character.items.length; i++) {
    const item = character.items[i];
    if (!item) continue;
    if (!toStoreItemSet.has(item.name)) continue;
    if (floorItems.has(item.name)) {
      indices.push(i);
    }
  }

  const promises = indices.map((index) =>
    bank_store(index).catch((e) => {
      console.warn(`Failed storing index ${index} on ${character.map}`, e);
    }),
  );

  return withTimeout(Promise.allSettled(promises), 1000).then(updateBank);
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
  // Determine which items to store
  const toStore = character.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (!item) return false;
      if (item.l) return false; // skip locked items

      const targetLevel = getCraftTargetLevel(item.name);
      if (targetLevel > 0 && (item.level ?? 0) < targetLevel) return false;

      const isRare = item_grade(item) >= 2;
      const isHighLevel =
        item.level >= (ITEMS_HIGHEST_LEVEL[item.name]?.level ?? 1) - 1;
      const isStoreable = STORE_ABLE.includes(item.name);
      const isEquipable = item_info(item).compound || item_info(item).upgrade;
      const shouldIgnore = IGNORE.includes(item.name);

      return (
        (!shouldIgnore &&
          (isRare || (isEquipable && (forced || isHighLevel)))) ||
        isStoreable ||
        RETRIEVE_HISTORY.includes(item.name)
      );
    });

  const toStoreItemSet = new Set(toStore.map(({ item }) => item.name));

  // Group items by floor so we only travel to each floor once, and store matching items in bulk
  const floors = Object.keys(BANK_FLOORS);
  for (const floor of floors) {
    await goToBankFloor(floor, true);
    await storeMatchingItemsOnFloor(toStoreItemSet);
  }

  // Backward pass (leftovers get another chance)
  for (const floor of [...floors].reverse()) {
    await goToBankFloor(floor, true);
    const promises = [];
    for (let i = 0; i < character.items.length; i++) {
      const item = character.items[i];
      if (!item) continue;

      if (toStoreItemSet.has(item.name)) {
        promises.push(
          bank_store(i).catch((e) => {
            console.warn(`Failed storing index ${i} on ${character.map}`, e);
          }),
        );
      }
    }
    await withTimeout(Promise.allSettled(promises), 2000);
  }
}

async function bankLoop() {
  let delay = 120_000;

  // isFightingBoss is checked separately from onDuty: an event fight holds the
  // duty, but this makes it explicit that banking waits for the fight to end
  if (onDuty || (typeof isFightingBoss !== "undefined" && isFightingBoss)) {
    return setTimeout(bankLoop, 5_000);
  }

  try {
    onDuty = true;

    // First run: build item level map then fetch items
    if (Object.keys(ITEMS_HIGHEST_LEVEL).length === 0) {
      // Walk every floor: character.bank only carries the packs of the floor
      // we're standing on, so one visit per floor is what fills BANK_CACHE.
      // goToBankFloor is forced — this runs at startup, before any other loop
      // has taken the duty, and it updateBank()s on arrival.
      for (const floor of Object.keys(BANK_FLOORS)) {
        await goToBankFloor(floor, true);
      }

      hasVisitedBank = true;

      retrieveMaxItemsLevel();
      await retrievedBankItemToUpgrade();
      delay = 60_000;
      return;
    }

    await bankStoreRoutine();

    retrieveMaxItemsLevel();
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
