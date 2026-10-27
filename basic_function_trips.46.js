// basic_function part: the strategy chain's trips, advanceSmartMove, and the inventory lock

/** Chain rank of the fighter strategy running right now, undefined outside the chain */
var activeStrategyRank;

/** Chain rank of the strategy that started the trip under way, -1 outside the chain */
var tripRank = -1;

/** The strategy that claimed the last tick */
var tickOwnerStrategy;

/** @returns {boolean} whether the miniboss hunt owns the fight */
function isHuntingSpecialMob() {
  return (
    typeof useSpecialMobStrategy === "function" &&
    tickOwnerStrategy === useSpecialMobStrategy
  );
}

/** @returns {boolean} whether a controlled move is under way */
function isOnTrip() {
  return (smart.moving || isAdvanceSmartMoving) && !smartmoveDebug;
}

/**
 * Whether the running strategy has to wait out the trip under way — its own or
 * a higher-priority one. Outside the chain every trip holds.
 * @returns {boolean}
 */
function isTripHeld() {
  return isOnTrip() && !(activeStrategyRank < tripRank);
}

/** Drops the trip under way, resolving once the mover has let go of it. */
async function abandonTrip() {
  if (parent.caracAL) {
    if (typeof strategicSmartMove === "undefined") return;
    strategicSmartMove.cleanUp();
    strategicSmartMove.cancelTown();
    return;
  }

  stop("move");

  const deadline = Date.now() + 3000;
  while ((smart.moving || isAdvanceSmartMoving) && Date.now() < deadline)
    await sleep(50);
}

// Wrapper to use which depends on client platform
async function advanceSmartMove(props, options = { useScare: true }) {
  if (!options.smartmoveDebug) lootBeforeTrip(props);

  const rank = activeStrategyRank ?? -1;
  // Mid-trip the chain only runs strategies above the trip's owner
  const isTakeover = rank >= 0 && isOnTrip();
  if (parent.caracAL || isTakeover || !isOnTrip()) tripRank = rank;

  if (
    parent.caracAL &&
    (typeof smartMove !== "function" ||
      typeof oldAdvanceSmartMove !== "function")
  )
    return asyncNoop();

  if (parent.caracAL) {
    return smartMove(props, options);
  }

  // smartMove drops the old trip itself, the native mover refuses while moving
  if (isTakeover) await abandonTrip();

  if (!options.stopWatcher) return oldAdvanceSmartMove(props, options);

  // oldAdvanceSmartMove has no watcher of its own, and stop("move") is what
  // ends a native smart_move — it rejects, so callers passing one must catch
  const watcher = setInterval(() => {
    if (options.stopWatcher()) stop("move");
  }, 250);

  try {
    return await oldAdvanceSmartMove(props, options);
  } finally {
    clearInterval(watcher);
  }
}

// Pre-set function
/**
 * Bag slot order lock: -1 while sortInv swaps, n while n routines hold slots
 * they picked, 0 when free. Mutations overlap, a sort runs alone.
 */
var inventoryLock = 0;

/**
 * @param {"sort"|"mutate"} kind
 * @returns {boolean} whether the lock was taken
 */
function lockInventory(kind) {
  if (kind === "sort") {
    if (inventoryLock !== 0) return false;
    inventoryLock = -1;
    return true;
  }

  if (inventoryLock < 0) return false;
  inventoryLock++;
  return true;
}

/** @param {"sort"|"mutate"} kind what lockInventory took */
function unlockInventory(kind) {
  if (kind === "sort") inventoryLock = 0;
  else if (inventoryLock > 0) inventoryLock--;
}

/** @returns {boolean} whether sortInv is reordering the bag */
function isInventorySorting() {
  return inventoryLock < 0;
}

async function sortInv() {
  if (character.q.upgrade || character.q.compound || character.q.exchange)
    return;
  if (!lockInventory("sort")) return;

  // Snapshot items with their original slot
  const inv = character.items.map((item, slot) => ({ item, slot }));

  // Sorting name -> level -> slot order -> null -> locked (locked always last)
  inv.sort((lhs, rhs) => {
    const lhsItem = lhs.item;
    const rhsItem = rhs.item;

    const lhsLocked = !!lhsItem?.l;
    const rhsLocked = !!rhsItem?.l;
    if (lhsLocked !== rhsLocked) return lhsLocked ? 1 : -1; // locked last

    if (!lhsItem && !rhsItem) return 0;
    if (!lhsItem) return 1; // nulls last (among unlocked)
    if (!rhsItem) return -1;

    const nameOrder = lhsItem.name.localeCompare(rhsItem.name);
    if (nameOrder !== 0) return nameOrder;

    const levelOrder = (lhsItem.level ?? 0) - (rhsItem.level ?? 0);
    if (levelOrder !== 0) return levelOrder;

    // same name + same level — preserve original slot order for stability
    return lhs.slot - rhs.slot;
  });

  // targetOrigSlot[i] = the original slot of the item that should end up at position i.
  // Tracked by original slot rather than item identity so duplicate `null` slots
  // (indistinguishable by value) still resolve to a valid, distinct permutation.
  const targetOrigSlot = inv.map((entry) => entry.slot);

  // Decompose the permutation into cycles. Swaps *within* a cycle are inherently
  // sequential (each one depends on where the previous swap left things), but
  // separate cycles don't touch any of the same slots, so they're dispatched in
  // parallel via Promise.all instead of one big sequential chain for everything.
  const visited = new Array(inv.length).fill(false);
  const cyclePromises = [];

  for (let start = 0; start < inv.length; start++) {
    if (visited[start]) continue;

    const cycle = [];
    let slot = start;
    while (!visited[slot]) {
      visited[slot] = true;
      cycle.push(slot);
      slot = targetOrigSlot[slot];
    }

    if (cycle.length < 2) continue; // already in place

    cyclePromises.push(
      cycle
        .slice(0, -1)
        .reduce(
          (chain, fromSlot, i) =>
            chain.then(() => swap(fromSlot, cycle[i + 1])),
          Promise.resolve(),
        ),
    );
  }

  return Promise.all(cyclePromises).finally(() => {
    unlockInventory("sort");
  });
}
