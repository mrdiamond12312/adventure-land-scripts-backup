/** Duties a passer-by may ask for — buffing and stocking strangers is deliberate */
const OPEN_DUTIES = ["buy_potions", "buff_mluck"];
/** Duties that move our own items, so they need one of our characters behind them */
const OWNED_DUTIES = ["inv_full", "elixir", "xptome", "dungeon_item"];

character.on("cm", async function ({ name, message }) {
  const msg = message?.msg;
  const isServiceable =
    OPEN_DUTIES.includes(msg) ||
    (OWNED_DUTIES.includes(msg) && isOwnedCharacter(name));

  // Gated ahead of the lock so an unwanted msg can't park the merchant on a route
  if (!isServiceable) return;

  if (isInvFull()) {
    return;
  }

  // Deliveries step out of an event fight or a gather; both resume once we release
  const lock = takeDuty(DUTY.ERRAND, {
    overEvent: true,
    overGather: true,
  });
  if (!lock) return;

  try {
    if (!canServeInPlace(name, message)) {
      equipBroom();
      // A lockless walk (gathering, crafting) would block the restock's bank trip
      await abandonTrip();
    }
    await serveDuty(name, message);
  } finally {
    releaseDuty(lock);
  }
});

/**
 * @param {string} name requesting character
 * @param {object} message the requester's cm
 * @returns {boolean} whether the duty needs neither a walk nor a bank trip
 */
function canServeInPlace(name, message) {
  const { msg } = message;

  if (msg === "buff_mluck")
    return isRequesterInReach(
      name,
      G.skills.mluck.range * REQUESTEE_DRIFT_SLACK,
    );

  if (!isRequesterInReach(name, DELIVERY_RANGE * REQUESTEE_DRIFT_SLACK))
    return false;

  switch (msg) {
    case "inv_full":
      return true;
    case "buy_potions":
      return (
        haveAComputer() ||
        getTotalQuantityOf(message.potion) >= POTION_DELIVERY + POTION_STACK
      );
    case "elixir":
      return getTotalQuantityOf(message.elixir) >= ELIXIR_DELIVERY;
    case "xptome":
      return getTotalQuantityOf("xptome") >= 1;
    case "dungeon_item":
      return getTotalQuantityOf(message.item) >= message.count;
    default:
      return false;
  }
}

/**
 * Carries out one cm duty; the caller holds the lock.
 * @param {string} name requesting character
 * @param {object} message the requester's cm
 */
async function serveDuty(name, message) {
  const msg = message.msg;

  switch (msg) {
    case "inv_full":
      console.warn(`Go collecting ${name}'s inventory at ${message.map}`);
      await moveInReachOf(name, message, DELIVERY_RANGE);
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

    case "buff_mluck": {
      await moveInReachOf(name, message, G.skills.mluck.range);
      const requester = get_entity(name);
      if (requester && !is_on_cooldown("mluck") && character.mp > 20) {
        use_skill("mluck", requester);
      }
      break;
    }

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

    case "dungeon_item":
      if (!partyMems.includes(name) || !DUNGEON_NEED_ITEMS.includes(message.item))
        break;
      console.warn(`Fetching ${message.count} ${message.item} for ${name}`);
      await deliverItems(name, message.item, message.count, message);
      break;

    default:
      console.warn(`Listed but unhandled duty '${msg}'`);
  }
}

/** Requesters drift while we walk, so we close in well inside the bare reach */
const REQUESTEE_DRIFT_SLACK = 0.75;
/** What send_item/send_gold reach — server-side, nothing client-side checks it */
const DELIVERY_RANGE = 400;

/**
 * @param {string} name requesting character
 * @param {number} reach how close we need to be
 * @returns {boolean} whether they are in reach right now
 */
function isRequesterInReach(name, reach) {
  const requester = get_entity(name);
  return !!requester && distance(character, requester) <= reach;
}

/**
 * Walks to where the requester asked from, dropping the rest of the route once
 * they are close enough to act on — they rarely wait where they sent the cm.
 * @param {string} name requesting character
 * @param {object} message the requester's cm, whose map/x/y is the walk target
 * @param {number} range the action's reach, before slack
 */
async function moveInReachOf(name, message, range) {
  const reach = range * REQUESTEE_DRIFT_SLACK;
  if (isRequesterInReach(name, reach)) return;

  try {
    await advanceSmartMove(message, {
      useScare: true,
      stopWatcher: () => isRequesterInReach(name, reach),
    });
  } catch (e) {
    if (!isRequesterInReach(name, reach)) throw e;
  }
}

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

  await moveInReachOf(name, message, DELIVERY_RANGE);

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
 * @param {string} itemId
 * @param {number} count
 * @param {object} message the requester's cm
 */
async function deliverItems(name, itemId, count, message) {
  while (
    getTotalQuantityOf(itemId) < count &&
    getItemBankSlots(itemId, true).length &&
    !isInvFull(2)
  ) {
    const before = getTotalQuantityOf(itemId);
    await retrieveBankItem(itemId);
    if (getTotalQuantityOf(itemId) === before) break;
  }

  await moveInReachOf(name, message, DELIVERY_RANGE);

  let sent = 0;
  for (const [index, item] of character.items.entries()) {
    if (sent >= count) break;
    if (item?.name !== itemId) continue;
    const quantity = Math.min(item.q || 1, count - sent);
    await send_item(name, index, quantity);
    sent += quantity;
  }
  if (sent < count) console.warn(`Only ${sent} of ${count} ${itemId} for ${name}`);
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
      if (!canUseNpcsRemotely()) await advanceSmartMove(POTION_SHOP);
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

  if (!canUseNpcsRemotely()) await advanceSmartMove(find_npc(vendor));

  return buy(itemId, stillMissing);
}

/** Opens the first dungeon short of its DUNGEON_OPENING */
function maybeOpenDungeon() {
  publishDungeonKit();
  if (!isAtHomeServer()) return;

  const id = Object.keys(DUNGEONS).find((id) => {
    const { autoOpen } = DUNGEON_OPENING[id];
    const open = getDungeonVisits(id).filter(
      (visit) => visit.realm === getCurrentServer() && !visit.leftAt,
    );
    const { key } = DUNGEONS[id];
    return (
      open.length < autoOpen &&
      hasDungeonNeeds(id) &&
      (locate_item(key) !== -1 || getItemBankSlots(key, true).length > 0)
    );
  });

  if (id) return openDungeonInstance(id);
}

async function openDungeonInstance(id) {
  if (isAdvanceSmartMoving || smart.moving) return;

  const lock = takeDuty(DUTY.ERRAND);
  if (!lock) return;

  const { key, door, map } = DUNGEONS[id];
  try {
    if (locate_item(key) === -1) {
      await retrieveBankItem(key);
      await sleep(1000 + character.ping);

      if (locate_item(key) === -1) {
        return;
      }
    }

    await smart_move(door);
    await enter(map);

    set(`${id}Visits`, [
      ...getDungeonVisits(id),
      {
        instance: character.in,
        openedAt: Date.now(),
        realm: getCurrentServer(),
      },
    ]);
  } finally {
    releaseDuty(lock);
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
