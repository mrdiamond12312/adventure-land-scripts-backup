al_items = {};
const order = {};
al_items.order = order;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

order.names = [
  "Helmets",
  "Armors",
  "Underarmors",
  "Gloves",
  "Shoes",
  "Capes",
  "Rings",
  "Earrings",
  "Amulets",
  "Belts",
  "Orbs",
  "Weapons",
  "Shields",
  "Offhands",
  "Elixirs",
  "Potions",
  "Scrolls",
  "Crafting and Collecting",
  "Exchangeables",
  "Others",
];
order.ids = [
  "helmet",
  "chest",
  "pants",
  "gloves",
  "shoes",
  "cape",
  "ring",
  "earring",
  "amulet",
  "belt",
  "orb",
  "weapon",
  "shield",
  "offhand",
  "elixir",
  "pot",
  "scroll",
  "material",
  "exchange",
  "",
];
order.item_ids = order.ids.map((_id) => []);
object_sort(G.items, "gold_value").forEach(function (b) {
  if (!b[1].ignore)
    for (var c = 0; c < order.ids.length; c++)
      if (
        !order.ids[c] ||
        b[1].type == order.ids[c] ||
        ("offhand" == order.ids[c] &&
          in_arr(b[1].type, ["source", "quiver", "misc_offhand"])) ||
        ("scroll" == order.ids[c] &&
          in_arr(b[1].type, ["cscroll", "uscroll", "pscroll", "offering"])) ||
        ("exchange" == order.ids[c] && G.items[b[0]].e)
      ) {
        order.item_ids[c].push(b[0]);
        break;
      }
});
order.flat_iids = order.item_ids.flat();
order.comparator = function (a, b) {
  return (
    (a == null) - (b == null) ||
    (a != null &&
      (order.flat_iids.indexOf(a.name) - order.flat_iids.indexOf(b.name) ||
        (a.name < b.name && -1) ||
        +(a.name > b.name) ||
        b.level - a.level))
  );
};

function getPacksOnThisFloor() {
  const floor = character.map; // "bank", "bank_b", or "bank_u"

  const packs = [];

  for (const key in bank_packs) {
    const [type] = bank_packs[key];
    if (type === floor) packs.push(key);
  }

  return packs;
}

function sort_all_bank(inv_indices, sorted_bank, i_running) {
  if (!character.bank) return log("Not inside the bank");
  
  const packsOnFloor = getPacksOnThisFloor();

  if (!inv_indices) {
    inv_indices = [];
    for (let i = 0; i < 42; i++) {
      if (!character.items[i]) inv_indices.push(i);
    }
  }
  if (inv_indices.length == 0) return log("Make some space in inventory");
  if (!sorted_bank) {
    let bank_array = [];
    for (let bank_pack of packsOnFloor) {
      if (bank_pack == "gold") continue;
      bank_array = bank_array.concat(character.bank[bank_pack]);
    }
    bank_array.sort(al_items.order.comparator);
    sorted_bank = {};
    for (let bank_pack of packsOnFloor) {
      if (bank_pack == "gold") continue;
      sorted_bank[bank_pack] = bank_array.slice(0, 42);
      bank_array = bank_array.slice(42);
    }
  }
  if (i_running == null) i_running = 0;
  else i_running = (i_running + 1) % inv_indices.length;
  const inv_pointer = inv_indices[i_running];
  const inv_itm = character.items[inv_pointer];
  //check every
  if (!inv_itm) {
    for (let bank_pack of packsOnFloor) {
      if (bank_pack == "gold") continue;
      for (let i = 0; i < 42; i++) {
        if (
          character.bank[bank_pack][i] &&
          al_items.order.comparator(
            character.bank[bank_pack][i],
            sorted_bank[bank_pack][i]
          )
        ) {
          log("Swapping empty " + inv_pointer + " with " + i + bank_pack);
          parent.socket.emit("bank", {
            operation: "swap",
            pack: bank_pack,
            str: i,
            inv: inv_pointer,
          });
          return sleep(150).then((x) =>
            sort_all_bank(inv_indices, sorted_bank, i_running)
          );
        }
      }
    }
    inv_indices.splice(i_running, 1);
    return sleep(150).then((x) =>
      sort_all_bank(inv_indices, sorted_bank, i_running)
    );

    //good to go. slice off this party of shit and go on
  } else {
    for (let bank_pack of packsOnFloor) {
      if (bank_pack == "gold") continue;
      for (let i = 0; i < 42; i++) {
        if (
          !al_items.order.comparator(inv_itm, sorted_bank[bank_pack][i]) &&
          al_items.order.comparator(
            character.bank[bank_pack][i],
            sorted_bank[bank_pack][i]
          )
        ) {
          log({ operation: "swap", pack: bank_pack, str: i, inv: inv_pointer });
          parent.socket.emit("bank", {
            operation: "swap",
            inv: inv_pointer,
            pack: bank_pack,
            str: i,
          });
          return sleep(150).then((x) =>
            sort_all_bank(inv_indices, sorted_bank, i_running)
          );
        }
      }
    }
  }

  //if is empty pull misplaced item
  //else if is full place misplaced item
  return sorted_bank;
}
