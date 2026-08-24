// Exchanging: seasonal token turn-ins and the general exchange queue.

/**
 * Seasonal turn-ins, only live while parent.S.holidayseason is set.
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
  { name: "seashell", quantity: 20, npc: "fisherman" },
  { name: "leather", quantity: 40, npc: "leathermerchant" },
  { name: "gemfragment", quantity: 50, npc: "gemmerchant" },
];

function shouldGoExchangeXmas() {
  return !(
    onDuty ||
    isInvFull(6) ||
    character.q.exchange ||
    smart.moving ||
    isAdvanceSmartMoving ||
    shouldGoChilling()
  );
}

async function holidayExchange() {
  if (!shouldGoExchangeXmas() || !parent.S["holidayseason"]) return;

  const exchangableItem = HOLIDAY_EXCHANGES.find((item) => {
    const itemName = item.name;
    const slot = locate_item(itemName);
    if (slot === -1 && getItemBankSlots(itemName, true).length) {
      retrieveBankItem(itemName);
    }

    if (slot === -1) return false;
    return character.items[slot]?.q >= item.quantity + item.keep;
  });

  if (!exchangableItem || smart.moving) return;

  if (get_nearest_npc()?.npc !== exchangableItem.npc && !haveAComputer()) {
    await equipBroom();
    await smart_move(find_npc(exchangableItem.npc));
  }

  return exchange(locate_item(exchangableItem.name)).catch((e) => {
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
    if (
      !onDuty &&
      getItemBankSlots(item.name).length &&
      locate_item(item.name) === -1
    ) {
      await retrieveBankItem(item.name);
    }

    const slotIndex = locate_item(item.name);
    if (slotIndex !== -1 && character.items[slotIndex].q >= item.quantity) {
      slot = slotIndex;

      if (
        item.npc &&
        !haveAComputer() &&
        !onDuty &&
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
