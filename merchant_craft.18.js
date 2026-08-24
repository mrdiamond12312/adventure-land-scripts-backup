// Crafting: the level targets pending recipes register, and craft() itself.

/**
 * Ingredients pending crafts need, as name -> { [level]: quantity }.
 * A level 0 entry is a reservation — the pickaxe wants a plain staff, so one has
 * to survive a gstaff climb. Entries above 0 are climb targets and bypass IGNORE.
 * Written by craft(), read by the upgrade, compound, retrieve and store routines.
 */
const CRAFT_LEVEL_TARGETS = {};

/** Cap on vendor items bought to fill one craft target, per recipe check. */
const MAX_CRAFT_BUY = 27;

// ---------------------------------------------------------------------------
// Craft Level Targets
// ---------------------------------------------------------------------------

/**
 * @param {string} itemName
 * @returns {number} deepest level any pending craft wants, or -1 if none
 */
function getCraftTargetLevel(itemName) {
  const target = CRAFT_LEVEL_TARGETS[itemName];
  if (!target) return -1;

  return Object.keys(target).reduce((max, level) => Math.max(max, +level), -1);
}

/**
 * @param {string} itemName
 * @param {number} level
 * @returns {number} copies at exactly that level a pending craft is holding
 */
function getCraftReserved(itemName, level) {
  return CRAFT_LEVEL_TARGETS[itemName]?.[level] ?? 0;
}

/**
 * Copies at a level that upgrade/compound may consume without stranding a craft.
 * @param {string} itemName
 * @param {number} level
 * @returns {number}
 */
function countSpareAtLevel(itemName, level) {
  return countItemsAtLevel(itemName, level) - getCraftReserved(itemName, level);
}

/**
 * @param {string} itemName
 * @returns {boolean} whether a pending craft wants this item above level 0
 */
function isCraftTargeted(itemName) {
  return getCraftTargetLevel(itemName) > 0;
}

/**
 * @param {string} itemName
 * @returns {boolean} whether a pending craft wants this item at any level
 */
function isCraftIngredient(itemName) {
  return CRAFT_LEVEL_TARGETS[itemName] !== undefined;
}

/**
 * Raises the quantity wanted at one level, never lowers it. Levels are tracked
 * separately so threadneedle's blade +5 and wblade's blade +9 both stand instead
 * of collapsing into a single deepest target.
 * @param {string} itemName
 * @param {number} level
 * @param {number} quantity
 */
function requestCraftLevel(itemName, level, quantity) {
  const target = (CRAFT_LEVEL_TARGETS[itemName] =
    CRAFT_LEVEL_TARGETS[itemName] ?? {});

  target[level] = Math.max(target[level] ?? 0, quantity);
}

/**
 * Drops one level's entry, and the item itself once nothing wants it.
 * @param {string} itemName
 * @param {number} level
 */
function releaseCraftLevel(itemName, level) {
  const target = CRAFT_LEVEL_TARGETS[itemName];
  if (!target) return;

  delete target[level];
  if (!Object.keys(target).length) delete CRAFT_LEVEL_TARGETS[itemName];
}

/**
 * @param {string} itemName
 * @param {number} [level=0]
 * @returns {number} count of unlocked inventory items at exactly that level
 */
function countInventoryAtLevel(itemName, level = 0) {
  return character.items.reduce(
    (total, item) =>
      item?.name === itemName && (item.level ?? 0) === level && !item.l
        ? total + (item.q ?? 1)
        : total,
    0,
  );
}

/**
 * Visits every unlocked copy of an item across inventory and bank.
 * Reads BANK_CACHE directly rather than going through getItemBankSlots, whose
 * rare-grade filter would hide a harbringer +8 we already own whenever gold is
 * below IGNORE_RARE_GOLD_THRESHOLD.
 * @param {string} itemName
 * @param {(item: object) => void} visit
 */
function forEachOwnedItem(itemName, visit) {
  const consider = (item) => {
    if (item?.name === itemName && !item.l) visit(item);
  };

  character.items.forEach(consider);

  for (const pack in BANK_CACHE ?? {}) {
    if (pack === "gold") continue;
    BANK_CACHE[pack].forEach(consider);
  }
}

/**
 * @param {string} itemName
 * @param {number} [level=0]
 * @returns {number} count across inventory and bank at exactly that level
 */
function countItemsAtLevel(itemName, level = 0) {
  let count = 0;
  forEachOwnedItem(itemName, (item) => {
    if ((item.level ?? 0) === level) count += item.q ?? 1;
  });

  return count;
}

/**
 * Raw stock for a target, in level-0 equivalents: a compound eats three items
 * per level, so one +2 is worth nine +0. Upgrades consume one item per attempt,
 * so every owned copy counts as one.
 * @param {string} itemName
 * @param {number} level - target level; anything above it is not raw material
 * @returns {number}
 */
function countCraftStock(itemName, level) {
  const isCompound = !!item_info({ name: itemName })?.compound;
  let stock = 0;

  forEachOwnedItem(itemName, (item) => {
    const itemLevel = item.level ?? 0;
    if (itemLevel > level) return;
    stock += isCompound ? 3 ** itemLevel : 1;
  });

  return stock;
}

/**
 * Level-0 equivalents every pending craft of this item adds up to, across all
 * the levels wanted at once — a staff reserved at +0 plus one climbing to +8 is
 * two staves, not one.
 * @param {string} itemName
 * @returns {number}
 */
function countCraftStockNeeded(itemName) {
  const target = CRAFT_LEVEL_TARGETS[itemName];
  if (!target) return 0;

  const isCompound = !!item_info({ name: itemName })?.compound;

  return Object.entries(target).reduce(
    (total, [level, quantity]) =>
      total + quantity * (isCompound ? 3 ** +level : 1),
    0,
  );
}

// ---------------------------------------------------------------------------
// Craft
// ---------------------------------------------------------------------------

/**
 * Ingredient check for a recipe entry with no level, e.g. [80, "stormfeather"].
 * Reserves the quantity at level 0 so a climb elsewhere can't consume it — a
 * gstaff chasing staff +8 must leave the pickaxe its plain staff.
 * @param {string} name
 * @param {number} quantity
 * @param {Array<{ name: string, level: number }>} fromBank - filled with bank pulls
 * @param {string[]} vendorBuy - filled with vendor purchases
 * @returns {boolean} whether the ingredient can be covered
 */
function hasFlatIngredient(name, quantity, fromBank, vendorBuy) {
  requestCraftLevel(name, 0, quantity);

  // Level 0 on both sides: an unlevelled entry means a plain item, and counting
  // a levelled one here would feed it to auto_craft
  const slots = character.items.filter(
    (item) => item && item.name === name && !item.level,
  );
  // includeRare: an ingredient we already own is stock, not loot the rare-grade
  // filter should hide from us while gold is low — same call as forEachOwnedItem
  const bankSlots = getItemBankSlots(name, true, true).filter(
    (item) => !item.level,
  );

  const totalQuantityOfSlotItem = slots.reduce(
    (accumulator, current) => accumulator + (current.q ?? 1),
    0,
  );

  const totalQuantityOfBankItem = bankSlots.reduce(
    (accumulator, current) => accumulator + (current.q ?? 1),
    0,
  );

  let numberOfItemMissing = quantity - totalQuantityOfSlotItem;

  if (BUYABLE.includes(name) && totalQuantityOfBankItem < numberOfItemMissing) {
    for (
      let count = 0;
      count < numberOfItemMissing - totalQuantityOfBankItem;
      count++
    ) {
      vendorBuy.push(name);
      numberOfItemMissing--;
    }
  }

  if (numberOfItemMissing > 0 && totalQuantityOfBankItem > 0) {
    for (const bankItem of bankSlots) {
      if (numberOfItemMissing <= 0) break;

      const available = bankItem.q ?? 1;
      const takeAmount = Math.min(available, numberOfItemMissing);

      fromBank.push({ name, level: bankItem.level });

      numberOfItemMissing -= takeAmount;
    }
  }

  return (
    totalQuantityOfSlotItem + totalQuantityOfBankItem >= quantity ||
    BUYABLE.includes(name)
  );
}

/**
 * Ingredient check for a recipe entry that pins a level, e.g. [1, "alloyquiver", 5].
 * Registers a craft target so upgradeInv/compoundInv lift raw stock up to that
 * level, and releases it once the level is on hand or out of reach.
 * @param {string} name
 * @param {number} level
 * @param {number} quantity
 * @param {Array<{ name: string, level: number }>} fromBank - filled with bank pulls
 * @param {string[]} targetBuy - filled with base items to buy for the climb
 * @returns {boolean} whether the ingredient is already on hand at that level
 */
function hasLeveledIngredient(name, level, quantity, fromBank, targetBuy) {
  // Registered before the stock check so the shortfall accounts for every level
  // this item is wanted at, not just this one
  requestCraftLevel(name, level, quantity);

  // The entry stays registered once reached: it becomes the reservation that
  // keeps a deeper climb of the same item from consuming it
  if (countItemsAtLevel(name, level) >= quantity) {
    let missing = quantity - countInventoryAtLevel(name, level);
    while (missing-- > 0) fromBank.push({ name, level });

    return true;
  }

  const canBuy = BUYABLE.includes(name);
  const shortfall =
    countCraftStockNeeded(name) -
    countCraftStock(name, getCraftTargetLevel(name));

  if (shortfall > 0 && !(canBuy && shortfall <= MAX_CRAFT_BUY)) {
    releaseCraftLevel(name, level);
    return false;
  }

  const buyCount = Math.min(shortfall, character.esize - 4);
  for (let count = 0; count < buyCount; count++) targetBuy.push(name);

  return false;
}

/**
 * How many copies the flat ingredients already on hand cover. Buyable entries
 * don't bound it (a vendor tops them up) and levelled ones can't — their climb
 * is what registering the target is *for*.
 * @param {string} item
 * @param {number} wanted
 * @returns {number} copies coverable, capped at `wanted`
 */
function getCoveredCraftQuantity(item, wanted) {
  let covered = wanted;

  for (const [quantity, name, level] of G.craft[item].items) {
    if (level || BUYABLE.includes(name)) continue;

    const owned = countItemsAtLevel(name, 0);
    covered = Math.min(covered, Math.floor(owned / quantity));
  }

  return covered;
}

async function craft(item, craftQuantity = 1, place = find_npc("craftsman")) {
  // Check if craftable
  if (
    onDuty ||
    isInvFull(4) ||
    character.c.mining ||
    character.c.fishing ||
    craftQuantity < 1
  )
    return;

  if (!G.craft[item]) {
    log("Uncraftable/Invalid item id!");
    return;
  }

  // The ingredient check below is all-or-nothing, so a batch bigger than what
  // we hold skips the craft entirely rather than making the few we can. Falls
  // through unclamped at 0 so the levelled ingredients still register a climb.
  const coveredQuantity = getCoveredCraftQuantity(item, craftQuantity);
  if (coveredQuantity >= 1) craftQuantity = coveredQuantity;

  const fromBank = [];
  const vendorBuy = [];
  const targetBuy = [];

  // map before every: short-circuiting would leave a later levelled ingredient
  // unregistered, so its climb would never start
  const isEnoughIngredients = G.craft[item].items
    .map(([quantity, name, level]) =>
      level
        ? hasLeveledIngredient(
            name,
            level,
            quantity * craftQuantity,
            fromBank,
            targetBuy,
          )
        : hasFlatIngredient(name, quantity * craftQuantity, fromBank, vendorBuy),
    )
    .every(Boolean);

  // Runs even when the craft can't fire yet — the climb needs the base items now
  if (targetBuy.length) {
    await Promise.all(targetBuy.map((id) => buy(id).catch(() => {})));
  }

  if (vendorBuy.length && isEnoughIngredients) {
    await Promise.all(vendorBuy.map((id) => buy(id)));
  }

  if (fromBank.length && isEnoughIngredients) {
    for (const ingredient of fromBank) {
      await retrieveBankItem(ingredient.name, ingredient.level);
    }
  }

  if (isEnoughIngredients) {
    const hasComputer = haveAComputer();

    if (
      !isAdvanceSmartMoving &&
      !smart.moving &&
      ((!hasComputer && get_nearest_npc()?.name !== "Leo") ||
        (hasComputer && character.map.includes("bank")))
    ) {
      await advanceSmartMove(place, { useBlink: false, useMagiport: false });
    }

    for (let trial = 0; trial < craftQuantity; trial++) await auto_craft(item);
    return;
  }
}
