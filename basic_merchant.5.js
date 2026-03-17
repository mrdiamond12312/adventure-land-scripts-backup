// Hey there!
// This is CODE, lets you control your character with code.
// If you don't know how to code, don't worry, It's easy.
// Just set attack_mode to true and ENGAGE!

if (parent.caracAL) {
  parent.caracAL
    .load_scripts([
      "adventure-land-scripts-backup/merchant_crafting.10.js",
      "adventure-land-scripts-backup/merchant_service.19.js",
    ])
    .then(() => {
      lureMechaGnome();
    });
} else {
  load_code(10);
  load_code(19);
}

// Global Vars
var onDuty = false;
var isExeing = false;

const fishingLocation = { map: "main", x: -1367, y: -82 };
const miningLocation = { map: "tunnel", x: -279, y: -148 };
const homeLocation = { map: "main", x: -152, y: -137 };
const haveAComputer = () =>
  locate_item("computer") !== -1 || locate_item("ancientcomputer") !== -1;

function equipBroom() {
  const currentWeapon = character.slots.mainhand;
  if (!currentWeapon || currentWeapon.name !== "broom") {
    const broom = findMaxLevelItem("broom");
    if (broom === -1) retrieveBankItem("broom");
    else
      equipBatch({
        mainhand: "broom",
        offhand: "wbookhs",
      });
  }
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
    if (slot === -1 && getItemBankSlots(itemName).length) {
      retrieveBankItem(itemName);
    }

    if (slot === -1) return false;
    return character.items[slot]?.q >= item.quantity + item.keep;
  });

  if (!exchangableItem || smart.moving) return;

  if (get_nearest_npc()?.npc !== exchangableItem.npc && !haveAComputer()) {
    equipBroom();
    await smart_move(find_npc(exchangableItem.npc));
  }

  return exchange(locate_item(exchangableItem.name)).catch((e) => {
    switch (e.response) {
      case "inventory_full":
        onDuty = true;
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
    { name: "goldenegg", quantity: 1 },
    { name: "5bucks", quantity: 1 },
    { name: "candypop", quantity: 10 },
    { name: "basketofeggs", quantity: 1 },
    { name: "seashell", quantity: 20, npc: "fisherman" },
  ];
  let slot = undefined;
  for (const item of itemName) {
    if (getItemBankSlots(item.name).length && locate_item(item.name) === -1) {
      await retrieveBankItem(item.name);
    }

    const slotIndex = locate_item(item.name);
    if (slotIndex !== -1 && character.items[slotIndex].q >= item.quantity) {
      slot = slotIndex;

      if (item.npc && !haveAComputer() && !isAdvanceSmartMoving) {
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
        onDuty = true;
    }
  });
}

async function exchangeMines() {
  const itemName = ["gemfragment"];
  let slot = undefined;
  itemName.map((name) => {
    if (locate_item(name) !== -1) slot = locate_item(name);
  });

  if (slot && character.items[slot].q >= 50) {
    if (
      !smart.moving &&
      !isAdvanceSmartMoving &&
      character.map !== "tunnel" &&
      !haveAComputer()
    ) {
      await smart_move(miningLocation);
    }
    await exchange(slot).catch((e) => {
      switch (e.response) {
        case "inventory_full":
          onDuty = true;
      }
    });
  }
}

async function moveHome() {
  try {
    if (
      distance(character, homeLocation) < 150 ||
      smart.moving ||
      isAdvanceSmartMoving
    )
      return;

    log("Moving back Town!");
    equipBroom();
    await advanceSmartMove(homeLocation, {
      exact: true,
      useScare: isLuringMobs,
    });

    if (locate_item("stand0") === -1 && !haveAComputer()) {
      retrieveBankItem("stand0");
    }
  } catch (e) {
    if (e?.reason === "failed" && e.failed) {
      await town();
    }

    console.warn("movehome error:", e);
  } finally {
    onDuty = false;
  }
}

async function goFishing() {
  if (
    isInvFull() ||
    smart.moving ||
    isAdvanceSmartMoving ||
    character.c.mining ||
    character.c.fishing ||
    is_on_cooldown("fishing")
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
    character.real_x != fishingLocation.x &&
    character.real_y != fishingLocation.y
  ) {
    equipBroom();
    await smart_move(fishingLocation);
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
    is_on_cooldown("mining")
  )
    return;

  const pickaxeItemId = "pickaxe";
  const availablePickaxesInBank = getItemBankSlots(pickaxeItemId);

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
    character.real_x != miningLocation.x &&
    character.real_y != miningLocation.y
  ) {
    equipBroom();
    await smart_move(miningLocation);
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
    Math.max(character.ping) > 300
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
    const bankSlots = getItemBankSlots(name).filter((item) => !item.level);

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

    if (numberOfItemMissing > 0 && totalQuantityOfBankItem) {
      for (let count = 0; count < numberOfItemMissing; count++) {
        fromBank.push(name);

        if (bankSlots[count] && bankSlots[count].q) {
          numberOfItemMissing -= bankSlots[count].q;
        }
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
      await retrieveBankItem(item);
    }
  }

  if (isEnoughIngredients) {
    if (
      get_nearest_npc()?.name !== "Leo" &&
      !haveAComputer() &&
      !smart.moving &&
      !isAdvanceSmartMoving
    ) {
      await smart_move(place);
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
    equipBroom();
  } else if (
    !character.moving &&
    !character.stand &&
    !smart.moving &&
    !isAdvanceSmartMoving
  )
    open_stand();

  if (!isLuringMobs) scareAwayMobs();

  await sortInv();

  const computerSlot = locate_item("computer");
  if (computerSlot === -1 && getItemBankSlots("computer").length) {
    retrieveBankItem("computer");
  }

  await withTimeout(
    Promise.allSettled([
      compoundInv(),
      upgradeInv(),
      exchangeSomething(),
      holidayExchange(),
      dismantleSomething(),
      craft("xbox"),
      craft("basketofeggs"),
      craft("orba", 1, homeLocation),
      craft("froststaff", 1, { map: "main", x: -2, y: 295 }),
      craft("carrotsword", 1, { map: "main", x: -2, y: 295 }),
      craft("wingedboots", character.esize - 8, { map: "main", x: -2, y: 295 }),
      craft("pouchbow", character.esize - 8, { map: "main", x: -2, y: 295 }),
      craft("elixirdex1", 10, { map: "main", x: -2, y: 295 }),
      craft("elixirdex2", 10, { map: "main", x: -2, y: 295 }),
      craft("elixirint1", 10, { map: "main", x: -2, y: 295 }),
      craft("elixirint2", 10, { map: "main", x: -2, y: 295 }),
      craft("elixirstr1", 10, { map: "main", x: -2, y: 295 }),
      craft("elixirstr2", 10, { map: "main", x: -2, y: 295 }),
      craft("elixirvit1", 10, { map: "main", x: -2, y: 295 }),
      craft("elixirvit2", 10, { map: "main", x: -2, y: 295 }),
      // craft("firestaff", character.esize - 6, { map: "main", x: -2, y: 295 }),
      craft("firestars", character.esize - 6, { map: "main", x: -2, y: 295 }),
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

  if (!is_on_cooldown("mining")) goMining();
  else if (!is_on_cooldown("fishing")) goFishing();
  else if (
    locate_item("gemfragment") !== -1 &&
    character.items[locate_item("gemfragment")]?.q >= 50
  )
    exchangeMines();
  else if (!character.c.mining && !character.c.fishing && !onDuty)
    await moveHome();

  if (isInvFull() && !isAdvanceSmartMoving) {
    onDuty = true;
    await advanceSmartMove(bankPosition);
    if (character.map === "bank") {
      try {
        character.items
          .filter((item) => item && !item.l && !IGNORE.includes(item.name))
          .map((item, index) => {
            bank_store(index);
          });
      } catch (e) {
        console.error(e);
      }
    }
    onDuty = false;
  }
}, 750);

setInterval(function () {
  onDuty = false;
  use_skill("mluck", character);
}, 300000);

function on_party_invite(name) {
  if (name === partyMems[0]) accept_party_invite(name);
} // called by the inviter's name

function handle_death() {
  respawn().catch((e) => setTimeout(() => respawn(), e.ms + 300));
}

// Handler to buy from Ponty
const ITEM_NEEDED = [
  "strring",
  "dexearring",
  "bataxe",
  "ololipop",
  "fireblade",
  "firebow",
  "firestaff",
  "firestars",
  "jacko",
  "gcape",
  "carrot",
  "brownenvelope",
  "harbringer",
  "throwingstars",
  "angelwings",
  "smoke",
];

function secondhandsHandler(events) {
  if (isInvFull(6)) return false;
  for (const item of events) {
    if (
      item &&
      ITEM_NEEDED.filter((item) => !SALE_ABLE.includes(item)).includes(
        item.name,
      )
    ) {
      parent.socket.emit("sbuy", { rid: item.rid });
    }
  }
}

// Clear handler when code is terminated
function on_destroy() {
  parent.socket.removeListener("secondhands", secondhandsHandler);
  clear_drawings(); // <-- Default in on_destroy
  clear_buttons(); // <-- Default in on_destroy
}

// Register secondhands event handler
parent.socket.on("secondhands", secondhandsHandler);
setInterval(() => {
  // Send request for Ponty inventory
  parent.socket.emit("secondhands");
}, 12000);

// setInterval(() => {
//   if (
//     !isInvFull(5) &&
//     character.map === "main" &&
//     !(
//       (ITEMS_HIGHEST_LEVEL.staff?.quantity ?? 0) > 3 &&
//       (ITEMS_HIGHEST_LEVEL.staff?.level ?? 0) > 7
//     )
//   ) {
//     for (let i = 0; i < 42 - character.items.filter((i) => i).length - 5; i++) {
//       buy("staff");
//     }
//   }
// }, 2000);
