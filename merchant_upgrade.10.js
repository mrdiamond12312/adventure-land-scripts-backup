if (parent.caracAL) {
  parent.caracAL.load_scripts([
    "adventure-land-scripts-backup/basic_function.7.js",
  ]);
} else {
  load_code(7);
}

const KEEP_THRESHOLD = {
  firestars: 12,
  harbringer: 16,
  oozingterror: 12,
  pouchbow: 16,
  daggerofthedead: 16,
  bowofthedead: 16,
  froststaff: 8,
  frankypants: 8,
  gphelmet: 12,

  // lifted later
  fury: 32,
  starkillers: 32,
  northstar: 10,
  orboftemporal: 9,
  t2quiver: 16,

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
    if (!item || item.q) return;
    if (IGNORE.includes(item.name) && !isCraftTargeted(item.name)) return;

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
    if (item.l) return acc; // skip locked items
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
 * Bank slots worth pulling for one item id, or an empty array when none are:
 * locked copies, the KEEP_THRESHOLD tail and incomplete compound sets all
 * disqualify, and any of them can empty a pile that looked big from its count.
 * @param {string} itemId
 * @param {boolean} isTargeted - a pending craft wants it at a level
 * @param {number} inventoryEmptySlots
 * @returns {Array<object>}
 */
function selectRetrievableItems(itemId, isTargeted, inventoryEmptySlots) {
  let items = getItemBankSlots(itemId, true, isTargeted).filter(
    (item) => !item.l,
  );

  if (isTargeted) {
    const targetLevel = getCraftTargetLevel(itemId);
    items = items.filter((item) => (item.level ?? 0) < targetLevel);
  } else {
    // Clamped: a pile under its threshold keeps everything, and a bare
    // slice(0, negative) would count from the end and pull the low copies anyway
    const keep = getKeepThreshold(itemId);
    items = items.slice(0, Math.max(0, items.length - keep));
  }

  if (item_info({ name: itemId }).compound) {
    items = filterCompoundableSets(items, inventoryEmptySlots);
  }

  return items;
}

/**
 * Selects and retrieves the best batch of items from the bank to upgrade/compound.
 * Keeps at least 4 inventory slots free for scrolls/offerings.
 * Respects KEEP_THRESHOLD and RETRIEVE_HISTORY to rotate selections.
 * @returns {Promise<void>}
 */
async function retrievedBankItemToUpgrade() {
  let inventoryEmptySlots = character.esize - 4; // reserve 4 slots for scrolls/offerings

  // Crafting materials will outrank normal updates/compounds.
  const targetedItemId = Object.keys(CRAFT_LEVEL_TARGETS).find((id) =>
    getItemBankSlots(id, true, true).some(
      (item) => !item.l && (item.level ?? 0) < getCraftTargetLevel(id),
    ),
  );

  let desiredItemId = targetedItemId;
  let desiredItems = targetedItemId
    ? selectRetrievableItems(targetedItemId, true, inventoryEmptySlots)
    : [];

  // A climb that can't be advanced this trip hands the call back to the rotation
  if (!desiredItems.length) {
    desiredItemId = undefined;

    // Items with biggest count (total number of item, despise the level) first
    const candidates = Object.keys(ITEMS_HIGHEST_LEVEL)
      .filter((id) => {
        const info = item_info({ name: id });
        if (!info) return false;
        if (info.compound && inventoryEmptySlots < 3) return false;
        return !RETRIEVE_HISTORY.includes(id);
      })
      .sort(
        (lhs, rhs) =>
          ITEMS_HIGHEST_LEVEL[rhs].count - ITEMS_HIGHEST_LEVEL[lhs].count,
      );

    for (const id of candidates) {
      const items = selectRetrievableItems(id, false, inventoryEmptySlots);
      if (!items.length) continue;

      desiredItemId = id;
      desiredItems = items;
      break;
    }
  }

  if (!desiredItemId || !desiredItems.length) return;

  if (desiredItemId !== targetedItemId) {
    RETRIEVE_HISTORY.push(desiredItemId);
    if (
      RETRIEVE_HISTORY.length >=
      Object.keys(ITEMS_HIGHEST_LEVEL).length / 5
    ) {
      RETRIEVE_HISTORY.shift();
    }
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
    const itemLevel = item.level ?? 0;
    const targeted = isCraftTargeted(itemName);
    if (!targeted && IGNORE.includes(itemName)) continue;

    const itemInfo = item_info(item);
    if (!itemInfo.compound) continue;

    // A compound lands at level + 1, so stop one short of the deepest target
    if (targeted && itemLevel >= getCraftTargetLevel(itemName)) continue;

    // Don't eat the copies another recipe wants at this exact level
    if (countSpareAtLevel(itemName, itemLevel) < 3) continue;

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
      !targeted &&
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
  let selectedTargeted = false;

  for (let i = 0; i < character.items.length; i++) {
    const item = character.items[i];
    if (!item || item.l) continue;

    const itemLevel = item.level ?? 0;
    const targeted = isCraftTargeted(item.name);
    if (!targeted && IGNORE.includes(item.name)) continue;
    if (!item_info(item).upgrade) continue;
    if (targeted && itemLevel >= getCraftTargetLevel(item.name)) continue;

    // Don't eat the copy another recipe wants at this exact level
    if (countSpareAtLevel(item.name, itemLevel) < 1) continue;

    // Once a pending craft is in play nothing else is worth a scroll
    if (selectedTargeted && !targeted) continue;

    const itemGrade = item_grade(item);
    const highestLevel = ITEMS_HIGHEST_LEVEL[item.name];

    if (!targeted) {
      const overLeveled =
        // (item.level > maxUpgrade || itemGrade >= 2) &&
        item.level >= (highestLevel?.level ?? 0);
      const haveEnoughToSpare =
        highestLevel &&
        highestLevel.quantity > getKeepThreshold(item.name) &&
        item.level === highestLevel.level;

      if (overLeveled && !haveEnoughToSpare) continue;
    }

    if ((targeted && !selectedTargeted) || item.level < lowestLevel) {
      lowestLevel = item.level;
      itemIndex = i;
      selectedGrade = itemGrade;
      selectedHighestLevel = highestLevel;
      selectedTargeted = targeted;
    }
  }

  if (itemIndex === -1) return;

  const item = character.items[itemIndex];
  const itemName = item.name;
  // Targeted climbs never burn a primling: a break just costs another base item
  const isRareItem =
    !selectedTargeted &&
    (item.level >= 6 ||
      (item.level >= 4 && selectedGrade >= 1) ||
      selectedGrade >= 2);
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

        if (
          !selectedTargeted &&
          e.level >= (selectedHighestLevel?.level ?? 0) - 1
        ) {
          storeToBankFloor(findMaxLevelItem(itemName));
        }
      })
      .catch(() => {});
}
