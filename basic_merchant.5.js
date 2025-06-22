// Hey there!
// This is CODE, lets you control your character with code.
// If you don't know how to code, don't worry, It's easy.
// Just set attack_mode to true and ENGAGE!

if (parent.caracAL) {
  parent.caracAL.load_scripts([
    "adventure-land-scripts-backup/merchant_crafting.10.js",
  ]);
} else {
  load_code(10);
}
// Global Vars
var onDuty = false;
var isExeing = false;

const fishingLocation = { map: "main", x: -1368, y: -82 };
const miningLocation = { map: "tunnel", x: -279, y: -148 };

function equipBroom() {
  const currentWeapon = character.slots.mainhand;
  if (!currentWeapon || currentWeapon.name !== "broom") {
    const broom = locate_item("broom");
    if (broom !== -1)
      equipBatch({
        mainhand: "broom",
        offhand: "wbookhs",
      });
  }
}

function shouldGoExchangeXmas() {
  return !(
    onDuty ||
    isInvFull(6) ||
    character.q.exchange ||
    smart.moving ||
    isAdvanceSmartMoving ||
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
async function holidayExchange() {
  if (!shouldGoExchangeXmas() || !party.S.holiday) return;

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
    const slot = locate_item(item.name);
    if (slot === -1) return false;
    return character.items[slot]?.q >= item.quantity + item.keep;
  });

  if (!exchangableItem) return;

  if (get_nearest_npc()?.npc !== exchangableItem.npc) {
    close_stand();
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

function exchangeXyn() {
  // const itemName = ['candy1', 'candycane', 'candy0', 'mistletoe', 'gem0', 'weaponbox', 'armorbox'];
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
    { name: "goldenegg", quantity: 1 },
    { name: "5bucks", quantity: 1 },
    { name: "candypop", quantity: 10 },
    { name: "basketofeggs", quantity: 1 },
  ];
  let slot = undefined;
  itemName.map((item) => {
    if (
      locate_item(item.name) !== -1 &&
      character.items[locate_item(item.name)].q >= item.quantity
    )
      slot = locate_item(item.name);
  });

  if (slot !== undefined)
    exchange(slot).catch((e) => {
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
    if (!smart.moving && !isAdvanceSmartMoving && character.map !== "tunnel") {
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

function moveHome() {
  if (
    (character.map === "main" &&
      character.real_x === -152 &&
      character.real_y === -137) ||
    smart.moving ||
    isAdvanceSmartMoving ||
    character.moving ||
    character.q.exchange ||
    character.c.fishing ||
    character.c.mining
  )
    return;
  log("Moving back Town!");
  close_stand();
  equipBroom();
  return smart_move({ map: "main", x: -152, y: -137 })
    .then(() => {
      onDuty = false;
      open_stand(locate_item("stand0"));
    })
    .catch((e) => {
      if (e.reason === "failed" && e.failed) use_skill("use_town");
    });
}

async function goFishing() {
  if (isInvFull()) return;
  if (
    !smart.moving &&
    !isAdvanceSmartMoving &&
    !character.q.compound &&
    !character.q.upgrade &&
    !character.q.exchange &&
    !character.c.mining &&
    !character.c.fishing &&
    !is_on_cooldown("fishing")
  ) {
    if (character.slots.mainhand?.name !== "rod" && locate_item("rod") === -1)
      moveHome();

    if (
      character.real_x != fishingLocation.x &&
      character.real_y != fishingLocation.y
    ) {
      close_stand();
      equipBroom();
      await smart_move(fishingLocation);
    }
    if (character.mp > 120) {
      if (!character.c.fishing) {
        if (
          character.slots.mainhand?.name !== "rod" &&
          locate_item("rod") !== -1
        )
          await equipBatch({
            mainhand: "rod",
            offhand: undefined,
          });

        log("Fishin!");
        use_skill("fishing");
      }
    }
  }
}

async function goMining() {
  if (isInvFull()) return;
  if (
    !smart.moving &&
    !isAdvanceSmartMoving &&
    !character.q.compound &&
    !character.q.upgrade &&
    !character.q.exchange &&
    !character.c.fishing &&
    !character.c.mining &&
    !is_on_cooldown("mining")
  ) {
    if (
      character.slots.mainhand?.name !== "pickaxe" &&
      locate_item("pickaxe") === -1
    )
      moveHome();

    if (
      character.real_x != miningLocation.x &&
      character.real_y != miningLocation.y
    ) {
      close_stand();
      equipBroom();
      await smart_move(miningLocation);
    }
    if (character.mp > 120) {
      if (!character.c.mining) {
        if (
          character.slots.mainhand?.name !== "pickaxe" &&
          locate_item("pickaxe") !== -1
        )
          await equipBatch({
            mainhand: "pickaxe",
            offhand: undefined,
          });

        log("Minin!");
        use_skill("mining");
      }
    }
  }
}

async function craft(item, craftQuantity = 1, place = find_npc("craftsman")) {
  // Check if craftable
  if (
    onDuty ||
    isInvFull(4) ||
    character.q.exchange ||
    smart.moving ||
    isAdvanceSmartMoving ||
    (!is_on_cooldown("fishing") && locate_item("rod") !== -1) ||
    (!is_on_cooldown("mining") && locate_item("pickaxe") !== -1) ||
    character.c.mining ||
    character.c.fishing
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

  if (vendorBuy.length) {
    await Promise.all(vendorBuy.map((id) => buy(id)));
  }

  if (fromBank.length) {
    for (const item of fromBank) {
      await retrieveBankItem(item);
    }
  }

  if (isEnoughIngredients) {
    if (get_nearest_npc()?.name !== "Leo") {
      close_stand();
      await smart_move(place);
    }

    for (let trial = 0; trial < craftQuantity; trial++) await auto_craft(item);
    return;
  }
}

setInterval(async function () {
  buff();
  loot();
  if (character.rip) {
    respawn();
    return;
  }

  scareAwayMobs();

  await sortInv();

  Promise.all([
    compoundInv(),
    upgradeInv(),
    exchangeXyn(),
    // holidayExchange(),
    craft("xbox"),
    craft("basketofeggs"),
    craft("orba", 1, { map: "main", x: -152, y: -137 }),
    craft("froststaff", character.esize - 3),
    craft("carrotsword", character.esize - 3),
    !isSortingInventory &&
      Promise.all(
        Array.from({ length: 42 }, (_, i) => i)
          .filter((i) => {
            if (!character.items[i]) return false;
            return (
              SALE_ABLE.includes(character.items[i].name) &&
              !character.items[i].shiny &&
              (character.items[i].level || 0) <= 1
            );
          })
          .map(async (i) => sell(i, 1000)),
      ),
  ]);

  if (
    !is_on_cooldown("mining") &&
    (locate_item("pickaxe") !== -1 ||
      character.slots.mainhand?.name === "pickaxe")
  )
    goMining();
  else if (
    !is_on_cooldown("fishing") &&
    (locate_item("rod") !== -1 || character.slots.mainhand?.name === "rod")
  )
    goFishing();
  else if (
    locate_item("gemfragment") !== -1 &&
    character.items[locate_item("gemfragment")]?.q >= 50
  )
    exchangeMines();
  else if (
    !smart.moving &&
    !isAdvanceSmartMoving &&
    !character.c.mining &&
    !character.c.fishing &&
    !character.q.exchanging
  )
    await moveHome();

  if (isInvFull() && !smart.moving && !isAdvanceSmartMoving) {
    if (!smart.move) await moveHome();
    close_stand();
    if (!smart.move) await smart_move(bankPosition);
    if (character.map === "bank") {
      try {
        character.items
          .filter((item) => item && !IGNORE.includes(item.name))
          .map((item, index) => {
            console.log(item);
            bank_store(index);
          });
      } catch (e) {
        console.error(e);
      }
    }
    if (!smart.move) await moveHome();
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

function secondhands_handler(event) {
  if (isInvFull(6)) return false;
  const ITEM_NEEDED = [
    "strring",
    "dexring",
    "intring",
    "stramulet",
    "intamulet",
    "dexamulet",
    "bataxe",
    "glolipop",
    "ololipop",
    "fireblade",
    "firebow",
    "firestaff",
    "firestars",
    "daggerofthedead",
  ];
  for (const i in event) {
    const item = event[i];
    if (item && ITEM_NEEDED.includes(item.name)) {
      parent.socket.emit("sbuy", { rid: item.rid });
    }
  }
}

// Clear handler when code is terminated
function on_destroy() {
  parent.socket.removeListener("secondhands", secondhands_handler);
  clear_drawings(); // <-- Default in on_destroy
  clear_buttons(); // <-- Default in on_destroy
}

// Register secondhands event handler
parent.socket.on("secondhands", secondhands_handler);
setInterval(() => {
  // Send request for Ponty inventory
  parent.socket.emit("secondhands");
}, 12000);

if (parent.caracAL) {
  parent.caracAL.load_scripts([
    "adventure-land-scripts-backup/merchant_service.19.js",
  ]);
} else load_code(19);
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

// Learn Javascript: https://www.codecademy.com/learn/introduction-to-javascript
// Write your own CODE: https://github.com/kaansoral/adventureland
