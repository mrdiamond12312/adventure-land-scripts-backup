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
    "adventure-land-scripts-backup/merchant_scout.29.js",
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
  load_code(29);
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

// Merrit parcel config
/** Extra px kept beyond Merrit's clearances */
const STAND_SPACING_MARGIN = 4;
/** Grid step when scanning for a free spot */
const STAND_SCAN_STEP = 8;
/** Server reasons that rule a spot out */
const MERRIT_SPOT_BLOCKERS = ["stand_close", "stand_front", "npc", "area"];
/** Time to walk home before the settle window */
const PARCEL_HOLD_LEAD = 60_000;
/** How long past due to keep waiting on Merrit */
const PARCEL_HOLD_GRACE = 300_000;

// Merrit parcel state
/** Our claimed parcel spot */
let homeLocation = { map: "main", x: -116, y: 0 };
/** Spots the server refused, as "x,y" */
const rejectedStandSpots = new Set();
/** When we parked on homeLocation, 0 while not */
let standParkedAt = 0;
/** Last merrit_status, with when and where it arrived */
let merritStatus = null;
/** When the parcel cooldown ends, 0 while unknown */
let parcelCooldownEndsAt = 0;

/** @returns {Object} Merrit's market rules */
const merritMarket = () => G.npcs.citizen22.market;

parent.socket?.on("merrit_status", (data) => {
  const reasons = data?.reasons ?? [];
  const now = Date.now();

  merritStatus = {
    reasons,
    at: now,
    x: character.real_x,
    y: character.real_y,
  };

  if (reasons.some((r) => r.code === "unavailable")) return;
  const cooldown = reasons.find((r) => r.code === "cooldown");
  parcelCooldownEndsAt = now + (cooldown?.remaining_ms ?? 0);
});

parent.socket?.emit("interaction", { type: "merrit_info" });

/** @returns {boolean} whether the stand must stay parked for the next parcel */
function isAwaitingParcel() {
  if (!parcelCooldownEndsAt) return false;

  const { settle_ms } = merritMarket();
  const now = Date.now();

  return (
    now >= parcelCooldownEndsAt - settle_ms - PARCEL_HOLD_LEAD &&
    now <= parcelCooldownEndsAt + settle_ms + PARCEL_HOLD_GRACE
  );
}

/** @returns {number} centre-to-centre px from us to spot */
const distanceToSpot = (spot) =>
  Math.hypot(character.real_x - spot.x, character.real_y - spot.y);

const haveAComputer = () =>
  locate_item("computer") !== -1 || locate_item("ancientcomputer") !== -1;

/** @returns {number[][]} [x, y] of every NPC on main that never moves */
function getFixedMainNpcs() {
  return (G.maps.main.npcs ?? [])
    .filter((npc) => {
      const def = G.npcs[npc.id];
      return def && def.role !== "citizen" && !def.moving && !npc.loop;
    })
    .map((npc) => npc.position ?? npc.positions?.[0])
    .filter(Boolean);
}

/**
 * @param {{x: number, y: number}} spot
 * @returns {boolean} whether another open stand rules this spot out
 */
function isSpotTaken(spot) {
  const market = merritMarket();

  for (const id in parent.entities) {
    const entity = parent.entities[id];
    if (entity?.type !== "character" || !entity.stand) continue;
    if (entity.name === character.name) continue;

    const dx = Math.abs(spot.x - entity.real_x);
    const dy = Math.abs(spot.y - entity.real_y);

    if (Math.hypot(dx, dy) <= market.stand_clearance + STAND_SPACING_MARGIN)
      return true;

    if (
      dx <= market.front_width + STAND_SPACING_MARGIN &&
      dy <= market.front_clearance + STAND_SPACING_MARGIN
    )
      return true;
  }

  return false;
}

/**
 * @param {{x: number, y: number}} spot
 * @returns {boolean} whether Merrit would visit a stand opened here
 */
function isSpotViable(spot) {
  const market = merritMarket();

  if (rejectedStandSpots.has(`${spot.x},${spot.y}`)) return false;

  const inArea = market.areas.some(
    ([x0, y0, x1, y1]) =>
      spot.x >= x0 && spot.x <= x1 && spot.y >= y0 && spot.y <= y1,
  );
  if (!inArea) return false;

  const nearNpc = getFixedMainNpcs().some(
    ([x, y]) =>
      Math.hypot(spot.x - x, spot.y - y) <=
      market.npc_clearance + STAND_SPACING_MARGIN,
  );
  if (nearNpc) return false;

  try {
    if (!strategicSmartMove.isStandablePoint({ map: "main", ...spot }))
      return false;
  } catch (e) {}

  return !isSpotTaken(spot);
}

/** @returns {boolean} whether we already stand open on homeLocation */
function isHoldingHome() {
  const holding =
    character.map === homeLocation.map &&
    character.stand &&
    !character.moving &&
    distanceToSpot(homeLocation) <= merritMarket().anchor_tolerance;

  if (!holding) standParkedAt = 0;
  else if (!standParkedAt) {
    standParkedAt = Date.now();
    parent.socket?.emit("interaction", { type: "merrit_info" });
  }

  return holding;
}

/** @returns {boolean} whether the server refused our spot since we parked */
function isHomeRefused() {
  if (!standParkedAt || !merritStatus || merritStatus.at < standParkedAt)
    return false;

  const anchor = merritMarket().anchor_tolerance;
  const statusOffset = Math.hypot(
    merritStatus.x - homeLocation.x,
    merritStatus.y - homeLocation.y,
  );
  if (statusOffset > anchor) return false;

  return merritStatus.reasons.some((r) =>
    MERRIT_SPOT_BLOCKERS.includes(r.code),
  );
}

/** @returns {Object|undefined} the viable spot in Merrit's areas nearest to us */
function findStandSpot() {
  const { areas } = merritMarket();
  let best;
  let bestDistance = Infinity;

  for (const [x0, y0, x1, y1] of areas) {
    for (let x = x0; x <= x1; x += STAND_SCAN_STEP) {
      for (let y = y0; y <= y1; y += STAND_SCAN_STEP) {
        const spot = { map: "main", x, y };
        const d = distanceToSpot(spot);
        if (d >= bestDistance || !isSpotViable(spot)) continue;

        best = spot;
        bestDistance = d;
      }
    }
  }

  return best;
}

/**
 * Keeps homeLocation on a spot Merrit will visit; one we already hold is ours.
 * @returns {Object} homeLocation
 */
function claimStandSpot() {
  if (character.map !== homeLocation.map) return homeLocation;

  if (isHoldingHome()) {
    if (!isHomeRefused()) return homeLocation;

    rejectedStandSpots.add(`${homeLocation.x},${homeLocation.y}`);
    standParkedAt = 0;
  } else if (isSpotViable(homeLocation)) {
    return homeLocation;
  }

  const spot = findStandSpot();
  if (spot) {
    log(`Merrit spot moved to ${spot.x},${spot.y}`);
    homeLocation = spot;
  }

  return homeLocation;
}

async function moveHome() {
  const spot = claimStandSpot();

  if (
    distanceToSpot(spot) <= merritMarket().anchor_tolerance ||
    smart.moving ||
    isAdvanceSmartMoving ||
    isDraggingMobs
  )
    return;

  try {
    log("Moving back Town!");
    await advanceSmartMove(spot, {
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
      // craft("froststaff", 1, { map: "main", x: -2, y: 295 }),
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
      craft("cloverstud", 1, { map: "main", x: -2, y: 295 }),
      craft("scribeorb", 1, { map: "main", x: -2, y: 295 }),
      craft("glacierseal", 1, { map: "main", x: -2, y: 295 }),
      // craft("firestaff", character.esize - 6, { map: "main", x: -2, y: 295 }),
      // craft("firestars", character.esize - 6, { map: "main", x: -2, y: 295 }),
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

// --- Skills, each on its own runSkillLoop (see startSkillLoops) ---

// Merchant's Luck lasts an hour; ours get topped up with half of it left
const MLUCK_REFRESH_MS = 1800000;
// A stranger we aimed at is passed over this long, whether the cast landed or not
const MLUCK_RETRY_MS = 1000;

/** character name -> when we last aimed an mluck at them */
const mluckAimedAt = {};

/**
 * @param {Object} entity - a character within mluck range
 * @returns {boolean} whether they still want our luck
 */
function wantsMluck(entity) {
  const buff = entity.s?.mluck;

  if (!buff) return true;

  // Already ours, so it is a top-up rather than a fresh cast
  if (isOwnedCharacter(entity.name) || buff.f === character.name)
    return buff.ms < MLUCK_REFRESH_MS;

  // Strong luck can't be overwritten, so it isn't worth an attempt
  if (buff.strong) return false;

  return Date.now() - (mluckAimedAt[entity.name] ?? 0) > MLUCK_RETRY_MS;
}

/** @returns {Object} the character most worth lucking, ours first */
function getMluckTarget() {
  const candidates = [character];

  for (const id in parent.entities) {
    const entity = parent.entities[id];
    if (entity?.type !== "character" || entity.npc || entity.rip) continue;
    if (!is_in_range(entity, "mluck")) continue;
    candidates.push(entity);
  }

  return candidates.filter(wantsMluck).sort((lhs, rhs) => {
    const lhsOurs = isOwnedCharacter(lhs.name);
    const rhsOurs = isOwnedCharacter(rhs.name);
    if (lhsOurs !== rhsOurs) return lhsOurs ? -1 : 1;

    return (lhs.s?.mluck?.ms ?? 0) - (rhs.s?.mluck?.ms ?? 0);
  })[0];
}

function startSkillLoops() {
  // runSkillLoop always calls canUse right before cast, so canUse stashes what
  // it approved and cast reuses it instead of recomputing the scan.
  let pendingMluckTarget = null;

  runSkillLoop({
    skill: "mluck",
    floorMs: 250,
    whileMoving: true,
    canUse: () => {
      if (character.mp < G.skills.mluck.mp) return false;
      pendingMluckTarget = getMluckTarget();
      return pendingMluckTarget != null;
    },
    cast: () => {
      mluckAimedAt[pendingMluckTarget.name] = Date.now();
      return use_skill("mluck", pendingMluckTarget);
    },
  });
}

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
  { name: "intring" },
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
  // { name: "throwingstars", maxLevel: 0 },
  { name: "angelwings" },
  // { name: "smoke" },
  { name: "gphelmet" },
  { name: "vitring", maxLevel: 3 },
  { name: "vitearring", maxLevel: 3 },
  { name: "wbook0", maxLevel: 4 },
  { name: "embercore" },
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
merchantScoutingLoop();
startSkillLoops();

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
