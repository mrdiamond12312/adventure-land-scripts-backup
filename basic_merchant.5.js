// Hey there!
// This is CODE, lets you control your character with code.
// If you don't know how to code, don't worry, It's easy.
// Just set attack_mode to true and ENGAGE!
load_code(10);
// Global Vars
var onDuty = false;
var isExeing = false;

const fishingLocation = { map: "main", x: -1368, y: -82 };
const miningLocation = { map: "tunnel", x: -279, y: -148 };

function equipBroom() {
  const currentWeapon = character.slots.mainhand;
  if (!currentWeapon || currentWeapon.name !== "broom") {
    const broom = locate_item("broom");
    if (broom !== -1) equip(broom);
  }
}
async function holidayExchange() {
  if (
    onDuty ||
    isInvFull(6) ||
    character.q.exchange ||
    smart.moving ||
    (!is_on_cooldown("fishing") && locate_item("rod") !== -1) ||
    (!is_on_cooldown("mining") && locate_item("pickaxe") !== -1) ||
    character.c.mining ||
    character.c.fishing
  )
    return;

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
  const itemName = ["candy1", "candy0", "gem0", "weaponbox", "armorbox"];
  let slot = undefined;
  itemName.map((name) => {
    if (locate_item(name) !== -1) slot = locate_item(name);
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
    if (!smart.moving && character.map !== "tunnel") {
      await smart_move("tunnel");
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
    character.moving ||
    character.q.exchange
  )
    return;
  log("Moving back Town!");
  return smart_move({ map: "main", x: -152, y: -137 }).then(() => {
    onDuty = false;
    open_stand(locate_item("stand0"));
  });
}

async function goFishing() {
  if (isInvFull()) return;
  if (
    !smart.moving &&
    !character.q.compound &&
    !character.q.upgrade &&
    !character.q.exchange &&
    !character.c.mining &&
    !character.c.fishing &&
    !is_on_cooldown("fishing")
  ) {
    const currentWeapon = character.slots.mainhand;

    if (!currentWeapon || currentWeapon.name !== "rod") {
      const fishRod = locate_item("rod");
      if (fishRod !== -1) equip(fishRod);
      else return moveHome();
    }
    if (
      character.real_x != fishingLocation.x &&
      character.real_y != fishingLocation.y
    ) {
      close_stand();
      await smart_move(fishingLocation);
    }
    if (character.mp > 120) {
      if (!character.c.fishing) {
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
    !character.q.compound &&
    !character.q.upgrade &&
    !character.q.exchange &&
    !character.c.fishing &&
    !character.c.mining &&
    !is_on_cooldown("mining")
  ) {
    const currentWeapon = character.slots.mainhand;

    if (!currentWeapon || currentWeapon.name !== "pickaxe") {
      const pickAxe = locate_item("pickaxe");
      if (pickAxe !== -1) equip(pickAxe);
      else return moveHome();
    }
    if (
      character.real_x != miningLocation.x &&
      character.real_y != miningLocation.y
    ) {
      close_stand();
      await smart_move(miningLocation);
    }
    if (character.mp > 120) {
      if (!character.c.mining) {
        log("Minin!");
        use_skill("mining");
      }
    }
  }
}

async function craft(item) {
  // Check if craftable
  if (
    onDuty ||
    isInvFull(4) ||
    character.q.exchange ||
    smart.moving ||
    (!is_on_cooldown("fishing") && locate_item("rod") !== -1) ||
    (!is_on_cooldown("mining") && locate_item("pickaxe") !== -1) ||
    character.c.mining ||
    character.c.fishing
  )
    return;

  if (!G.craft[item]) {
    log("Invalid craftable item id");
    return;
  }
  const isEnoughIngredients = G.craft[item].items.every(([quantity, name]) => {
    const slot = locate_item(name);
    return slot !== -1 && character.items[slot]?.q >= quantity;
  });
  if (isEnoughIngredients) {
    if (get_nearest_npc()?.name !== "Leo") {
      close_stand();
      await smart_move(find_npc("craftsman"));
    }
    return auto_craft(item);
  }
}

setInterval(async function () {
  buff();
  loot();

  if (character.rip) {
    respawn();
    return;
  }

  await sortInv();
  var inv = character.items;
  const invLength = inv.length;

  Promise.all([
    compoundInv(),
    upgradeInv(),
    exchangeXyn(),
    holidayExchange(),
    craft("xbox"),
    Promise.all(
      Array.from({ length: 42 }, (_, i) => i)
        .filter((i) => {
          if (!character.items[i]) return false;
          return (
            saleAble.includes(character.items[i].name) &&
            !character.items[i].shiny
          );
        })
        .map(async (i) => sell(i))
    ),
  ]);

  if (!is_on_cooldown("fishing")) goFishing();
  else if (!is_on_cooldown("mining")) goMining();
  else if (
    locate_item("gemfragment") !== -1 &&
    character.items[locate_item("gemfragment")]?.q >= 50
  )
    exchangeMines();
  else if (
    !smart.moving &&
    !character.c.mining &&
    !character.c.fishing &&
    !character.q.exchanging
  )
    await moveHome();

  if (isInvFull() && !smart.moving) {
    if (!smart.move) await moveHome();
    close_stand();
    if (!smart.move) await smart_move(bankPosition);
    if (character.map === "bank")
      Array.from({ length: 42 }, (_, i) => i)
        .filter(
          (index) =>
            inv[index] &&
            !item_info(inv[index]).compound &&
            !ignore.includes(inv[index].name)
        )
        .map((i) => bank_store(i));
    if (!smart.move) await moveHome();
    onDuty = false;
  }
}, 3000);

setInterval(function () {
  onDuty = false;
  use_skill("mluck", character);
}, 300000);

function on_party_invite(name) {
  if (name === partyMems[0]) accept_party_invite(name);
} // called by the inviter's name

function handle_death() {
  respawn();
}

character.on("cm", async function ({ name, message }) {
  if (isInvFull()) {
    return;
  }
  switch (message) {
    case "inv_ok":
      onDuty = false;
      moveHome();
      break;
  }
  if (!onDuty) {
    onDuty = true;
    close_stand();
  } else return;

  equipBroom();
  // const sender = get_characters().find(character => character.name === name);

  switch (message.msg) {
    case "inv_full":
      log(`Go collecting ${name} compoundables at ${message.map}`);
      await smart_move({
        ...message,
      });
      send_cm(name, "inv_full_merchant_near");
      await sleep(5000);
      onDuty = false;
      moveHome();
      break;

    case "buy_mana":
      log(`Buying some mana potions for ${name}`);
      if (isInvFull()) {
        if (!smart.move) await smart_move(bankPosition);
        if (character.map === "bank") bank_store(0);
      }
      if (locate_item("mpot1") === -1) {
        await smart_move(find_npc("fancypots"));
        await buy("mpot1", 10000);
      }
      await smart_move({
        ...message,
      });
      await send_item(name, locate_item("mpot1"), 10000);
      send_cm(name, "buy_mana_merchant_near");
      await sleep(5000);
      onDuty = false;
      moveHome();
      break;

    case "buy_hp":
      log(`Buying some health potions for ${name}`);
      if (isInvFull()) {
        if (!smart.move) await smart_move(bankPosition);
        if (character.map === "bank") bank_store(0);
      }
      if (locate_item("hpot1") === -1) {
        await smart_move(find_npc("fancypots"));
        await buy("hpot1", 10000);
      }
      await smart_move({
        ...message,
      });
      await send_item(name, locate_item("hpot1"), 10000);
      send_cm(name, "buy_hp_merchant_near");
      await sleep(5000);
      onDuty = false;
      moveHome();
      break;

    case "buff_mluck":
      await smart_move({
        ...message,
      });
      if (!is_on_cooldown("mluck") && character.mp > 20) {
        use_skill("mluck", get_entity(name));
      }
      onDuty = false;
      moveHome();
      break;

    case "elixir":
      if (locate_item(message.elixir) === -1) {
        let itemBankSlot = undefined;
        let itemSlot = undefined;
        await smart_move(bankPosition);
        Object.keys(character.bank)
          .filter((id) => id !== "gold")
          .map((slot) => {
            character.bank[slot]?.map((item, index) => {
              if (item && item.name === message.elixir) {
                itemBankSlot = slot;
                itemSlot = index;
              }
            });
          });
        if (itemBankSlot && itemSlot) {
          bank_retrieve(itemBankSlot, itemSlot);
        } else {
          await smart_move({ map: find_npc("wbartender").map });
          buy(message.elixir);
        }
      }
      if (!locate_item(message.elixir)) {
        onDuty = false;
        break;
      }
      await smart_move({
        ...message,
      });
      await send_item(name, locate_item(message.elixir), 10);
      onDuty = false;
      break;

    default:
      onDuty = false;
      log(`Unidentified '${message.msg}'`);
  }
});

// Learn Javascript: https://www.codecademy.com/learn/introduction-to-javascript
// Write your own CODE: https://github.com/kaansoral/adventureland
