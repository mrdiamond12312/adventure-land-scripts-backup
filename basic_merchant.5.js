if (parent.caracAL) {
  parent.caracAL.load_scripts([
    "adventure-land-scripts-backup/merchant_upgrade.10.js",
    "adventure-land-scripts-backup/merchant_bank.17.js",
    "adventure-land-scripts-backup/merchant_craft.18.js",
    "adventure-land-scripts-backup/merchant_service.19.js",
    "adventure-land-scripts-backup/merchant_gathering.22.js",
    "adventure-land-scripts-backup/merchant_exchange.23.js",
    "adventure-land-scripts-backup/merchant_luring.24.js",
    "adventure-land-scripts-backup/merchant_frenzinesss.100.js",
  ]);
} else {
  load_code(10);
  load_code(17);
  load_code(18);
  load_code(19);
  load_code(22);
  load_code(23);
  load_code(24);
  load_code(100);
}

// Global Vars
var onDuty = false;
// When the current unbroken hold started, 0 while nobody holds it
var dutyHeldSince = 0;
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
      useScare: !isLuringMobs,
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

setInterval(async function () {
  if (character.rip) {
    respawn();
    return;
  }

  // At an event the stand stays open even while moving — speed is 10 anyway,
  // and idleAtEvent (merchant_frenzinesss.100.js) wants it up
  if (character.moving && character.stand && !isFightingBoss) {
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
    requestPartyHeal();
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
      craft("armorring", 1, homeLocation),
      craft("resistancering", 1, homeLocation),
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
      craft("cloverstud ", 1, { map: "main", x: -2, y: 295 }),
      craft("scribeorb ", 1, { map: "main", x: -2, y: 295 }),
      // craft("firestaff", character.esize - 6, { map: "main", x: -2, y: 295 }),
      craft("firestars", character.esize - 6, { map: "main", x: -2, y: 295 }),
      craft("basketofeggs", 1, homeLocation),
      !isSortingInventory &&
        Promise.all(
          Array.from({ length: 42 }, (_, i) => i)
            .filter((i) => {
              if (!character.items[i]) return false;
              if (isCraftIngredient(character.items[i].name)) return false;
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
  else if (
    !hasEventToJoin &&
    !character.c.mining &&
    !character.c.fishing &&
    !onDuty
  )
    await moveHome();

  if ((isInvFull() || invJammed) && !isAdvanceSmartMoving && !smart.moving) {
    onDuty = true;
    try {
      await bankStoreRoutine(true);
      invJammed = false;
    } finally {
      onDuty = false;
    }
  }
}, 750);

/** Tells the watchdog below the duty is still being used */
function renewDuty() {
  dutyHeldSince = Date.now();
}

const DUTY_STALE_MS = 300000;
const DUTY_WATCHDOG_INTERVAL = 30000;

setInterval(function () {
  if (!onDuty) dutyHeldSince = 0;
  else if (!dutyHeldSince) renewDuty();
  else if (Date.now() - dutyHeldSince > DUTY_STALE_MS) onDuty = false;
}, DUTY_WATCHDOG_INTERVAL);

setInterval(function () {
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
  { name: "vitring", maxLevel: 3 },
  { name: "vitearring", maxLevel: 3 },
  { name: "wbook0", maxLevel: 4 },
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
