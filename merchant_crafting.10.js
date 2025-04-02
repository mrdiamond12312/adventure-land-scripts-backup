load_code(7);

let BANK_CACHE = undefined;
const bankPosition = { map: "bank", x: 0, y: -280 };

const IGNORE_RARE_GOLD_THRESHOLD = 18e8;

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
  staff: 4,

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
  if (RETRIEVE_HISTORY.length >= Object.keys(ITEMS_HIGHEST_LEVEL).length - 1)
    RETRIEVE_HISTORY.shift();

  let desiredItems = getItemBankSlots(desiredItemId);
  desiredItems = desiredItems.splice(
    0,
    desiredItems.length -
      (KEEP_THRESHOLD[ITEMS_HIGHEST_LEVEL[desiredItemId].type] ?? 2)
  );

  let inventoryEmptySlots = character.items.filter((item) => !item).length - 4;

  for (const itemSlot of desiredItems) {
    if (inventoryEmptySlots <= 0) break;
    else inventoryEmptySlots--;

    bank_retrieve(itemSlot.pack, itemSlot.slot);
  }
}

async function compoundInv() {
  if (character.q.compound) return;
  let i = 0;
  for (i; i < 42; i++) {
    let breakFlag = false;

    if (!character.items[i]) break;
    
    if (item_info(character.items[i]).compound) {
      if (
        character.items[i] &&
        (character.items[i]?.level > 2 || item_grade(character.items[i]) === 2)
      )
        if (
          !(
            ITEMS_HIGHEST_LEVEL[character.items[i]?.name] &&
            ITEMS_HIGHEST_LEVEL[character.items[i]?.name].quantity >
              (KEEP_THRESHOLD[
                ITEMS_HIGHEST_LEVEL[character.items[i]?.name].type
              ] ?? 2) &&
            character.items[i]?.level ===
              ITEMS_HIGHEST_LEVEL[character.items[i]?.name].level
          )
        ) {
          continue;
        }

      const scrollType = `cscroll${item_grade(character.items[i])}`;
      let scrollSlot = locate_item(scrollType);
      if (scrollSlot === -1) {
        if (
          item_grade(character.items[i]) >= 2 &&
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

      if (
        character.mp > 200 &&
        !is_on_cooldown("massproductionpp") &&
        character.items[i]?.level >= 4 &&
        !character.s.massproductionpp
      )
        use_skill("massproductionpp");
      else if (
        character.mp > 20 &&
        !is_on_cooldown("massproduction") &&
        !character.s.massproduction &&
        !character.s.massproductionpp
      )
        use_skill("massproduction");

      if (
        character.items[i] !== null &&
        new Set([
          character.items[i]?.name,
          character.items[i + 1]?.name,
          character.items[i + 2]?.name,
        ]).size === 1 &&
        new Set([
          character.items[i]?.level,
          character.items[i + 1]?.level,
          character.items[i + 2]?.level,
        ]).size === 1
      ) {
        return compound(i, i + 1, i + 2, scrollSlot)
          .then((e) => {
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
  if (character.q.upgrade) return;

  for (let i = 0; i < character.items.length; i++) {
    let breakFlag = false;

    if (!character.items[i]) break;

    if (ignore.includes(character.items[i].name)) continue;

    if (item_info(character.items[i]).upgrade) {
      if (
        character.items[i] &&
        (character.items[i]?.level > maxUpgrade ||
          item_grade(character.items[i]) === 2) &&
        character.items[i]?.level >=
          ITEMS_HIGHEST_LEVEL[character.items[i]?.name].level
      )
        if (
          !(
            ITEMS_HIGHEST_LEVEL[character.items[i]?.name] &&
            ITEMS_HIGHEST_LEVEL[character.items[i]?.name].quantity >
              (KEEP_THRESHOLD[
                ITEMS_HIGHEST_LEVEL[character.items[i]?.name].type
              ] ?? 2) &&
            character.items[i]?.level ===
              ITEMS_HIGHEST_LEVEL[character.items[i]?.name].level
          )
        ) {
          continue;
        }
      const scrollType = `scroll${item_grade(character.items[i])}`;
      let scrollSlot = locate_item(scrollType);
      if (scrollSlot === -1) {
        if (
          item_grade(character.items[i]) >= 2 &&
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

      if (
        character.mp > 200 &&
        !is_on_cooldown("massproductionpp") &&
        character.items[i]?.level >= 4 &&
        !character.s.massproductionpp
      )
        use_skill("massproductionpp");
      else if (
        character.mp > 20 &&
        !is_on_cooldown("massproduction") &&
        !character.s.massproduction &&
        !character.s.massproductionpp
      )
        use_skill("massproduction");

      return upgrade(i, scrollSlot)
        .then(async (e) => {
          if (e?.success === true) {
            if (e?.level > ITEMS_HIGHEST_LEVEL[character.items[i]?.name].level)
              ITEMS_HIGHEST_LEVEL[item.name] = {
                level: item.level,
                quantity: 1,
                ...item_info(item),
              };

            if (
              e?.level >=
              ITEMS_HIGHEST_LEVEL[character.items[i]?.name].level - 1
            ) {
              close_stand();
              smart_move(bankPosition).then(() =>
                bank_store(
                  character.items.findIndex(
                    (item) =>
                      item &&
                      item.name === character.items[i].name &&
                      item.level === e?.level
                  )
                )
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
    !character.c.mining &&
    !(
      !is_on_cooldown("fishing") &&
      (locate_item("rod") !== -1 || character.slots.mainhand?.name === "rod")
    ) &&
    !(
      !is_on_cooldown("mining") &&
      (locate_item("pickaxe") !== -1 ||
        character.slots.mainhand?.name === "pickaxe")
    )
  ) {
    onDuty = true;
    close_stand();
    smart_move(bankPosition).then(() => {
      character.items.forEach((item, index) => {
        if (!item) return;
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
            isStoreable ||
            RETRIEVE_HISTORY?.[RETRIEVE_HISTORY.length - 1] === item?.name)
        )
          bank_store(index);
      });
      retrieveMaxItemsLevel();
      retrievedBankItemToUpgrade();

      onDuty = false;
    });
  }
}, 120000);
