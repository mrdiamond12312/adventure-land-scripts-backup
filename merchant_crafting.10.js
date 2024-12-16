load_code(7);

let BANK_CACHE = undefined;
const bankPosition = { map: "bank", x: 0, y: -280 };

const IGNORE_RARE_GOLD_THRESHOLD = 3e8;

const KEEP_THRESHOLD = {
  // Every character needs
  helmet: 3,
  pants: 3,
  gloves: 3,
  shoes: 3,
  chest: 3,
  cape: 3,

  // Class based
  weapon: 2,
  orb: 2,
  shield: 3, // warrior, 0 if unneccessary
  source: 2, // priest and mage

  // Class attribute based
  earring: 4,
  ring: 4,
  amulet: 2,
  belt: 2,
};
const ITEMS_HIGHEST_LEVEL = {};

const RETRIEVE_HISTORY = [];

async function retrieveMaxItemsLevel() {
  if (character.map !== "bank") return;

  // Reset counter;
  Object.keys(ITEMS_HIGHEST_LEVEL).forEach(
    (key) => delete ITEMS_HIGHEST_LEVEL[key]
  );

  BANK_CACHE = character.bank;

  character.items
    .filter((item) => item && !item.q && !ignore.includes(item.name))
    .forEach((item) => {
      if (item.q) return;

      if (!ITEMS_HIGHEST_LEVEL[item.name]) {
        ITEMS_HIGHEST_LEVEL[item.name] = {
          level: item.level,
          quantity: 1,
          count: 1,
          ...item_info(item),
        };
      } else {
        if (item.level > ITEMS_HIGHEST_LEVEL[item.name].level) {
          ITEMS_HIGHEST_LEVEL[item.name].level = item.level;
          ITEMS_HIGHEST_LEVEL[item.name].quantity = 1;
        } else if (item.level === ITEMS_HIGHEST_LEVEL[item.name].level)
          ITEMS_HIGHEST_LEVEL[item.name].quantity++;

        ITEMS_HIGHEST_LEVEL[item.name].count++;
      }
    });

  for (slot in character.bank) {
    if (slot === "gold") continue;

    character.bank[slot]
      .filter((item) => item && !item.q && !ignore.includes(item.name))
      .forEach((item) => {
        if (item.q) return;

        if (!ITEMS_HIGHEST_LEVEL[item.name]) {
          ITEMS_HIGHEST_LEVEL[item.name] = {
            level: item.level,
            quantity: 1,
            count: 1,
            ...item_info(item),
          };
        } else {
          if (item.level > ITEMS_HIGHEST_LEVEL[item.name].level) {
            ITEMS_HIGHEST_LEVEL[item.name].level = item.level;
            ITEMS_HIGHEST_LEVEL[item.name].quantity = 1;
          } else if (item.level === ITEMS_HIGHEST_LEVEL[item.name].level)
            ITEMS_HIGHEST_LEVEL[item.name].quantity++;

          ITEMS_HIGHEST_LEVEL[item.name].count++;
        }
      });
  }
}

function getItemBankSlots(itemId) {
  if (!BANK_CACHE) return [];
  const result = [];
  for (id in BANK_CACHE) {
    if (id === "gold") continue;
    character.bank[id].forEach((item, index) => {
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

function retrievedBankItemToUpgrade() {
  let desiredItemId = undefined;
  let maxItemCount = 0;
  for (id in ITEMS_HIGHEST_LEVEL) {
    if (
      ITEMS_HIGHEST_LEVEL[id].count > maxItemCount &&
      !RETRIEVE_HISTORY.includes(id)
    ) {
      maxItemCount = ITEMS_HIGHEST_LEVEL[id].count;
      desiredItemId = id;
    }
  }

  RETRIEVE_HISTORY.push(desiredItemId);
  if (RETRIEVE_HISTORY.length > Object.keys(ITEMS_HIGHEST_LEVEL).length / 1.5)
    RETRIEVE_HISTORY.shift();

  let desiredItems = getItemBankSlots(desiredItemId);
  desiredItems = desiredItems.splice(
    0,
    desiredItems.length -
      KEEP_THRESHOLD[ITEMS_HIGHEST_LEVEL[desiredItemId].type]
  );

  let inventoryEmptySlots = character.items.filter((item) => !item).length - 5;

  for (const itemSlot of desiredItems) {
    if (inventoryEmptySlots <= 0) break;
    else inventoryEmptySlots--;

    bank_retrieve(itemSlot.pack, itemSlot.slot);
  }
}

async function compoundInv() {
  let inv = character.items;

  if (character.q.compound) return;

  for (let i = 0; i < inv.length; i++) {
    let breakFlag = false;

    if (inv[i] && (inv[i]?.level > 2 || item_grade(inv[i]) === 2))
      if (
        !(
          ITEMS_HIGHEST_LEVEL[inv[i]?.name] &&
          ITEMS_HIGHEST_LEVEL[inv[i]?.name].quantity >
            KEEP_THRESHOLD[ITEMS_HIGHEST_LEVEL[inv[i]?.name].type] &&
          inv[i]?.level === ITEMS_HIGHEST_LEVEL[inv[i]?.name].level
        )
      )
        continue;

    if (item_info(inv[i]).compound) {
      const scrollType = `cscroll${item_grade(inv[i])}`;
      let scrollSlot = locate_item(scrollType);
      if (scrollSlot === -1) {
        if (
          item_grade(inv[i]) >= 2 &&
          character.gold < IGNORE_RARE_GOLD_THRESHOLD
        )
          continue;
        buy(scrollType, 1)
          .then(() => {
            scrollSlot = locate_item(scrollType);
          })
          .catch((e) => {
            breakFlag = true;
          });
      }

      if (character.mp > 20 && !is_on_cooldown("massproduction"))
        use_skill("massproduction");

      if (
        inv[i] !== null &&
        new Set([inv[i]?.name, inv[i + 1]?.name, inv[i + 2]?.name]).size ===
          1 &&
        new Set([inv[i]?.level, inv[i + 1]?.level, inv[i + 2]?.level]).size ===
          1
      )
        compound(i, i + 1, i + 2, scrollSlot)
          .then((e) => {
            breakFlag = true;
          })
          .catch((e) => e);
    }
    if (breakFlag) break;
  }
}

async function upgradeInv() {
  let inv = character.items;

  if (character.q.upgrade) return;

  for (let i = 0; i < inv.length; i++) {
    let breakFlag = false;
    if (ignore.includes(inv[i].name)) continue;

    if (
      inv[i] &&
      (inv[i]?.level > maxUpgrade || item_grade(inv[i]) === 2) &&
      inv[i]?.level >= ITEMS_HIGHEST_LEVEL[inv[i]?.name].level
    )
      if (
        !(
          ITEMS_HIGHEST_LEVEL[inv[i]?.name] &&
          ITEMS_HIGHEST_LEVEL[inv[i]?.name].quantity >
            KEEP_THRESHOLD[ITEMS_HIGHEST_LEVEL[inv[i]?.name].type] &&
          inv[i]?.level === ITEMS_HIGHEST_LEVEL[inv[i]?.name].level
        )
      )
        continue;

    if (item_info(inv[i]).upgrade) {
      const scrollType = `scroll${item_grade(inv[i])}`;
      let scrollSlot = locate_item(scrollType);
      if (scrollSlot === -1) {
        if (
          item_grade(inv[i]) >= 2 &&
          character.gold < IGNORE_RARE_GOLD_THRESHOLD
        )
          continue;

        buy(scrollType, 1)
          .then(() => {
            scrollSlot = locate_item(scrollType);
          })
          .catch((e) => {
            breakFlag = true;
          });
      }
      if (character.mp > 20 && !is_on_cooldown("massproduction"))
        use_skill("massproduction");

      upgrade(i, scrollSlot)
        .then(async (e) => {
          if (e?.success === true) {
            if (e?.level > ITEMS_HIGHEST_LEVEL[inv[i]?.name].level)
              ITEMS_HIGHEST_LEVEL[item.name] = {
                level: item.level,
                quantity: 1,
                ...item_info(item),
              };

            if (e?.level >= ITEMS_HIGHEST_LEVEL[inv[i]?.name].level - 1) {
              close_stand();
              smart_move(bankPosition).then(() =>
                bank_store(
                  character.items.findIndex(
                    (item) =>
                      item &&
                      item.name === inv[i].name &&
                      item.level === e?.level
                  )
                )
              );
            }
          }
          breakFlag = true;
        })
        .catch((e) => e);
    }
    if (breakFlag) break;
  }
}

if (Object.keys(ITEMS_HIGHEST_LEVEL).length === 0) {
  close_stand();
  smart_move(bankPosition).then(() => {
    retrieveMaxItemsLevel();
    retrievedBankItemToUpgrade();
  });
}
setInterval(() => {
  if (
    character.map === "main" &&
    !onDuty &&
    !character.q.exchange &&
    !character.c.fishing &&
    !character.c.mining
  ) {
    onDuty = true;
    close_stand();
    smart_move(bankPosition).then(() => {
      character.items.forEach((item, index) => {
        const isRareItem = item_grade(item) >= 2;
        const isHighLevelItem =
          item?.level >= (ITEMS_HIGHEST_LEVEL[item.name]?.level ?? 1) - 1;

        const isStoreable = storeAble.includes(item.name);
        const isEquipable = item_info(item).compound || item_info(item).upgrade;
        const shouldItemBeIgnore = ignore.includes(item.name);

        if (
          item &&
          ((!shouldItemBeIgnore &&
            (isRareItem || (isEquipable && isHighLevelItem))) ||
            isStoreable)
        )
          bank_store(index);
      });
      retrieveMaxItemsLevel();
      retrievedBankItemToUpgrade();

      onDuty = false;
    });
  }
}, 15000);
