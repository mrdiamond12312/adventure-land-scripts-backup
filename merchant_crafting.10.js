if (parent.caracAL) {
  parent.caracAL.load_scripts([
    "adventure-land-scripts-backup/basic_function.7.js",
  ]);
} else {
  load_code(7);
}

var BANK_CACHE = undefined;

/** Spawn positions for each accessible bank floor */
const BANK_FLOORS = {
  bank: { map: "bank", x: 0, y: -280 },
  bank_b: { map: "bank_b", x: -210, y: -130 },
};

/**
 * Slots to skip globally (gold, personal storage).
 * items10 is reserved for personal items and is never touched.
 */
const IGNORE_BANK_SLOTS = ["gold", "items10"];
const IGNORE_RARE_GOLD_THRESHOLD = 20e8;

const KEEP_THRESHOLD = {
  bataxe: 20,
  pinkie: 12,
  ecape: 20,
  firestars: 12,

  ecape: 5,
  helmet: 3,
  pants: 3,
  gloves: 3,
  shoes: 3,
  chest: 3,
  cape: 4,
  weapon: 2,
  orb: 3,
  shield: 2,
  source: 2,
  staff: 3,
  earring: 4,
  ring: 4,
  amulet: 2,
  belt: 2,
};

const ITEMS_HIGHEST_LEVEL = {};
const RETRIEVE_HISTORY = [];

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
 * @returns {Array<{ name: string, level: number, slot: number, pack: string, floor: string }>}
 */
function getItemBankSlots(itemId, forced = false) {
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

  if (character.gold < IGNORE_RARE_GOLD_THRESHOLD)
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
// Upgrade/Compound Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the keep threshold for an item by name, falling back to its type.
 * @param {string} itemName
 * @returns {number}
 */
function getKeepThreshold(itemName) {
  return (
    KEEP_THRESHOLD[itemName] ??
    KEEP_THRESHOLD[ITEMS_HIGHEST_LEVEL[itemName]?.type] ??
    2
  );
}

/**
 * Ensures a scroll of the given type is in the inventory.
 * Retrieves from bank first, then buys if unavailable.
 * @param {string} scrollType - e.g. "scroll0", "cscroll2"
 * @param {number} itemGrade
 * @returns {Promise<number>} inventory slot of the scroll, or -1 on failure
 */
async function ensureScroll(scrollType, itemGrade) {
  if (
    !character.c.fishing &&
    !character.c.mining &&
    getItemBankSlots(scrollType, true).length > 0
  ) {
    await retrieveBankItem(scrollType);
  }

  let scrollSlot = locate_item(scrollType);
  if (scrollSlot !== -1) return scrollSlot;

  if (itemGrade >= 2 && character.gold < IGNORE_RARE_GOLD_THRESHOLD) return -1;

  try {
    await buy(scrollType, 1);
  } catch (e) {
    return -1;
  }

  return locate_item(scrollType);
}

/**
 * Retrieves an offeringp from the bank if needed and available.
 * @param {boolean} isRareItem
 * @returns {Promise<void>}
 */
async function ensureOffering(isRareItem) {
  if (
    isRareItem &&
    locate_item("offeringp") === -1 &&
    getItemBankSlots("offeringp").length > 0 &&
    !smart.moving
  ) {
    await retrieveBankItem("offeringp");
  }
}

/**
 * Activates mass production skills if available.
 * @param {boolean} [pp=false] - also try massproductionpp
 */
function activateMassProduction(pp = false) {
  if (
    pp &&
    character.mp > 200 &&
    !is_on_cooldown("massproductionpp") &&
    !character.s.massproductionpp
  ) {
    if (character.mp < 1000 && locate_item("mpot1") === -1) buy("mpot1", 1);
    use_skill("massproductionpp");
  }
  if (
    character.mp > 20 &&
    !is_on_cooldown("massproduction") &&
    !character.s.massproduction
  ) {
    use_skill("massproduction");
  }
}

/**
 * Returns the offeringp slot to use during upgrade/compound, or undefined.
 * @param {boolean} isRareItem
 * @returns {number | undefined}
 */
function getOfferingSlot(isRareItem) {
  const slot = locate_item("offeringp");
  return isRareItem && slot !== -1 ? slot : undefined;
}

// ---------------------------------------------------------------------------
// Item Level Tracking
// ---------------------------------------------------------------------------

/**
 * Scans inventory + bank cache to build ITEMS_HIGHEST_LEVEL map.
 * Call after visiting all bank floors so BANK_CACHE is fully populated.
 */
function retrieveMaxItemsLevel() {
  if (!Object.keys(BANK_FLOORS).includes(character.map)) return;

  for (const key in ITEMS_HIGHEST_LEVEL) delete ITEMS_HIGHEST_LEVEL[key];
  updateBank();

  const processItem = (item) => {
    if (!item || item.q || IGNORE.includes(item.name)) return;

    const existing = ITEMS_HIGHEST_LEVEL[item.name];
    if (!existing) {
      ITEMS_HIGHEST_LEVEL[item.name] = {
        level: item.level,
        quantity: 1,
        count: 1,
        ...item_info(item),
      };
      return;
    }

    if (item.level > existing.level) {
      existing.level = item.level;
      existing.quantity = 1;
    } else if (item.level === existing.level) {
      existing.quantity++;
    }
    existing.count++;
  };

  character.items.forEach(processItem);
  const bank = character.bank ?? BANK_CACHE ?? {};

  for (const slot in bank) {
    if (IGNORE_BANK_SLOTS.includes(slot)) continue;
    bank[slot].forEach(processItem);
  }
}

/**
 * Groups items by level.
 * @param {Array} items
 * @returns {Object<number, Array>}
 */
function groupItemsByLevel(items) {
  return items.reduce((acc, item) => {
    (acc[item.level] = acc[item.level] ?? []).push(item);
    return acc;
  }, {});
}

/**
 * Returns items that form complete compoundable sets of 3,
 * limited by available inventory slots.
 * @param {Array} items
 * @param {number} inventoryEmptySlots
 * @returns {Array}
 */
function filterCompoundableSets(items, inventoryEmptySlots) {
  const byLevel = groupItemsByLevel(items);
  const result = [];

  for (const level in byLevel) {
    const group = byLevel[level];
    const setCount = Math.floor(group.length / 3);
    if (setCount > 0) result.push(...group.slice(0, setCount * 3));
  }

  return result.slice(0, Math.floor(inventoryEmptySlots / 3) * 3);
}

/**
 * Selects and retrieves the best batch of items from the bank to upgrade/compound.
 * Visits each floor as needed. Keeps at least 4 inventory slots free for scrolls/offerings.
 * Respects KEEP_THRESHOLD and RETRIEVE_HISTORY to rotate selections.
 * @returns {Promise<void>}
 */
async function retrievedBankItemToUpgrade() {
  let inventoryEmptySlots = character.esize - 4; // reserve 4 slots for scrolls/offerings

  let desiredItemId;
  let maxItemCount = 0;

  for (const id in ITEMS_HIGHEST_LEVEL) {
    const info = item_info({ name: id });
    if (!info) continue;
    if (info.compound && inventoryEmptySlots < 3) continue;
    if (
      ITEMS_HIGHEST_LEVEL[id].count > maxItemCount &&
      !RETRIEVE_HISTORY.includes(id)
    ) {
      maxItemCount = ITEMS_HIGHEST_LEVEL[id].count;
      desiredItemId = id;
    }
  }

  if (!desiredItemId) return;

  RETRIEVE_HISTORY.push(desiredItemId);
  if (RETRIEVE_HISTORY.length >= Object.keys(ITEMS_HIGHEST_LEVEL).length / 5) {
    RETRIEVE_HISTORY.shift();
  }

  let desiredItems = getItemBankSlots(desiredItemId, true);
  const keep = getKeepThreshold(desiredItemId);
  desiredItems = desiredItems.slice(0, desiredItems.length - keep);

  if (item_info({ name: desiredItemId }).compound) {
    desiredItems = filterCompoundableSets(desiredItems, inventoryEmptySlots);
  }

  // Group items by floor so we only travel to each floor once
  const byFloor = {};
  for (const itemSlot of desiredItems) {
    if (inventoryEmptySlots-- <= 0) break;
    (byFloor[itemSlot.floor] = byFloor[itemSlot.floor] ?? []).push(itemSlot);
  }

  for (const [floor, slots] of Object.entries(byFloor)) {
    if (!(await goToBankFloor(floor))) continue;
    await withTimeout(
      Promise.allSettled(slots.map((s) => bank_retrieve(s.pack, s.slot))),
      2500,
    );
    updateBank();
  }
}

// ---------------------------------------------------------------------------
// Compound
// ---------------------------------------------------------------------------

/** Attempts to compound the first valid set of 3 identical items in inventory. */
async function compoundInv() {
  if (character.q.compound || character.q.exchange) return;

  for (let i = 0; i < 42; i++) {
    const item = character.items[i];
    if (!item) break;

    const itemName = item.name;
    if (IGNORE.includes(itemName)) continue;

    const itemInfo = item_info(item);
    if (!itemInfo.compound) continue;

    // Validate set of 3
    const nameSet = new Set([
      itemName,
      character.items[i + 1]?.name,
      character.items[i + 2]?.name,
    ]);
    const levelSet = new Set([
      item.level,
      character.items[i + 1]?.level,
      character.items[i + 2]?.level,
    ]);
    if (nameSet.size !== 1 || levelSet.size !== 1) continue;

    const itemGrade = item_grade(item);
    const isRareItem =
      item.level >=
      (itemInfo.grades[0] > 0
        ? itemInfo.grades[0]
        : itemGrade >= 2
        ? 0
        : itemInfo.grades[0] + 2);
    const havePrimlingInBank = getItemBankSlots("offeringp").length > 0;

    // Skip if we don't have enough of this item yet
    if (
      isRareItem &&
      ITEMS_HIGHEST_LEVEL[itemName] &&
      ITEMS_HIGHEST_LEVEL[itemName].quantity <
        (getKeepThreshold(itemName) + 3 ?? 5) &&
      item.level === ITEMS_HIGHEST_LEVEL[itemName].level
    ) {
      continue;
    }

    const scrollSlot = await ensureScroll(`cscroll${itemGrade}`, itemGrade);
    if (scrollSlot === -1) {
      break;
    }

    await ensureOffering(isRareItem);
    activateMassProduction();

    const offeringSlot = getOfferingSlot(isRareItem);
    const offeringReady =
      !havePrimlingInBank || !isRareItem || offeringSlot !== undefined;
    if (!offeringReady) continue;

    return compound(i, i + 1, i + 2, scrollSlot, offeringSlot).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Upgrade
// ---------------------------------------------------------------------------

/** Attempts to upgrade the lowest level upgradeable item in inventory. */
async function upgradeInv() {
  if (character.q.upgrade || character.q.exchange) return;

  // Find the lowest level upgradeable candidate, skipping disqualified items
  let itemIndex = -1;
  let lowestLevel = Infinity;
  let selectedGrade;
  let selectedHighestLevel;

  for (let i = 0; i < character.items.length; i++) {
    const item = character.items[i];
    if (!item) continue;
    if (IGNORE.includes(item.name)) continue;
    if (!item_info(item).upgrade) continue;

    const itemGrade = item_grade(item);
    const highestLevel = ITEMS_HIGHEST_LEVEL[item.name];
    const overLeveled =
      (item.level > maxUpgrade || itemGrade >= 2) &&
      item.level >= (highestLevel?.level ?? 0);
    const haveEnoughToSpare =
      highestLevel &&
      highestLevel.quantity > getKeepThreshold(item.name) &&
      item.level === highestLevel.level;

    if (overLeveled && !haveEnoughToSpare) continue;

    if (item.level < lowestLevel) {
      lowestLevel = item.level;
      itemIndex = i;
      selectedGrade = itemGrade;
      selectedHighestLevel = highestLevel;
    }
  }

  if (itemIndex === -1) return;

  const item = character.items[itemIndex];
  const itemName = item.name;
  const isRareItem =
    item.level >= 6 ||
    (item.level >= 4 && selectedGrade >= 1) ||
    selectedGrade >= 2;
  const havePrimlingInBank = getItemBankSlots("offeringp").length > 0;

  const scrollSlot = await ensureScroll(
    `scroll${selectedGrade}`,
    selectedGrade,
  );
  if (scrollSlot === -1) return;

  await ensureOffering(isRareItem);
  activateMassProduction(true);

  const offeringSlot = getOfferingSlot(isRareItem);
  if (!havePrimlingInBank || !isRareItem || offeringSlot !== undefined)
    return upgrade(itemIndex, scrollSlot, offeringSlot)
      .then(async (e) => {
        if (!e?.success) return;

        if (e.level > (selectedHighestLevel?.level ?? 0)) {
          ITEMS_HIGHEST_LEVEL[itemName] = {
            level: e.level,
            quantity: 1,
            ...item_info({ name: itemName }),
          };
        }

        if (e.level >= (selectedHighestLevel?.level ?? 0) - 1) {
          storeToBankFloor(findMaxLevelItem(itemName));
        }
      })
      .catch(() => {});
}

// ---------------------------------------------------------------------------
// Bank Loop
// ---------------------------------------------------------------------------

/**
 * Main bank loop: visits all accessible floors, stores qualifying items,
 * then retrieves items to upgrade/compound.
 * Skips if onDuty. Reschedules itself on completion or error.
 */
async function bankStoreRoutine() {
  // Determine which items to store
  const toStore = character.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (!item) return false;
      const isRare = item_grade(item) >= 2;
      const isHighLevel =
        item.level >= (ITEMS_HIGHEST_LEVEL[item.name]?.level ?? 1) - 1;
      const isStoreable = STORE_ABLE.includes(item.name);
      const isEquipable = item_info(item).compound || item_info(item).upgrade;
      const shouldIgnore = IGNORE.includes(item.name);

      return (
        (!shouldIgnore && (isRare || (isEquipable && isHighLevel))) ||
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

  if (onDuty) {
    return setTimeout(bankLoop, 5_000);
  }

  try {
    onDuty = true;

    // First run: build item level map then fetch items
    if (Object.keys(ITEMS_HIGHEST_LEVEL).length === 0) {
      // Visit all floors to populate BANK_CACHE fully
      await smart_move(BANK_FLOORS.bank);

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

if (!parent.caracAL) {
  bankLoop();
  syncBankData();
}
