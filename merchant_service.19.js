character.on("cm", async function ({ name, message }) {
  if (isInvFull()) {
    return;
  }

  if (onDuty) return;
  onDuty = true;

  try {
    equipBroom();

    switch (message.msg) {
      case "inv_full":
        console.warn(`Go collecting ${name}'s inventory at ${message.map}`);
        await advanceSmartMove(message);
        send_cm(name, "inv_full_merchant_near");
        await sleep(5000);
        break;

      case "buy_potions":
        if (!desiredPotions.includes(message.potion)) break;
        console.warn(`Buying some ${message.potion} for ${name}`);
        await deliverPotions(name, message.potion, message);
        send_cm(name, "buy_potions_merchant_near");
        await sleep(5000);
        break;

      case "buff_mluck":
        await advanceSmartMove(message);
        if (!is_on_cooldown("mluck") && character.mp > 20) {
          use_skill("mluck", get_entity(name));
        }
        break;

      case "elixir":
        if (!partyMems.includes(name)) break;
        console.warn(`Fetching ${message.elixir} for ${name}`);
        await deliverStock(name, message.elixir, message, {
          deliver: ELIXIR_DELIVERY,
          restock: (shortfall) =>
            restockFromBankOrVendor(message.elixir, shortfall),
        });
        break;

      case "xptome":
        if (!partyMems.includes(name)) break;
        console.warn(`Buying Tome of Protection for ${name}`);

        await deliverStock(name, "xptome", message, {
          deliver: 1,
          restock: (shortfall) =>
            restockFromBankOrVendor("xptome", shortfall, "premium"),
        });
        break;

      default:
        console.warn(`Unidentified '${message.msg}'`);
    }
  } finally {
    onDuty = false;
  }
});

const POTION_SHOP = { map: "main", x: 56, y: -122 };
// Amounts handed to a fighter per request; POTION_STACK stays behind for the merchant itself
const POTION_DELIVERY = 9799;
const ELIXIR_DELIVERY = 10;

/**
 * @param {string} itemId
 * @returns {number} inventory slot holding the biggest stack of itemId, -1 when none
 */
function biggestStackSlot(itemId) {
  let bestSlot = -1;
  let bestQuantity = 0;

  character.items.forEach((item, index) => {
    if (!item || item.name !== itemId) return;
    const quantity = item.q || 1;
    if (quantity > bestQuantity) {
      bestQuantity = quantity;
      bestSlot = index;
    }
  });

  return bestSlot;
}

/**
 * Tops the merchant's stock up before delivering, so a fighter never gets handed
 * the few units the merchant happens to be carrying for itself.
 * @param {string} name requesting character
 * @param {string} itemId
 * @param {object} message the requester's cm (its map/x/y is the delivery spot)
 * @param {{deliver: number, reserve?: number, restock: (shortfall: number) => Promise<any>}} options
 * @returns {Promise<boolean>} whether anything was handed over
 */
async function deliverStock(name, itemId, message, options) {
  const { deliver, reserve = 0, restock } = options;
  if (!itemId) return false;

  const shortfall = deliver + reserve - getTotalQuantityOf(itemId);
  if (shortfall > 0) await restock(shortfall).catch((e) => log(e));

  await advanceSmartMove(message);

  const slot = biggestStackSlot(itemId);
  const deliverable =
    slot === -1
      ? 0
      : Math.min(deliver, (character.items[slot].q || 1) - reserve);

  if (deliverable <= 0) {
    console.warn(`Not enough ${itemId} to spare for ${name}`);
    return false;
  }

  await send_item(name, slot, deliverable);
  return true;
}

/**
 * @param {string} name requesting character
 * @param {string} potionId
 * @param {object} message the requester's cm
 */
function deliverPotions(name, potionId, message) {
  return deliverStock(name, potionId, message, {
    deliver: POTION_DELIVERY,
    reserve: POTION_STACK,
    restock: async (shortfall) => {
      if (!haveAComputer() && !character.map.includes("bank"))
        await advanceSmartMove(POTION_SHOP);
      return buy(potionId, shortfall);
    },
  });
}

/**
 * Pulls the bank stack first, then buys whatever is still missing from the vendor.
 * @param {string} itemId
 * @param {number} shortfall how many more units we want
 * @param {string} [npcId] vendor to fall back on when G has no merchant selling it
 */
async function restockFromBankOrVendor(itemId, shortfall, npcId) {
  const ownedBefore = getTotalQuantityOf(itemId);

  if (getItemBankSlots(itemId, true).length) {
    await retrieveBankItem(itemId);
  }

  const stillMissing = shortfall - (getTotalQuantityOf(itemId) - ownedBefore);
  if (stillMissing <= 0) return;

  const vendor = findVendorMerchantOf(itemId) ?? npcId;
  if (!vendor) return;

  if (!haveAComputer()) await advanceSmartMove(find_npc(vendor));

  return buy(itemId, stillMissing);
}

async function openCryptInstance() {
  try {
    if (onDuty || isAdvanceSmartMoving || smart.moving) {
      return;
    }

    onDuty = true;
    if (locate_item("cryptkey") === -1) {
      await retrieveBankItem("cryptkey");
      await sleep(1000 + character.ping);

      if (locate_item("cryptkey") === -1) {
        return;
      }
    }

    await smart_move(CRYPT_DOOR);
    await enter("crypt");

    set("cryptInstance", character.in);
    set("lastCryptInstance", new Date());
    set("cryptDefeatedMobs", []);
    set("lastSeenDefeatableCryptBoss", undefined);
  } finally {
    onDuty = false;
  }
}

/** @param {string} name character name */
function isSiblingOnline(name) {
  if (parent.caracAL) return !!parent.caracAL.siblings?.includes(name);
  return !!get_active_characters()[name];
}

function isMyPriestOnline() {
  return isSiblingOnline(PRIEST);
}

function isMyMageOnline() {
  return isSiblingOnline(MAGE);
}
