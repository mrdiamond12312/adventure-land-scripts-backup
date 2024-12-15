load_code(7);

let BANK_CACHE = undefined;

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
  shield: 1, // warrior, 0 if unneccessary
  source: 2, // priest and mage

  // Class attribute based
  earring: 4,
  ring: 4,
  amulet: 2,
  belt: 2,
};
const ITEMS_HIGHEST_LEVEL = {};

async function retrieveMaxItemsLevel() {
  if (character.map !== "bank") return;

  // Reset counter;
  Object.keys(ITEMS_HIGHEST_LEVEL).forEach(
    (key) => delete ITEMS_HIGHEST_LEVEL[key]
  );

  BANK_CACHE = character.bank;

  character.items
    .filter((item) => item && !item.q)
    .forEach((item) => {
      if (item.q) return;

      if (!ITEMS_HIGHEST_LEVEL[item.name]) {
        ITEMS_HIGHEST_LEVEL[item.name] = {
          level: item.level,
          quantity: 1,
          ...item_info(item),
        };
      } else {
        if (item.level > ITEMS_HIGHEST_LEVEL[item.name].level)
          ITEMS_HIGHEST_LEVEL[item.name].level = item.level;
        else if (item.level === ITEMS_HIGHEST_LEVEL[item.name].level)
          ITEMS_HIGHEST_LEVEL[item.name].quantity++;
      }
    });

  for (slot in character.bank) {
    if (slot === "gold") continue;

    log(slot);
    character.bank[slot]
      .filter((item) => item && !item.q)
      .forEach((item) => {
        if (item.q) return;

        if (!ITEMS_HIGHEST_LEVEL[item.name]) {
          ITEMS_HIGHEST_LEVEL[item.name] = {
            level: item.level,
            quantity: 1,
            ...item_info(item),
          };
        } else {
          if (item.level > ITEMS_HIGHEST_LEVEL[item.name].level)
            ITEMS_HIGHEST_LEVEL[item.name].level = item.level;
          else if (item.level === ITEMS_HIGHEST_LEVEL[item.name].level)
            ITEMS_HIGHEST_LEVEL[item.name].quantity++;
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

  return result.sort((lhs, rhs) => lhs.level - rhs.level);
}

function retrievedBankItemToUpgrade() {
  let desiredItemId = undefined;
  let maxItemQuantity = 0;
  for (id in ITEMS_HIGHEST_LEVEL) {
    if (ITEMS_HIGHEST_LEVEL[id].quantity > maxItemQuantity) {
      maxItemQuantity = ITEMS_HIGHEST_LEVEL[id].quantity;
      desiredItemId = id;
    }
  }

  let desiredItems = getItemBankSlots(desiredItemId);
  desiredItems = desiredItems.splice(
    0,
    desiredItems.length -
      KEEP_THRESHOLD[ITEMS_HIGHEST_LEVEL[desiredItemId].type]
  );

  let inventoryEmptySlots = character.items.filter((item) => !item).length - 5;

  for (const itemSlot of desiredItems) {
    if (inventoryEmptySlots === 0) break;
    else inventoryEmptySlots--;

    bank_retrieve(itemSlot.pack, itemSlot.slot);
  }
}

if (Object.keys(ITEMS_HIGHEST_LEVEL).length === 0) {
  close_stand();
  smart_move("bank").then(() => {
    retrieveMaxItemsLevel();
    retrievedBankItemToUpgrade();
  });
}
setInterval(() => {
  if (
    character.map === "main" &&
    !onDuty &&
    !smart.moving &&
    !character.q.exchange &&
    !character.c.fishing &&
    !character.c.mining
  ) {
    close_stand();
    smart_move("bank").then(() => {
      retrieveMaxItemsLevel();
      retrievedBankItemToUpgrade();
    });
  }
}, 120000);

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
              smart_move("bank").then(() =>
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
