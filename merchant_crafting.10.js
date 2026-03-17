if (parent.caracAL) {
  parent.caracAL.load_scripts([
    "adventure-land-scripts-backup/basic_function.7.js",
  ]);
} else {
  load_code(7);
}

var BANK_CACHE = undefined;
const bankPosition = { map: "bank", x: 0, y: -280 };
const IGNORE_BANK_SLOTS = ["gold", "items8", "items9", "items10", "items11"];
const IGNORE_RARE_GOLD_THRESHOLD = 40e8;

const KEEP_THRESHOLD = {
  // Event specific
  lmace: 7,
  horsecapeg: 7,

  // Every character needs
  helmet: 3,
  pants: 3,
  gloves: 3,
  shoes: 3,
  chest: 3,
  cape: 4,

  // Class based
  weapon: 2,
  orb: 3,
  shield: 2, // warrior, 0 if unneccessary
  source: 2, // priest and mage
  staff: 3,

  // Class attribute based
  earring: 4,
  ring: 4,
  amulet: 2,
  belt: 2,
};
const ITEMS_HIGHEST_LEVEL = {};

const RETRIEVE_HISTORY = [];

async function retrieveBankItem(searchId, level = 0) {
  if (smart.moving || isAdvanceSmartMoving) return;

  if (character.map !== "bank") {
    await advanceSmartMove(bankPosition);
    BANK_CACHE = character.bank;
  }

  for (const [bankPack, items] of Object.entries(character.bank).filter(
    ([key, value]) => !IGNORE_BANK_SLOTS.includes(key),
  )) {
    const slot = items.findIndex(
      (item) =>
        item && item.name === searchId && (!level || level === item.level),
    );
    if (slot !== -1) {
      return bank_retrieve(bankPack, slot).then(
        () => (BANK_CACHE = character.bank),
      );
    }
  }
}

function retrieveMaxItemsLevel() {
  if (character.map !== "bank") return;

  // Reset cache
  for (const key in ITEMS_HIGHEST_LEVEL) {
    delete ITEMS_HIGHEST_LEVEL[key];
  }

  BANK_CACHE = character.bank;

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

  // Inventory
  character.items.forEach(processItem);

  // Bank
  for (const slot in character.bank ?? BANK_CACHE) {
    if (IGNORE_BANK_SLOTS.includes(slot)) continue;
    character.bank[slot].forEach(processItem);
  }
}

function getItemBankSlots(itemId) {
  if (!BANK_CACHE) return [];
  const result = [];
  for (const id in BANK_CACHE) {
    if (IGNORE_BANK_SLOTS.includes(id)) continue;
    BANK_CACHE[id].forEach((item, index) => {
      if (!item) return;
      if (item.name === itemId)
        result.push({
          ...item,
          slot: index,
          pack: id,
        });
    });
  }

  if (character.gold < IGNORE_RARE_GOLD_THRESHOLD)
    return result
      .filter((item) => item_grade(item) < 2)
      .sort((lhs, rhs) => lhs.level - rhs.level);

  return result.sort((lhs, rhs) => lhs.level - rhs.level);
}

function groupItemsByLevel(items) {
  return items.reduce((acc, item) => {
    (acc[item.level] = acc[item.level] ?? []).push(item);
    return acc;
  }, {});
}

function filterCompoundableSets(items, inventoryEmptySlots) {
  const byLevel = groupItemsByLevel(items);
  const result = [];

  for (const level in byLevel) {
    const group = byLevel[level];
    const setCount = Math.floor(group.length / 3);

    if (setCount > 0) {
      result.push(...group.slice(0, setCount * 3));
    }
  }

  const maxTake = Math.floor(inventoryEmptySlots / 3) * 3;

  return result.slice(0, maxTake);
}

function retrievedBankItemToUpgrade() {
  let desiredItemId;
  let maxItemCount = 0;
  let inventoryEmptySlots = character.esize - 4;

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
  if (RETRIEVE_HISTORY.length >= Object.keys(ITEMS_HIGHEST_LEVEL).length / 2) {
    RETRIEVE_HISTORY.shift();
  }

  let desiredItems = getItemBankSlots(desiredItemId);

  // Respect keep threshold
  const keep =
    KEEP_THRESHOLD[desiredItemId] ??
    KEEP_THRESHOLD[ITEMS_HIGHEST_LEVEL[desiredItemId].type] ??
    2;
  desiredItems = desiredItems.slice(0, desiredItems.length - keep);

  const info = item_info({ name: desiredItemId });
  if (info.compound) {
    desiredItems = filterCompoundableSets(desiredItems, inventoryEmptySlots);
  }

  const promises = [];
  for (const itemSlot of desiredItems) {
    if (inventoryEmptySlots <= 0) break;
    inventoryEmptySlots--;

    promises.push(bank_retrieve(itemSlot.pack, itemSlot.slot));
  }

  return withTimeout(Promise.allSettled(promises), 2500);
}

async function compoundInv() {
  if (character.q.compound || character.q.exchange) return;
  let i = 0;
  for (i; i < 42; i++) {
    let breakFlag = false;

    if (!character.items[i]) break;
    const itemName = character.items[i].name;
    if (IGNORE.includes(itemName)) continue;

    const itemInfo = item_info(character.items[i]);
    if (itemInfo.compound) {
      const compoundNameChecker = new Set([
        itemName,
        character.items[i + 1]?.name,
        character.items[i + 2]?.name,
      ]);

      const compoundLevelChecker = new Set([
        character.items[i].level,
        character.items[i + 1]?.level,
        character.items[i + 2]?.level,
      ]);

      const canCompound =
        compoundLevelChecker.size === 1 && compoundNameChecker.size === 1;

      if (!canCompound) continue;

      const itemGrade = item_grade(character.items[i]);
      const havePrimlingInBank = getItemBankSlots("offeringp").length > 0;
      const isRareItem =
        character.items[i].level >=
        (itemInfo.grades[0] > 0
          ? itemInfo.grades[0]
          : itemGrade >= 2
          ? 0
          : itemInfo.grades[0] + 2);

      if (isRareItem) {
        if (
          ITEMS_HIGHEST_LEVEL[itemName] &&
          ITEMS_HIGHEST_LEVEL[itemName].quantity <
            ((KEEP_THRESHOLD[itemName] ??
              KEEP_THRESHOLD[ITEMS_HIGHEST_LEVEL[itemName].type]) + 3 ?? 5) &&
          character.items[i].level === ITEMS_HIGHEST_LEVEL[itemName].level
        ) {
          continue;
        }
      }

      const scrollType = `cscroll${itemGrade}`;
      if (
        !character.c.fishing &&
        !character.c.mining &&
        getItemBankSlots(scrollType).length > 0
      ) {
        await retrieveBankItem(scrollType);
      }
      let scrollSlot = locate_item(scrollType);
      if (scrollSlot === -1) {
        if (itemGrade >= 2 && character.gold < IGNORE_RARE_GOLD_THRESHOLD)
          continue;

        try {
          await buy(scrollType, 1);
          scrollSlot = locate_item(scrollType);
        } catch (e) {
          breakFlag = true;
        }
      }

      if (
        canCompound &&
        isRareItem &&
        locate_item("offeringp") === -1 &&
        havePrimlingInBank &&
        !smart.moving
      ) {
        await retrieveBankItem("offeringp");
      }

      if (
        character.mp > 200 &&
        !is_on_cooldown("massproductionpp") &&
        !character.s.massproductionpp
      )
        use_skill("massproductionpp");

      if (
        character.mp > 20 &&
        !is_on_cooldown("massproduction") &&
        !character.s.massproduction
      )
        use_skill("massproduction");

      if (
        character.items[i] !== null &&
        compoundNameChecker.size === 1 &&
        compoundLevelChecker.size === 1
      ) {
        if (
          (!havePrimlingInBank ||
            !isRareItem ||
            locate_item("offeringp") !== -1) &&
          scrollSlot !== -1
        )
          return compound(
            i,
            i + 1,
            i + 2,
            scrollSlot,
            isRareItem && locate_item("offeringp") !== -1
              ? locate_item("offeringp")
              : undefined,
          )
            .then(() => {
              breakFlag = true;
            })
            .catch((e) => {
              breakFlag = true;
            });
      }
    }
    if (breakFlag) break;
  }
}

async function upgradeInv() {
  if (character.q.upgrade || character.q.exchange) return;

  for (let i = 0; i < character.items.length; i++) {
    let breakFlag = false;

    if (!character.items[i]) break;

    const itemInfo = item_info(character.items[i]);
    const itemGrade = item_grade(character.items[i]);
    const havePrimlingInBank = getItemBankSlots("offeringp").length > 0;
    const isRareItem =
      character.items[i].level >= 6 ||
      (character.items[i].level >= 4 && itemGrade >= 1) ||
      itemGrade >= 2;

    const itemName = character.items[i].name;
    if (IGNORE.includes(itemName)) continue;

    if (itemInfo.upgrade) {
      if (
        (character.items[i]?.level > maxUpgrade || itemGrade >= 2) &&
        character.items[i]?.level >= (ITEMS_HIGHEST_LEVEL[itemName]?.level ?? 0)
      )
        if (
          !(
            ITEMS_HIGHEST_LEVEL[itemName] &&
            ITEMS_HIGHEST_LEVEL[itemName].quantity >
              (KEEP_THRESHOLD[itemName] ??
                KEEP_THRESHOLD[ITEMS_HIGHEST_LEVEL[itemName].type] ??
                2) &&
            character.items[i]?.level === ITEMS_HIGHEST_LEVEL[itemName].level
          )
        ) {
          continue;
        }

      if (
        isRareItem &&
        locate_item("offeringp") === -1 &&
        havePrimlingInBank &&
        !smart.moving
      ) {
        await retrieveBankItem("offeringp");
      }

      const scrollType = `scroll${itemGrade}`;
      if (
        !character.c.fishing &&
        !character.c.mining &&
        getItemBankSlots(scrollType).length > 0 &&
        character.esize
      ) {
        await retrieveBankItem(scrollType);
      }
      let scrollSlot = locate_item(scrollType);
      if (scrollSlot === -1) {
        if (itemGrade >= 2 && character.gold < IGNORE_RARE_GOLD_THRESHOLD)
          continue;

        try {
          await buy(scrollType, 1);
          scrollSlot = locate_item(scrollType);
        } catch (e) {
          breakFlag = true;
        }
      }

      if (
        character.mp > 200 &&
        !is_on_cooldown("massproductionpp") &&
        character.items[i]?.level >= 1 &&
        !character.s.massproductionpp
      ) {
        if (character.mp < 1000 && locate_item("mpot1") === -1) {
          buy("mpot1", 1);
        }
        use_skill("massproductionpp");
      }

      if (
        character.mp > 20 &&
        !is_on_cooldown("massproduction") &&
        !character.s.massproduction
      )
        use_skill("massproduction");

      if (
        (!havePrimlingInBank ||
          !isRareItem ||
          locate_item("offeringp") !== -1) &&
        scrollSlot !== -1
      )
        return upgrade(
          i,
          scrollSlot,
          isRareItem && locate_item("offeringp") !== -1
            ? locate_item("offeringp")
            : undefined,
        )
          .then(async (e) => {
            if (e?.success === true) {
              if (e?.level > (ITEMS_HIGHEST_LEVEL[itemName].level ?? 0))
                ITEMS_HIGHEST_LEVEL[itemName] = {
                  level: e?.level,
                  quantity: 1,
                  ...item_info({ name: itemName }),
                };

              if (e?.level >= (ITEMS_HIGHEST_LEVEL[itemName].level - 1 ?? 0)) {
                smart_move(bankPosition).then(() =>
                  bank_store(findMaxLevelItem(itemName)),
                );
              }
            }
            breakFlag = true;
          })
          .catch((e) => {
            breakFlag = true;
          });
    }

    if (breakFlag) break;
  }
}

if (Object.keys(ITEMS_HIGHEST_LEVEL).length === 0) {
  smart_move(bankPosition).then(() => {
    retrieveMaxItemsLevel();
    retrievedBankItemToUpgrade();
  });
}

async function bankLoop() {
  let delay = 120000;
  try {
    if (Object.keys(ITEMS_HIGHEST_LEVEL).length === 0) {
      await advanceSmartMove(bankPosition);
      retrieveMaxItemsLevel();
      await retrievedBankItemToUpgrade();
      delay = 60000;
      return;
    }

    if (onDuty || shouldGoChilling()) {
      delay = 5000;
      return;
    }

    onDuty = true;
    await advanceSmartMove(bankPosition);
    BANK_CACHE = character.bank;
    const promises = [];
    character.items.forEach((item, index) => {
      if (!item) return;
      const isRareItem = item_grade(item) >= 2;
      const isHighLevelItem =
        item.level >= (ITEMS_HIGHEST_LEVEL[item.name]?.level ?? 1) - 1;

      const isStoreable = STORE_ABLE.includes(item.name);
      const isEquipable = item_info(item).compound || item_info(item).upgrade;
      const shouldItemBeIgnore = IGNORE.includes(item.name);

      if (
        (!shouldItemBeIgnore &&
          (isRareItem || (isEquipable && isHighLevelItem))) ||
        isStoreable ||
        RETRIEVE_HISTORY.includes(item.name)
      )
        promises.push(bank_store(index));
    });
    await withTimeout(Promise.allSettled(promises), 2500);
    retrieveMaxItemsLevel();
    await retrievedBankItemToUpgrade();
    await retrieveBankItem("gemfragment");
  } catch (e) {
    console.warn("bank loop error:", e);
    delay = 15000;
  } finally {
    onDuty = false;
    return setTimeout(bankLoop, delay);
  }
}
bankLoop();

// Push bank data to earth's API
const syncBankData = async () => {
  try {
    if (!BANK_CACHE) throw new Error("Have yet enter the bank once!");
    const url = `https://aldata.earthiverse.ca/bank/${character.owner}/${character.name}`;
    const settings = {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...BANK_CACHE, inv: character.items }),
    };

    await fetch(url, settings);
    console.log(
      "Bank & inventory data synced to aldata.earthiverse.ca successfully!",
    );
  } catch (error) {
    console.error("Sync failed:", error);
  } finally {
    setTimeout(syncBankData, 60000);
  }
};
syncBankData();
