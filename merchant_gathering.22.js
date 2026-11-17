// Gathering: fishing, mining and dismantling, plus the gear they need.

const DISMANTLE_LIST = [
  // "maceofthedead",
  // "pmaceofthedead",
  // "staffofthedead",
  // "swordofthedead",
];

/**
 * Bag slots a trip needs free before it sets off. It has to clear the ceiling
 * freeBagSlotForWork sells up to, or a trip takes the slot the purge just
 * opened for a scroll, plus the 4 the rod/pickaxe craft branches below ask for.
 */
const GATHER_FREE_SLOTS = RETRIEVE_SCROLL_SLOTS + 4;

async function equipBroom() {
  const currentWeapon = character.slots.mainhand;
  if (!currentWeapon || currentWeapon.name !== "broom") {
    const broom = findMaxLevelItem("broom");
    if (broom === -1) await retrieveBankItem("broom", 0, { travel: false });
    return equipBatch({
      mainhand: "broom",
      offhand: "wbookhs",
    });
  }
}

function shouldGoChilling() {
  // A channel already running owns the gear whatever the bag looks like
  if (character.c.mining || character.c.fishing) return true;

  // Without room for the loot there is no trip, so nothing should defer to one
  if (isInvFull(GATHER_FREE_SLOTS)) return false;

  return (
    (!is_on_cooldown("fishing") &&
      (locate_item("rod") !== -1 ||
        character.slots.mainhand?.name === "rod")) ||
    (!is_on_cooldown("mining") &&
      (locate_item("pickaxe") !== -1 ||
        character.slots.mainhand?.name === "pickaxe"))
  );
}

/** Longest a gather may hold off duties before it reaches its channel */
const GATHER_HOLD_MAX_MS = 180_000;

/** When the running gather set off for its spot, undefined while none is */
let gatherStartedAt = undefined;

/** @returns {boolean} whether a gather is walking to its spot or channelling */
function isGathering() {
  if (character.c.fishing || character.c.mining) return true;
  return (
    gatherStartedAt !== undefined &&
    Date.now() - gatherStartedAt < GATHER_HOLD_MAX_MS
  );
}

/** @returns {boolean} whether a duty or another trip took the merchant over mid-gather */
function isGatherPreempted() {
  return isOnDuty() || isOnTrip();
}

/**
 * Walks to the spot and casts, holding off every duty but a fighter's request.
 * @param {"fishing"|"mining"} skill
 * @param {{map: string, x: number, y: number}} location
 * @param {string} toolId
 */
async function walkAndGather(skill, location, toolId) {
  const startedAt = Date.now();
  gatherStartedAt = startedAt;
  try {
    if (
      character.real_x != location.x ||
      character.real_y != location.y ||
      character.map !== location.map
    ) {
      await equipBroom();
      if (isGatherPreempted()) return;
      await advanceSmartMove(location, {
        useBlink: false,
        useMagiport: false,
        exact: true,
      });
      if (isGatherPreempted()) return;
    }

    if (character.mp > 120) {
      log(skill === "fishing" ? "Fishin!" : "Mining!");
      return await Promise.all([
        equipBatch({
          mainhand: toolId,
          offhand: undefined,
        }),
        use_skill(skill),
      ]);
    }
  } finally {
    if (gatherStartedAt === startedAt) gatherStartedAt = undefined;
  }
}

async function goFishing() {
  if (
    isInvFull(GATHER_FREE_SLOTS) ||
    smart.moving ||
    isAdvanceSmartMoving ||
    character.c.mining ||
    character.c.fishing ||
    is_on_cooldown("fishing") ||
    isOnDuty()
  )
    return;

  const rodItemId = "rod";
  const availableRodsInBank = getItemBankSlots(rodItemId);

  if (
    availableRodsInBank.length > 0 &&
    character.slots.mainhand?.name !== rodItemId &&
    !isInvFull(2) &&
    locate_item(rodItemId) === -1
  ) {
    return retrieveBankItem(rodItemId);
  }

  if (
    locate_item(rodItemId) === -1 &&
    character.slots.mainhand?.name !== rodItemId &&
    availableRodsInBank.length === 0 &&
    !isInvFull(4)
  ) {
    return craft(rodItemId);
  }

  if (
    character.slots.mainhand?.name !== rodItemId &&
    locate_item(rodItemId) === -1
  )
    return;

  return walkAndGather("fishing", fishingLocation, rodItemId);
}

async function goMining() {
  if (
    isInvFull(GATHER_FREE_SLOTS) ||
    smart.moving ||
    isAdvanceSmartMoving ||
    character.c.mining ||
    character.c.fishing ||
    is_on_cooldown("mining") ||
    isOnDuty()
  )
    return;

  const pickaxeItemId = "pickaxe";
  const availablePickaxesInBank = getItemBankSlots(pickaxeItemId, true);

  if (
    availablePickaxesInBank.length > 0 &&
    character.slots.mainhand?.name !== pickaxeItemId &&
    !isInvFull(2) &&
    locate_item(pickaxeItemId) === -1
  ) {
    return retrieveBankItem(pickaxeItemId);
  }

  if (
    locate_item(pickaxeItemId) === -1 &&
    character.slots.mainhand?.name !== pickaxeItemId &&
    availablePickaxesInBank.length === 0 &&
    !isInvFull(4)
  ) {
    return craft(pickaxeItemId);
  }

  if (
    character.slots.mainhand?.name !== pickaxeItemId &&
    locate_item(pickaxeItemId) === -1
  )
    return;

  return walkAndGather("mining", miningLocation, pickaxeItemId);
}

async function dismantleSomething() {
  if (
    isOnDuty() ||
    isInvFull(4) ||
    smart.moving ||
    isAdvanceSmartMoving ||
    character.c.mining ||
    character.c.fishing ||
    isInventorySorting() ||
    Math.max(...parent.pings) > 300
  )
    return;

  const itemToDismantle = DISMANTLE_LIST.find((id) => locate_item(id) !== -1);
  if (!itemToDismantle) return;

  if (get_nearest_npc()?.name !== "Leo" && !canUseNpcsRemotely()) {
    await advanceSmartMove(find_npc("craftsman"));
  }

  return dismantle(locate_item(itemToDismantle));
}
