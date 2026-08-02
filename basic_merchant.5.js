// Hey there!
// This is CODE, lets you control your character with code.
// If you don't know how to code, don't worry, It's easy.
// Just set attack_mode to true and ENGAGE!

if (parent.caracAL) {
  parent.caracAL.load_scripts([
    "adventure-land-scripts-backup/merchant_crafting.10.js",
    "adventure-land-scripts-backup/merchant_service.19.js",
    "adventure-land-scripts-backup/merchant_frenzinesss.100.js",
  ]);
} else {
  load_code(10);
  load_code(19);
  load_code(100);
}

// Global Vars
var onDuty = false;
var isExeing = false;
// Set when an exchange fails with inventory_full; makes the emergency banking
// below run even if isInvFull() reads false. Cleared after the bank trip —
// unlike the old `onDuty = true` hack, this can't leak the shared duty lock.
var invJammed = false;

const fishingLocation = { map: "main", x: -1367, y: -82 };
const miningLocation = { map: "tunnel", x: -279, y: -148 };
const homeLocation = { map: "main", x: -152, y: -137 };
const haveAComputer = () =>
  locate_item("computer") !== -1 || locate_item("ancientcomputer") !== -1;

async function equipBroom() {
  const currentWeapon = character.slots.mainhand;
  if (!currentWeapon || currentWeapon.name !== "broom") {
    const broom = findMaxLevelItem("broom");
    if (broom === -1) await retrieveBankItem("broom");
    return equipBatch({
      mainhand: "broom",
      offhand: "wbookhs",
    });
  }
}

function calculateMerchantEquipments() {
  return {
    helmet: isLuringMobs || isFightingBoss ? "xhelmet" : "eear",
    // Dartgun keeps us out of the boss' melee range while still landing hits
    mainhand: isDraggingMobs || isFightingBoss ? "dartgun" : "broom",
    offhand: isDraggingMobs || isFightingBoss ? "t2quiver" : "wbookhs",
    amulet: isLuringMobs || isFightingBoss ? "t2intamulet" : "warmscarf",
    orb: "jacko",
    chest: "tshirt4",
    pants: "pants",
    ring1: "solitaire",
    ring2: isLuringMobs || isFightingBoss ? "armorring" : "dexring",
    shoes: "eslippers",
    gloves: "gloves1",
    belt: "sbelt",
    earring1: "dexearring",
    earring2: "dexearring",
  };
}

function shouldGoChilling() {
  return (
    (!is_on_cooldown("fishing") &&
      (locate_item("rod") !== -1 ||
        character.slots.mainhand?.name === "rod")) ||
    (!is_on_cooldown("mining") &&
      (locate_item("pickaxe") !== -1 ||
        character.slots.mainhand?.name === "pickaxe")) ||
    character.c.mining ||
    character.c.fishing
  );
}

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

  const holidayItems = [
    {
      name: "ornament",
      npc: "ornaments",
      quantity: 20,
      keep: 10,
    },
    {
      name: "mistletoe",
      npc: "mistletoe",
      quantity: 1,
      keep: 0,
    },
    {
      name: "candycane",
      npc: "santa",
      quantity: 1,
      keep: 0,
    },
  ];

  const exchangableItem = holidayItems.find((item) => {
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

  const itemName = [
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
  let slot = undefined;
  for (const item of itemName) {
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

async function moveHome() {
  if (
    distance(character, homeLocation) < 150 ||
    smart.moving ||
    isAdvanceSmartMoving ||
    isDraggingMobs
  )
    return;

  try {
    log("Moving back Town!");
    await advanceSmartMove(homeLocation, {
      exact: true,
      useScare: isLuringMobs,
    });

    if (locate_item("stand0") === -1 && !haveAComputer()) {
      await retrieveBankItem("stand0");
    }
  } catch (e) {
    if (e?.reason === "failed" && e.failed) {
      await town();
    }
    console.warn("movehome error:", e);
  }
}

async function goFishing() {
  if (
    isInvFull() ||
    smart.moving ||
    isAdvanceSmartMoving ||
    character.c.mining ||
    character.c.fishing ||
    is_on_cooldown("fishing") ||
    onDuty
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

  if (
    character.real_x != fishingLocation.x ||
    character.real_y != fishingLocation.y ||
    character.map !== fishingLocation.map
  ) {
    await equipBroom();
    await advanceSmartMove(fishingLocation, {
      useBlink: false,
      useMagiport: false,
      exact: true,
    });
  }

  if (character.mp > 120) {
    log("Fishin!");
    return Promise.all([
      equipBatch({
        mainhand: rodItemId,
        offhand: undefined,
      }),
      use_skill("fishing"),
    ]);
  }
}

async function goMining() {
  if (
    isInvFull() ||
    smart.moving ||
    isAdvanceSmartMoving ||
    character.q.compound ||
    character.q.upgrade ||
    character.q.exchange ||
    character.c.mining ||
    character.c.fishing ||
    is_on_cooldown("mining") ||
    onDuty
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

  if (
    character.real_x != miningLocation.x ||
    character.real_y != miningLocation.y ||
    character.map !== miningLocation.map
  ) {
    await equipBroom();
    await advanceSmartMove(miningLocation, {
      useBlink: false,
      useMagiport: false,
      exact: true,
    });
  }

  if (character.mp > 120) {
    log("Mining!");
    return Promise.all([
      equipBatch({
        mainhand: pickaxeItemId,
        offhand: undefined,
      }),
      use_skill("mining"),
    ]);
  }
}

async function dismantleSomething() {
  if (
    onDuty ||
    isInvFull(4) ||
    smart.moving ||
    isAdvanceSmartMoving ||
    character.c.mining ||
    character.c.fishing ||
    isSortingInventory ||
    Math.max(...parent.pings) > 300
  )
    return;

  const itemToDismantle = DISMANTLE_LIST.find((id) => locate_item(id) !== -1);
  if (!itemToDismantle) return;

  if (get_nearest_npc()?.name !== "Leo" && !haveAComputer()) {
    await advanceSmartMove(find_npc("craftsman"));
  }

  return dismantle(locate_item(itemToDismantle));
}

async function craft(item, craftQuantity = 1, place = find_npc("craftsman")) {
  // Check if craftable
  if (
    onDuty ||
    isInvFull(4) ||
    character.c.mining ||
    character.c.fishing ||
    !craftQuantity
  )
    return;

  if (!G.craft[item]) {
    log("Uncraftable/Invalid item id!");
    return;
  }

  const fromBank = [];
  const vendorBuy = [];

  const isEnoughIngredients = G.craft[item].items.every(([quantity, name]) => {
    quantity = quantity * craftQuantity;
    const slots = character.items.filter((item) => item && item.name === name);
    const bankSlots = getItemBankSlots(name, true).filter(
      (item) => !item.level,
    );

    const totalQuantityOfSlotItem = slots.reduce(
      (accumulator, current) => accumulator + (current.q ?? 1),
      0,
    );

    const totalQuantityOfBankItem = bankSlots.reduce(
      (accumulator, current) => accumulator + (current.q ?? 1),
      0,
    );

    let numberOfItemMissing = quantity - totalQuantityOfSlotItem;

    if (
      BUYABLE.includes(name) &&
      totalQuantityOfBankItem < numberOfItemMissing
    ) {
      for (
        let count = 0;
        count < numberOfItemMissing - totalQuantityOfBankItem;
        count++
      ) {
        vendorBuy.push(name);
        numberOfItemMissing--;
      }
    }

    if (numberOfItemMissing > 0 && totalQuantityOfBankItem > 0) {
      for (const bankItem of bankSlots) {
        if (numberOfItemMissing <= 0) break;

        const available = bankItem.q ?? 1;
        const takeAmount = Math.min(available, numberOfItemMissing);

        fromBank.push({ name, level: bankItem.level });

        numberOfItemMissing -= takeAmount;
      }
    }

    return (
      totalQuantityOfSlotItem + totalQuantityOfBankItem >= quantity ||
      BUYABLE.includes(name)
    );
  });

  if (vendorBuy.length && isEnoughIngredients) {
    await Promise.all(vendorBuy.map((id) => buy(id)));
  }

  if (fromBank.length && isEnoughIngredients) {
    for (const item of fromBank) {
      await retrieveBankItem(item.name);
    }
  }

  if (isEnoughIngredients) {
    const hasComputer = haveAComputer();

    if (
      !isAdvanceSmartMoving &&
      !smart.moving &&
      ((!hasComputer && get_nearest_npc()?.name !== "Leo") ||
        (hasComputer && character.map.includes("bank")))
    ) {
      await advanceSmartMove(place, { useBlink: false, useMagiport: false });
    }

    for (let trial = 0; trial < craftQuantity; trial++) await auto_craft(item);
    return;
  }
}

setInterval(async function () {
  if (character.rip) {
    respawn();
    return;
  }

  if (character.moving && character.stand) {
    close_stand();
    await equipBatch(calculateMerchantEquipments());
  } else if (
    !character.moving &&
    !character.stand &&
    !smart.moving &&
    !isAdvanceSmartMoving &&
    !isFightingBoss
  )
    open_stand();

  if (!isLuringMobs) scareAwayMobs();

  await sortInv();

  const computerSlot = locate_item("computer");
  if (computerSlot === -1 && getItemBankSlots("computer", true).length) {
    retrieveBankItem("computer");
  }

  if (
    character.hp < character.max_hp - 1000 &&
    (!get_entity(PRIEST) || distance(character, get_entity(PRIEST)) > 150)
  ) {
    send_cm(PRIEST, "party_heal");
  }

  await withTimeout(
    Promise.allSettled([
      !shouldGoChilling() && equipBatch(calculateMerchantEquipments()),
      compoundInv(),
      upgradeInv(),
      exchangeSomething(),
      holidayExchange(),
      dismantleSomething(),
      craft("xbox", 1, homeLocation),
      craft("orba", 1, homeLocation),
      craft("froststaff", 1, { map: "main", x: -2, y: 295 }),
      craft("carrotsword", 1, { map: "main", x: -2, y: 295 }),
      craft("wingedboots", character.esize - 8, { map: "main", x: -2, y: 295 }),
      craft("pouchbow", character.esize - 8, { map: "main", x: -2, y: 295 }),
      craft("elixirdex1", 1, { map: "main", x: -2, y: 295 }),
      craft("elixirdex2", 1, { map: "main", x: -2, y: 295 }),
      craft("elixirint1", 1, { map: "main", x: -2, y: 295 }),
      craft("elixirint2", 1, { map: "main", x: -2, y: 295 }),
      craft("elixirstr1", 1, { map: "main", x: -2, y: 295 }),
      craft("elixirstr2", 1, { map: "main", x: -2, y: 295 }),
      craft("elixirvit1", 1, { map: "main", x: -2, y: 295 }),
      craft("elixirvit2", 1, { map: "main", x: -2, y: 295 }),
      // craft("firestaff", character.esize - 6, { map: "main", x: -2, y: 295 }),
      craft("firestars", character.esize - 6, { map: "main", x: -2, y: 295 }),
      craft("basketofeggs", 1, homeLocation),
      !isSortingInventory &&
        Promise.all(
          Array.from({ length: 42 }, (_, i) => i)
            .filter((i) => {
              if (!character.items[i]) return false;
              return (
                SALE_ABLE.includes(character.items[i].name) &&
                !character.items[i].shiny &&
                (character.items[i].level || 0) <= 2
              );
            })
            .map(async (i) => sell(i, 1000)),
        ),
    ]),
    300000,
  );

  // Events outrank chilling: a rod cast we skip comes back on cooldown long
  // before the next boss does (merchant_frenzinesss.100.js owns the fight)
  const hasEventToJoin = !!getEventToJoin();

  if (!hasEventToJoin && !is_on_cooldown("mining")) goMining();
  else if (!hasEventToJoin && !is_on_cooldown("fishing")) goFishing();
  // else if (
  //   locate_item("gemfragment") !== -1 &&
  //   character.items[locate_item("gemfragment")]?.q >= 50
  // )
  //   exchangeMines();
  else if (
    !hasEventToJoin &&
    !character.c.mining &&
    !character.c.fishing &&
    !onDuty
  )
    await moveHome();

  // Not while an event is on: the bank run would cost the loot share, and the
  // inventory keeps until the fight ends (merchant_frenzinesss.100.js)
  if (
    (isInvFull() || invJammed) &&
    !isFightingBoss &&
    !isAdvanceSmartMoving &&
    !smart.moving
  ) {
    onDuty = true;
    try {
      await bankStoreRoutine();
      invJammed = false;
    } finally {
      onDuty = false;
    }
  }
}, 750);

setInterval(function () {
  // Recovery for a leaked onDuty (a duty that threw without resetting) — but
  // never yank it away from an active lure/drag, whose movement would get
  // hijacked by bankLoop and friends the moment the flag drops.
  if (!isLuringMobs && !isDraggingMobs) onDuty = false;
  use_skill("mluck", character);
}, 300000);

// setInterval(() => {
//   if (character.moving) parent.socket.emit("emotion", { name: "drop_egg" });
// }, 2000);

function on_party_invite(name) {
  if (name === partyMems[0]) accept_party_invite(name);
} // called by the inviter's name

function handle_death() {
  respawn().catch((e) => setTimeout(() => respawn(), e.ms + 300));
}

/**
 * Handler to buy from Ponty.
 * @type {{name: string, maxLevel?: number, minLevel?: number, property?: string}[]}
 * maxLevel/minLevel/property are optional filters — when omitted that check is skipped.
 * `property` matches the secondhands item's `p` field (e.g. "shiny", "glitched").
 */
const ITEM_NEEDED = [
  { name: "strring" },
  // { name: "intring" },
  // { name: "dexring" },
  { name: "dexearring" },
  { name: "bataxe" },
  { name: "pinkie" },
  { name: "ololipop" },
  { name: "jacko" },
  { name: "gcape" },
  { name: "carrot" },
  { name: "brownenvelope" },
  { name: "harbringer" },
  { name: "throwingstars", maxLevel: 0 },
  { name: "angelwings" },
  { name: "smoke" },
  { name: "gphelmet" },
];

/** @returns {boolean} whether the secondhands entry satisfies the wanted item's filters */
function matchesWantedItem(item, wanted) {
  const level = item.level || 0;
  if (wanted.maxLevel !== undefined && level > wanted.maxLevel) return false;
  if (wanted.minLevel !== undefined && level < wanted.minLevel) return false;
  if (wanted.property !== undefined && item.p !== wanted.property) return false;
  return true;
}

function secondhandsHandler(events) {
  if (isInvFull(6)) return false;
  for (const item of events) {
    if (!item) continue;
    if (SALE_ABLE.includes(item.name)) continue;
    const wanted = ITEM_NEEDED.find((w) => w.name === item.name);
    if (!wanted) continue;
    if (!matchesWantedItem(item, wanted)) continue;
    parent.socket.emit("sbuy", { rid: item.rid });
  }
}

// Clear handler when code is terminated
function on_destroy() {
  parent.socket.removeListener("secondhands", secondhandsHandler);
  clear_drawings(); // <-- Default in on_destroy
  clear_buttons(); // <-- Default in on_destroy
}

syncBankData();
bankLoop();
lureMechaGnome();
dragEnt();
merchantAttackLoop();

// Register secondhands event handler
parent.socket.on("secondhands", secondhandsHandler);
setInterval(() => {
  // Send request for Ponty inventory
  parent.socket.emit("secondhands");
}, 12000);

// setInterval(() => {
//   const blade = ITEMS_HIGHEST_LEVEL["blade"];
//   const quantity = blade?.quantity ?? 0; // # of blades at highest level
//   const level = blade?.level ?? 0; // that highest level
//   const count = blade?.count ?? 0; // total blades owned

//   const haveEnoughHighLevel = quantity > 1 && level > 8;
//   const haveEnoughTotal = count >= 60;

//   if (
//     !isInvFull(5) &&
//     (haveAComputer() || character.map === "main") &&
//     !(haveEnoughHighLevel || haveEnoughTotal)
//   ) {
//     buy("blade", character.esize - 7);
//   }
// }, 2000);
