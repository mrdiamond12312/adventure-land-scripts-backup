// Exchanging: seasonal token turn-ins and the general exchange queue.

/**
 * Seasonal turn-ins, only live while server.status.holidayseason is set.
 * `keep` is held back from the exchange; `quantity` is what one turn-in costs.
 * @type {{name: string, npc: string, quantity: number, keep: number}[]}
 */
const HOLIDAY_EXCHANGES = [
  { name: "ornament", npc: "ornaments", quantity: 20, keep: 10 },
  { name: "mistletoe", npc: "mistletoe", quantity: 1, keep: 0 },
  { name: "candycane", npc: "santa", quantity: 1, keep: 0 },
];

/**
 * Exchange queue, tried in order — the first entry with enough stack wins.
 * `npc` is only set for the ones that can't be exchanged from a computer.
 * @type {{name: string, quantity: number, npc?: string}[]}
 */
const EXCHANGE_QUEUE = [
  { name: "candy1", quantity: 1 },
  { name: "candy0", quantity: 1 },
  { name: "gem0", quantity: 1 },
  { name: "weaponbox", quantity: 1 },
  { name: "armorbox", quantity: 1 },
  { name: "mistletoe", quantity: 1 },
  { name: "candycane", quantity: 1 },
  { name: "greenenvelope", quantity: 1 },
  { name: "brownenvelope", quantity: 1 },
  { name: "xbox", quantity: 1 },
  { name: "goldenegg", quantity: 1 },
  { name: "5bucks", quantity: 1 },
  { name: "candypop", quantity: 10 },
  { name: "basketofeggs", quantity: 1 },
  { name: "marketparcel", quantity: 1 },
  { name: "anniversarygift", quantity: 1, keep: 1 },
  { name: "gift0", quantity: 1, keep: 1 },
  { name: "sixcake", quantity: 1, keep: 1 },
  { name: "seashell", quantity: 20, npc: "fisherman" },
  { name: "leather", quantity: 40, npc: "leathermerchant" },
  { name: "gemfragment", quantity: 50, npc: "gemmerchant" },
];

/** @returns {boolean} whether bag and bank together hold enough of an entry to exchange */
function hasExchangeStock(entry) {
  const owned = [
    ...character.items,
    ...getItemBankSlots(entry.name, true, true),
  ].reduce(
    (total, item) => (item?.name === entry.name ? total + (item.q ?? 1) : total),
    0,
  );
  return owned >= entry.quantity + (entry.keep ?? 0);
}

/** @returns {number} bag slot of an item's biggest stack, or -1 */
function locateBiggestStack(itemName) {
  let best = -1;
  character.items.forEach((item, index) => {
    if (item?.name !== itemName) return;
    if (best === -1 || (item.q ?? 1) > (character.items[best].q ?? 1))
      best = index;
  });
  return best;
}

/**
 * The bag slot to exchange an entry from, pulling more from the bank while the
 * biggest stack is short of one exchange.
 * @returns {Promise<number>} the slot, or -1 if no stack is big enough
 */
async function prepareExchangeSlot(entry) {
  const need = entry.quantity + (entry.keep ?? 0);
  const isReady = (slot) => slot !== -1 && (character.items[slot].q ?? 1) >= need;

  let slot = locateBiggestStack(entry.name);
  if (!isReady(slot) && !isOnDuty() && hasExchangeStock(entry)) {
    await retrieveBankItem(entry.name);
    slot = locateBiggestStack(entry.name);
  }

  return isReady(slot) ? slot : -1;
}

/** @returns {boolean} whether an exchange queue still wants this item in the bag */
function isExchangeQueued(itemName) {
  const isReady = (entry) =>
    entry.name === itemName && hasExchangeStock(entry);
  return (
    EXCHANGE_QUEUE.some(isReady) ||
    (!!server.status["holidayseason"] && HOLIDAY_EXCHANGES.some(isReady))
  );
}

function shouldGoExchangeXmas() {
  return !(
    isOnDuty() ||
    isInvFull(6) ||
    character.q.exchange ||
    smart.moving ||
    isAdvanceSmartMoving ||
    shouldGoChilling()
  );
}

async function holidayExchange() {
  if (!shouldGoExchangeXmas() || !server.status["holidayseason"]) return;

  let exchangableItem;
  for (const item of HOLIDAY_EXCHANGES) {
    if ((await prepareExchangeSlot(item)) === -1) continue;
    exchangableItem = item;
    break;
  }

  if (!exchangableItem || smart.moving) return;

  if (get_nearest_npc()?.npc !== exchangableItem.npc && !haveAComputer()) {
    await equipBroom();
    await smart_move(find_npc(exchangableItem.npc));
  }

  return exchange(locateBiggestStack(exchangableItem.name)).catch((e) => {
    switch (e.response) {
      case "inventory_full":
        invJammed = true;
    }
  });
}

async function exchangeSomething() {
  if (isInvFull(6)) return;

  let slot = undefined;
  for (const item of EXCHANGE_QUEUE) {
    const slotIndex = await prepareExchangeSlot(item);
    if (slotIndex !== -1) {
      slot = slotIndex;

      if (
        item.npc &&
        !haveAComputer() &&
        !isOnDuty() &&
        !isAdvanceSmartMoving &&
        !smart.moving
      ) {
        await advanceSmartMove(find_npc(item.npc));
      }

      break;
    }
  }

  if (slot === undefined) return;

  if (
    character.mp > 400 &&
    !is_on_cooldown("massexchangepp") &&
    !character.s.massexchangepp
  ) {
    if (character.mp < 1000 && locate_item("mpot1") === -1) {
      buy("mpot1", 1);
    }
    use_skill("massexchangepp");
  }

  if (
    character.mp > 50 &&
    !is_on_cooldown("massexchange") &&
    !character.s.massexchange
  )
    use_skill("massexchange");

  return exchange(slot).catch((e) => {
    switch (e.response) {
      case "inventory_full":
        invJammed = true;
    }
  });
}
