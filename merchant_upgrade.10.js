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

  // new stuffs!
  cloverstud: 16,

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

/** Bag slots a pull leaves free */
const RETRIEVE_FREE_SLOTS = 8;

/** Bag slots a pull may fill */
const RETRIEVE_MAX_SLOTS = 12;

/** Bag slots one item may take of a pull */
const RETRIEVE_MAX_PER_ITEM = 6;

/** How long an item that made no progress is skipped */
const RETRIEVE_BACKOFF_MS = 10 * 60_000;

/** How long a pull gets before its progress is judged */
const RETRIEVE_SETTLE_MS = 60_000;

/** How long a pulled item takes to regain its priority */
const RETRIEVE_STALE_MS = 60 * 60_000;

/** Skipped items, name -> until when */
const RETRIEVE_BACKOFF = {};

/** Pulled items, name -> when */
const RETRIEVE_HISTORY = {};

/** The last pull and each item's bag levels right after it */
var LAST_RETRIEVED = { at: 0, signatures: {} };

// ---------------------------------------------------------------------------
// Upgrade/Compound Helpers
// ---------------------------------------------------------------------------

/**
 * An item's line in ITEMS_HIGHEST_LEVEL: titled copies (.p) are tracked apart.
 * @param {{ name: string, p?: string }} item
 * @returns {string} name, or name#p
 */
function getItemKey(item) {
  return item.p ? `${item.name}#${item.p}` : item.name;
}

/** @returns {string} the item name behind a getItemKey key */
function getKeyName(itemKey) {
  return itemKey.split("#")[0];
}

/** @returns {boolean} whether an item belongs to a getItemKey key */
function matchesItemKey(item, itemKey) {
  return !!item && getItemKey(item) === itemKey;
}

/**
 * Returns the keep threshold for an item line, falling back to its type.
 * @param {string} itemKey - see getItemKey
 * @returns {number}
 */
function getKeepThreshold(itemKey) {
  return (
    KEEP_THRESHOLD[getKeyName(itemKey)] ??
    KEEP_THRESHOLD[ITEMS_HIGHEST_LEVEL[itemKey]?.type] ??
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

  // A stashed stack is fetched on the next try, never bought over
  if (getItemBankSlots(scrollType, true).length) return -1;

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

    const key = getItemKey(item);
    const existing = ITEMS_HIGHEST_LEVEL[key];
    if (!existing) {
      ITEMS_HIGHEST_LEVEL[key] = {
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
  forEachBankSlot(processItem);
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
 * Bank slots worth pulling for one item line
 * @param {string} itemId - a craft target's name, or a getItemKey key
 * @param {boolean} isTargeted - a pending craft wants it at a level
 * @param {number} inventoryEmptySlots
 * @returns {Array<object>}
 */
function selectRetrievableItems(itemId, isTargeted, inventoryEmptySlots) {
  const name = getKeyName(itemId);
  let items = getItemBankSlots(name, true, isTargeted).filter(
    (item) => !item.l && (isTargeted || matchesItemKey(item, itemId)),
  );

  if (isTargeted) {
    const targetLevel = getCraftTargetLevel(name);
    items = items.filter((item) => (item.level ?? 0) < targetLevel);
  } else {
    // Clamped: a pile under its threshold keeps everything, and a bare
    // slice(0, negative) would count from the end and pull the low copies anyway
    const keep = getKeepThreshold(itemId);
    items = items.slice(0, Math.max(0, items.length - keep));
  }

  if (item_info({ name }).compound) {
    items = filterCompoundableSets(items, inventoryEmptySlots);
  }

  return items;
}

/**
 * Levels of an item line's unlocked bag copies.
 * @param {string} itemKey - see getItemKey
 * @returns {string}
 */
function getBagLevelSignature(itemKey) {
  return character.items
    .filter((item) => item && !item.l && matchesItemKey(item, itemKey))
    .map((item) => item.level ?? 0)
    .sort((lhs, rhs) => lhs - rhs)
    .join(",");
}

/**
 * Backs off the last pull's items whose bag copies never changed.
 * @returns {Set<string>} item keys the last pull brought out
 */
function settleLastRetrieve() {
  const names = new Set(Object.keys(LAST_RETRIEVED.signatures));
  if (Date.now() - LAST_RETRIEVED.at < RETRIEVE_SETTLE_MS) return names;

  for (const [name, signature] of Object.entries(LAST_RETRIEVED.signatures)) {
    if (getBagLevelSignature(name) === signature)
      RETRIEVE_BACKOFF[name] = Date.now() + RETRIEVE_BACKOFF_MS;
  }

  LAST_RETRIEVED = { at: 0, signatures: {} };
  return names;
}

/**
 * x3 if never pulled, else x1 after a pull recovering to x2.
 * @param {string} itemId
 * @returns {number}
 */
function getRetrieveFreshness(itemId) {
  const pulledAt = RETRIEVE_HISTORY[itemId];
  if (pulledAt === undefined) return 3;
  return 1 + Math.min(1, (Date.now() - pulledAt) / RETRIEVE_STALE_MS);
}

/**
 * How urgent a pull is: bank slots freed for compounds, copies for upgrades.
 * @param {string} itemId
 * @param {number} itemCount - retrievable copies
 * @returns {number}
 */
function scoreRetrieveCandidate(itemId, itemCount) {
  const base = item_info({ name: getKeyName(itemId) })?.compound
    ? (itemCount / 3) * 2 * (isBankFull ? 10 : 1)
    : itemCount;
  return base * getRetrieveFreshness(itemId);
}

/**
 * Pulls the most urgent items to upgrade/compound, craft targets first.
 * @returns {Promise<void>}
 */
async function retrievedBankItemToUpgrade() {
  let budget = Math.min(
    character.esize - RETRIEVE_FREE_SLOTS,
    RETRIEVE_MAX_SLOTS,
  );

  if (budget <= 0) {
    if (isBankFull) console.log("bank full and bag too full to compound");
    return;
  }

  const picked = [];
  const pickedIds = new Set();

  const take = (id, isTargeted) => {
    const limit = isTargeted ? budget : Math.min(budget, RETRIEVE_MAX_PER_ITEM);
    const items = selectRetrievableItems(id, isTargeted, limit).slice(0, limit);
    if (!items.length) return;

    budget -= items.length;
    picked.push(...items);
    pickedIds.add(id);
  };

  // Crafting materials will outrank normal updates/compounds.
  for (const id of Object.keys(CRAFT_LEVEL_TARGETS)) {
    if (budget <= 0) break;
    take(id, true);
  }

  const targetedIds = new Set(pickedIds);
  const now = Date.now();

  const candidates = Object.keys(ITEMS_HIGHEST_LEVEL)
    .filter(
      (id) =>
        !pickedIds.has(id) &&
        item_info({ name: getKeyName(id) }) &&
        !((RETRIEVE_BACKOFF[id] ?? 0) > now),
    )
    .map((id) => ({
      id,
      score: scoreRetrieveCandidate(
        id,
        selectRetrievableItems(id, false, Infinity).length,
      ),
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (lhs, rhs) =>
        rhs.score - lhs.score ||
        ITEMS_HIGHEST_LEVEL[rhs.id].count - ITEMS_HIGHEST_LEVEL[lhs.id].count,
    );

  for (const { id } of candidates) {
    if (budget <= 0) break;
    take(id, false);
  }

  if (!picked.length) return;

  // The scrolls they burn come along in the same visit
  const scrollNames = new Set(
    picked.map(
      (item) =>
        `${item_info(item).compound ? "cscroll" : "scroll"}${item_grade(item)}`,
    ),
  );
  const scrollSlots = [...scrollNames]
    .filter((name) => locate_item(name) === -1)
    .map((name) => getItemBankSlots(name, true)[0])
    .filter(Boolean);

  await retrieveAll([...picked, ...scrollSlots]);

  const signatures = {};
  for (const id of pickedIds) {
    if (targetedIds.has(id)) continue;
    signatures[id] = getBagLevelSignature(id);
    RETRIEVE_HISTORY[id] = Date.now();
  }
  LAST_RETRIEVED = { at: Date.now(), signatures };
}

// ---------------------------------------------------------------------------
// Compound
// ---------------------------------------------------------------------------

/**
 * Three unlocked inventory slots holding the same item line at the same level.
 * compound() takes arbitrary slots, so they need not sit side by side.
 * @param {string} itemKey - see getItemKey
 * @param {number} level
 * @returns {number[] | undefined}
 */
function findCompoundSet(itemKey, level) {
  const slots = [];

  for (let i = 0; i < character.items.length && slots.length < 3; i++) {
    const item = character.items[i];
    if (!item || item.l) continue;
    if (!matchesItemKey(item, itemKey) || (item.level ?? 0) !== level) continue;

    slots.push(i);
  }

  return slots.length === 3 ? slots : undefined;
}

/** Attempts to compound the first valid set of 3 identical items in inventory. */
async function compoundInv() {
  if (character.q.compound || character.q.exchange) return;
  if (isSortingInventory) return;

  pendingItemMutations++;
  try {
    return await findAndCompound();
  } finally {
    pendingItemMutations--;
  }
}

/** @returns {Promise<unknown>} compoundInv's body, run while it holds the sort hold-off */
async function findAndCompound() {
  for (let i = 0; i < character.items.length; i++) {
    const item = character.items[i];
    if (!item || item.l) continue;

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

    const itemKey = getItemKey(item);
    const compoundSlots = findCompoundSet(itemKey, itemLevel);
    if (!compoundSlots) continue;

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

    // Skip if we don't have enough of this item yet: a compound burns three of
    // the pile for one, so the tail has to survive it
    const highestLevel = ITEMS_HIGHEST_LEVEL[itemKey];
    if (
      !targeted &&
      highestLevel &&
      highestLevel.quantity < getKeepThreshold(itemKey) + 3 &&
      itemLevel === highestLevel.level
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

    return compound(...compoundSlots, scrollSlot, offeringSlot).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Upgrade
// ---------------------------------------------------------------------------

/** @returns {number} bag slot of an item line's highest copy, or -1 */
function findMaxLevelBagSlot(itemKey) {
  let best = -1;
  character.items.forEach((item, index) => {
    if (!matchesItemKey(item, itemKey)) return;
    if (best === -1 || (item.level ?? 0) > (character.items[best].level ?? 0))
      best = index;
  });
  return best;
}

/** Attempts to upgrade the lowest level upgradeable item in inventory. */
async function upgradeInv() {
  if (character.q.upgrade || character.q.exchange) return;
  if (isSortingInventory) return;

  pendingItemMutations++;
  try {
    return await findAndUpgrade();
  } finally {
    pendingItemMutations--;
  }
}

/** @returns {Promise<unknown>} upgradeInv's body, run while it holds the sort hold-off */
async function findAndUpgrade() {
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
    const itemKey = getItemKey(item);
    const highestLevel = ITEMS_HIGHEST_LEVEL[itemKey];

    if (!targeted) {
      const overLeveled =
        // (item.level > maxUpgrade || itemGrade >= 2) &&
        item.level >= (highestLevel?.level ?? 0);
      const haveEnoughToSpare =
        highestLevel &&
        highestLevel.quantity > getKeepThreshold(itemKey) &&
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
  const itemKey = getItemKey(item);
  // Neither a targeted climb nor vendor gear burns a primling: a break just
  // costs another base item, re-bought for a few hundred gold
  const isRareItem =
    !selectedTargeted &&
    !BUYABLE.includes(itemName) &&
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
          ITEMS_HIGHEST_LEVEL[itemKey] = {
            level: e.level,
            quantity: 1,
            ...item_info({ name: itemName }),
          };
        }

        if (
          !selectedTargeted &&
          e.level >= (selectedHighestLevel?.level ?? 0) - 1
        ) {
          storeToBankFloor(findMaxLevelBagSlot(itemKey));
        }
      })
      .catch(() => {});
}
