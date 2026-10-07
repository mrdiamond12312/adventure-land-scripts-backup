// Exchanging: the exchange queue, holiday tokens included.

/** Bag slots exchanging leaves free for what the exchange hands back */
const EXCHANGE_FREE_SLOTS = 6;

/** How long a fetch trip waits after one that came back empty-handed */
const EXCHANGE_FETCH_COOLDOWN = 120_000;

/** When the last fetch trip came back without stock */
var exchangeFetchAt = 0;

/**
 * Exchange queue, tried in order — the first entry with enough stock wins.
 * `npc` is where to walk without a computer, only the quest items need one.
 * `holidayNpc` is walked to during holidayseason, computer or not.
 * `keep` is held back from the bag total.
 * @type {{name: string, quantity: number, keep?: number, npc?: string, holidayNpc?: string}[]}
 */
const EXCHANGE_QUEUE = [
  { name: "ornament", quantity: 20, keep: 10, holidayNpc: "ornaments" },
  { name: "candy1", quantity: 1 },
  { name: "candy0", quantity: 1 },
  { name: "gem0", quantity: 1 },
  { name: "weaponbox", quantity: 1 },
  { name: "armorbox", quantity: 1 },
  { name: "mistletoe", quantity: 1, holidayNpc: "mistletoe" },
  { name: "candycane", quantity: 1, holidayNpc: "santa" },
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

/** @returns {boolean} whether this entry's npc is around to take the exchange */
function isExchangeOpen(entry) {
  if (entry.holidayNpc && !entry.npc) return !!server.status["holidayseason"];
  return true;
}

/**
 * Smallest first, so a stack that can't merge (a pvp mark) is spent before the main one.
 * @returns {number} bag slot of the smallest stack covering one exchange, or -1
 */
function locateExchangeStack(entry) {
  let best = -1;
  character.items.forEach((item, index) => {
    if (item?.name !== entry.name || (item.q ?? 1) < entry.quantity) return;
    if (best === -1 || (item.q ?? 1) < (character.items[best].q ?? 1))
      best = index;
  });
  return best;
}

/** @returns {boolean} whether the bag can spare one exchange past the keep */
function canSpareExchange(entry) {
  return getTotalQuantityOf(entry.name) >= entry.quantity + (entry.keep ?? 0);
}

/** @returns {number} the bag slot to exchange an entry from now, or -1 */
function getExchangeSlot(entry) {
  return canSpareExchange(entry) ? locateExchangeStack(entry) : -1;
}

/** @returns {boolean} whether a travel-free bank pull may run right now */
function canPullFromBank() {
  return !isOnDuty() || isOnDuty(DUTY.ERRAND);
}

/**
 * The bag slot to exchange an entry from, pulling more from the bank while the
 * bag can't spare one exchange.
 * @returns {Promise<number>} the slot, or -1
 */
async function prepareExchangeSlot(entry) {
  while (
    canPullFromBank() &&
    !canSpareExchange(entry) &&
    hasExchangeStock(entry) &&
    !isInvFull(1)
  ) {
    const before = getTotalQuantityOf(entry.name);
    await retrieveBankItem(entry.name, 0, { travel: false });
    if (getTotalQuantityOf(entry.name) <= before) break;
  }

  return getExchangeSlot(entry);
}

/**
 * The one entry exchangeSomething works on now: the first the bag can spend,
 * else the first holding stock anywhere.
 * @returns {object|undefined}
 */
function getActiveExchangeEntry() {
  const open = EXCHANGE_QUEUE.filter((entry) => isExchangeOpen(entry));
  return (
    open.find((entry) => getExchangeSlot(entry) !== -1) ??
    open.find((entry) => hasExchangeStock(entry))
  );
}

/** @returns {boolean} whether the active exchange still wants this item in the bag */
function isExchangeQueued(itemName) {
  return getActiveExchangeEntry()?.name === itemName;
}

/** @returns {string|undefined} the npc to walk to for this entry now, if any */
function getExchangeNpc(entry) {
  if (entry.holidayNpc && server.status["holidayseason"])
    return entry.holidayNpc;
  if (entry.npc && !haveAComputer()) return entry.npc;
}

/**
 * Spends the mass exchange buffs on the exchange from slot.
 * @returns {Promise<boolean>} whether the exchange went through
 */
function exchangeFrom(slot) {
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

  return exchange(slot)
    .then(() => true)
    .catch((e) => {
      switch (e.response) {
        case "inventory_full":
          invJammed = true;
      }
      return false;
    });
}

/**
 * Whether to stay at the npc for another exchange of this entry.
 * @returns {boolean}
 */
function shouldKeepExchanging(entry) {
  return (
    getExchangeSlot(entry) !== -1 &&
    !isInvFull(EXCHANGE_FREE_SLOTS) &&
    !invJammed &&
    !getEventToJoin()
  );
}

/**
 * Bank slots covering what the bag still needs of an entry.
 * @returns {Array<{pack: string, slot: number, floor: string}>}
 */
function getExchangeStockSlots(entry) {
  let needed =
    entry.quantity + (entry.keep ?? 0) - getTotalQuantityOf(entry.name);
  const picked = [];

  for (const found of getItemBankSlots(entry.name, true, true)) {
    if (needed <= 0 || picked.length >= character.esize - EXCHANGE_FREE_SLOTS)
      break;
    picked.push(found);
    needed -= found.q ?? 1;
  }

  return picked;
}

/** @returns {object|undefined} the first entry only the bank can cover */
function getExchangeEntryToFetch() {
  return EXCHANGE_QUEUE.find(
    (entry) =>
      isExchangeOpen(entry) &&
      !canSpareExchange(entry) &&
      hasExchangeStock(entry),
  );
}

/**
 * Walks to the bank for stock the bag can't cover, so a drained queue doesn't
 * wait on bankLoop's next pass.
 * @returns {Promise<void>}
 */
async function fetchExchangeStock() {
  if (isOnDuty() || isAdvanceSmartMoving || smart.moving) return;
  if (invJammed || getEventToJoin() || isAwaitingParcel()) return;
  if (character.c.mining || character.c.fishing) return;
  if (Date.now() - exchangeFetchAt < EXCHANGE_FETCH_COOLDOWN) return;

  const entry = getExchangeEntryToFetch();
  if (!entry) return;

  const slots = getExchangeStockSlots(entry);
  if (!slots.length) return;

  const lock = takeDuty(DUTY.ERRAND);
  if (!lock) return;

  try {
    await equipBroom();
    const before = getTotalQuantityOf(entry.name);
    await retrieveAll(slots, true);
    if (getTotalQuantityOf(entry.name) <= before) exchangeFetchAt = Date.now();
  } finally {
    releaseDuty(lock);
  }
}

async function exchangeSomething() {
  if (isInvFull(EXCHANGE_FREE_SLOTS)) return;

  let entry;
  let slot = -1;
  for (const candidate of EXCHANGE_QUEUE) {
    if (!isExchangeOpen(candidate)) continue;
    slot = await prepareExchangeSlot(candidate);
    if (slot === -1) continue;
    entry = candidate;
    break;
  }

  if (!entry) return fetchExchangeStock();

  const npc = getExchangeNpc(entry);
  if (!npc) return exchangeFrom(slot);

  if (isAdvanceSmartMoving || smart.moving) return;
  const lock = takeDuty(DUTY.ERRAND);
  if (!lock) return;

  try {
    await equipBroom();
    await advanceSmartMove(find_npc(npc));

    // Spend it all while we're here, or moveHome walks us back after each one
    while (shouldKeepExchanging(entry)) {
      if (!(await exchangeFrom(getExchangeSlot(entry)))) break;
      renewDuty(lock);
    }
  } finally {
    releaseDuty(lock);
  }
}
