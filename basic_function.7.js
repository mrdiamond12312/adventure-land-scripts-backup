// Load caracAL configs
var caracALconfig = null;
try {
  caracALconfig = require("../config");
} catch (err) {}

// Global vars
var attack_mode = true;
// var partyMems = ["MowTheCooh", "MoohThatCow", "CupidCow"];
var partyMems = ["MooohMoooh", "CowTheMooh", "MowTheCooh"];
// var partyMems = ["CowTheMooh", "MowTheCooh", "MoohThatCow"];

const MAGE = "MowTheCooh";
const WARRIOR = "MooohMoooh";
const ROGUE = "MooohSteak";
const RANGER1 = "MoohThatCow";
const RANGER2 = "CupidCow";
const PRIEST = "CowTheMooh";
var HEALER = PRIEST;
var RANGER = RANGER1;

var TANKER =
  partyMems.find((id) => [HEALER, WARRIOR].includes(id)) ?? partyMems[0];
// var TANKER = "CowTheMooh";

const MIDAS_CHARACTER = [MAGE, "CrownPriest"];

// Outsiders we team up with — their tank changes what the party can hold
const trustedPartners = ["earthPri", "earthWar"];
const knownTankers = ["CrownPriest", "Hierophant", 
  // ...trustedPartners
];

/** Cave of Many Dreams — the one switch for the daily run, loader and all */
var USE_CAVE_STRATEGY = true;

const CODE_SLOTS = {
  MoohThatCow: { script: 32 },
  CowTheMooh: { script: 2 },
  MooohMoooh: { script: 9 },
  MowTheCooh: { script: 4 },
  MerchantMooh: { script: 5 },
  MoohChan: { script: 5 },
  CupidCow: { script: 32 },
  MooohSteak: { script: 31 },
};

/** The realm this character told Bean to call home — Bean's choice is not readable from CODE */
const HOME_SERVER = {
  serverRegion: "US",
  serverIdentifier: "IV",
};

/** Published by server_hop_utilities.25.js */
const HOME_WINDOW_LS_KEY = "homeWindow";

/** Set while gathering for a cave run */
const CAVE_GATHERING_LS_KEY = "caveGathering";

/** Whether fighters harakiri on a server hop's loot-before-hopping cm */
var HARAKIRI_ON_SERVER_HOP = false;

/** Server's `mode.fear_affects_heal` */
const FEAR_AFFECTS_HEAL = false;

/** @returns {string} the realm we are on right now, e.g. "USII" */
function getCurrentServer() {
  return `${server.region}${server.id}`;
}

/** @returns {string} the configured home realm, e.g. "USII" */
function getHomeServer() {
  return `${HOME_SERVER.serverRegion}${HOME_SERVER.serverIdentifier}`;
}

/** @returns {boolean} whether we are standing on the configured home realm */
function isAtHomeServer() {
  return getCurrentServer() === getHomeServer();
}

/** @returns {number} the UTC midnight that ends the day `at` falls on */
function getUtcDayEnd(at = Date.now()) {
  return new Date(at).setUTCHours(24, 0, 0, 0);
}

/**
 * @param {object} [schedule] a realm's server.status.schedule
 * @param {string[]} events
 * @returns {{event: string, status: string, at: number}[]} its `scheduled` and `live` lineup entries for `events`, dated and repeating
 */
function getLineup(schedule, events) {
  return [...(schedule?.events ?? []), ...(schedule?.repeats ?? [])].filter(
    (entry) =>
      events.includes(entry.event) &&
      ["scheduled", "live"].includes(entry.status),
  );
}

var partyMerchant = "MerchantMooh";

/** @returns {string[]} our own characters — the current roster plus the merchant */
function getMyCharacters() {
  return [...partyMems, partyMerchant];
}

/**
 * Every character on the account, roster or not.
 * @param {string} name
 * @returns {boolean}
 */
function isOwnedCharacter(name) {
  return name in CODE_SLOTS;
}

/**
 * Everyone we fight alongside — ours, plus whatever outsider shares the party.
 * @returns {Set<string>}
 */
function getAlliedNames() {
  return new Set([
    character.name,
    ...getMyCharacters(),
    ...(parent.party_list ?? []),
  ]);
}
var basicRangeRate = 0.5; // Is used to reset
var rangeRate = basicRangeRate; // Variate range rate

const spacial = 16;

// Monsters selector
var min_xp = 100;
var max_att = 2000;

// Ignore mob with high d-return
const MELEE_IGNORE_LIST = ["porcupine"];

// Cave sides the run refuses to let us damage, plus the one we are paid to
// leave standing. Every skill aimed at one comes back `friendly_target`
const CAVE_SIDES_TO_LEAVE = ["neutral", "ally", "victim"];

/**
 * Whether a cave run forbids swinging at this one. False outside a run.
 * @param {object} entity
 * @returns {boolean}
 */
function isCaveFriendly(entity) {
  return CAVE_SIDES_TO_LEAVE.includes(entity?.cave?.side);
}

/** How close a player wakes a cave camp */
const CAVE_WAKE_RANGE = 210;

/** @returns {object[]} the party's characters in view */
function getCavePartyInView() {
  return [...getAlliedNames()]
    .map((name) => (name === character.name ? character : get_entity(name)))
    .filter((member) => member && !member.rip);
}

/**
 * Whether a cave mob's camp is awake.
 * @param {object} entity
 * @returns {boolean}
 */
function isCaveMobAwake(entity) {
  const party = getCavePartyInView();

  return Object.values(parent.entities).some(
    (other) =>
      other.cave?.room === entity.cave?.room &&
      !other.dead &&
      (other.hp < other.max_hp ||
        party.some((member) => distance(member, other) <= CAVE_WAKE_RANGE)),
  );
}

/**
 * Whether a mob is fighting us; cave mobs never report a target.
 * @param {object} entity
 * @returns {boolean}
 */
function isMonsterEngaged(entity) {
  if (entity.cave) return isCaveMobAwake(entity);

  return Boolean(entity.target);
}

// localStorage's Scout info key
const SCOUT_LS_KEY = "scoutInfo";

// localStorage's cross-realm sighting key, written by the realm observers
const REALM_SIGHTINGS_LS_KEY = "realmSightings";

/**
 * Reads a localStorage-backed record store, keyed by entry id.
 * @param {string} key
 * @returns {Object<string, object>}
 */
function readStore(key) {
  return get(key) ?? {};
}

/**
 * Merges fields into one entry of a store, leaving the rest of it alone.
 * A field set to undefined drops out, since JSON.stringify omits it — that is
 * how an entry forgets something without clearing the whole record.
 * @param {string} key
 * @param {string} entryId
 * @param {object} fields
 */
function updateStoreEntry(key, entryId, fields) {
  const store = readStore(key);
  store[entryId] = { ...store[entryId], ...fields };
  set(key, store);
}

/** Realm -> NPC id -> its last sighting */
const NPC_SIGHTINGS_LS_KEY = "npcSightings";
const ROAMING_NPC_IDS = ["$Kane", "$Angel"];
const NPC_SIGHTING_STALE_MS = 60 * 60 * 1000;

function noteRoamingNpcs() {
  for (const id of ROAMING_NPC_IDS) {
    const npc = parent.entities[id];
    if (!npc) continue;

    updateStoreEntry(NPC_SIGHTINGS_LS_KEY, getCurrentServer(), {
      [id]: {
        map: character.map,
        x: npc.real_x,
        y: npc.real_y,
        seenAt: Date.now(),
      },
    });
  }
}

/** @returns {Object|undefined} the NPC in sight, else its fresh sighting on the realm */
function getRoamingNpcSpot(id, realm = getCurrentServer()) {
  const npc = realm === getCurrentServer() && parent.entities[id];
  if (npc) return { map: character.map, x: npc.real_x, y: npc.real_y };

  const sighting = readStore(NPC_SIGHTINGS_LS_KEY)[realm]?.[id];
  if (!sighting || Date.now() - sighting.seenAt > NPC_SIGHTING_STALE_MS)
    return undefined;

  return { map: sighting.map, x: sighting.x, y: sighting.y };
}

/**
 * Mini-bosses every part of the chain cares about — the scout sweeps them, the
 * fighters hunt them, the realm observers watch for them. Shared so the three
 * cannot drift apart.
 */
const SPECIAL_MOB_IDS = [
  "cutebee",
  "skeletor",
  "mvampire",
  "fvampire",
  "stompy",
  "goldenbat",
  "phoenix",
  "goldenbot",
  "rharpy",
  "paledino",
  "manyeye",
  "mimic",
];

/** Bosses every fighter drops everything to hit while one is in sight */
const PRIORITY_MOB_IDS = ["slenderman", "grinch"];

// var map = "main";
// var mapX = 1248;
// var mapY = -63;

// var map = "uhills";
// var mapX = -289;
// var mapY = -188;

// var map = "winterland";
// var mapX = 423;
// var mapY = -2614;

// var map = "desertland";
// var mapX = 223;
// var mapY = -708;

// var map = "tunnel";
// var mapX = 0;
// var mapY = -775;

// var map = "halloween";
// var mapX = -219;
// var mapY = 681;

// var map = "main";
// var mapX = 676;
// var mapY = 1754;

// var map = "halloween";
// var mapX = -368;
// var mapY = -1623;

// var map = "main";
// var mapX = -1111;
// var mapY = 132;

// var map = "desertland";
// var mapX = -840.75;
// var mapY = -340.75;

// var map = "level1";
// var mapX = 50;
// var mapY = 425;

// var map = "spookytown";
// var mapX = 256;
// var mapY = -1253;

// var map = "spookytown";
// var mapX = 412;
// var mapY = -694;

// var map = "mforest";
// var mapX = -172;
// var mapY = 708;

// var map = "mforest";
// var mapX = 403;
// var mapY = -347;

var map = "mforest";
var mapX = -25;
var mapY = 700;

// var mobsToFarm = ["grinch", "phoenix", "spider", "bigbird", "scorpion"];
// var mobsToFarm = ["goldenbot", "sparkbot", "sparkbot"];
// var mobsToFarm = ["phoenix", "stompy", "wolf"];
// var mobsToFarm = ["fireroamer"];
// var mobsToFarm = ["grinch", "phoenix", "mole"];

// var mobsToFarm = ["phoenix", "xscorpion", "minimush"];

// var mobsToFarm = ["phoenix", "croc", "armadillo"];
// var mobsToFarm = ["fvampire", "grinch", "phoenix", "ghost"];
// var mobsToFarm = [
//   "phoenix",
//   "frog",
//   "squigtoad",
//   "crab",
//   "squig",
//   "turtle",
//   "crabx",
// ];
// var mobsToFarm = ["ent", "plantoid", "mechagnome"];
// var mobsToFarm = ["prat"];
// var mobsToFarm = ["mummy"];
// var mobsToFarm = ["dryad", "mechagnome"];
// var mobsToFarm = ["jr", "booboo"];
var mobsToFarm = ["paledino", "odino", "mechagnome"];

var farmTanker = PRIEST;
var warriorHeldMobs = ["ent"];

/** Steer kills and damage by grow-group spawn rules (growth_tracker.34.js) */
var USE_GROWTH_TARGETING = true;

// desired elixir named
var desiredElixir = "elixirluck";

// TRACKTRIX
async function get_tracktrix_data() {
  let resolve;
  let prom = new Promise((r) => (resolve = r));
  let prev = parent.socket._callbacks.$tracker[0];
  parent.socket._callbacks.$tracker[0] = (data) => {
    parent.socket._callbacks.$tracker[0] = prev;
    resolve(data);
  };
  parent.socket.emit("tracker");
  return prom;
}

async function getMaxScore(monsterId) {
  return (await get_tracktrix_data()).max.monsters[monsterId];
}

//// INVENTORY functions
function isInvFull(slots = 1) {
  return character.esize <= slots;
}

function bestLooter() {
  return partyMems
    .map((id) => get_entity(id))
    .filter((player) => player)
    .sort((lhs, rhs) => lhs.goldm - rhs.goldm)
    .pop();
}

function getTotalQuantityOf(item) {
  return character.items.reduce((accummulator, current, index) => {
    return (
      accummulator + (current && current.name === item ? current.q || 1 : 0)
    );
  }, 0);
}

// basic_function parts: definitions only, loaded before anything below runs
if (parent.caracAL) {
  parent.caracAL.load_scripts([
    "adventure-land-scripts-backup/basic_function_loop.45.js",
    "adventure-land-scripts-backup/basic_function_trips.46.js",
    "adventure-land-scripts-backup/basic_function_kiting.47.js",
    "adventure-land-scripts-backup/basic_function_loot.48.js",
    "adventure-land-scripts-backup/basic_function_events.53.js",
  ]);
} else {
  load_code(45);
  load_code(46);
  load_code(47);
  load_code(48);
  load_code(53);
}

// Strategic functions
if (parent.caracAL) {
  parent.caracAL.load_scripts([
    "adventure-land-scripts-backup/strategic_fn.11.js",
  ]);
  if (character.ctype !== "merchant") {
    parent.caracAL.load_scripts([
      "adventure-land-scripts-backup/normal_strategy.12.js",
      "adventure-land-scripts-backup/pull_strategy.13.js",
      "adventure-land-scripts-backup/growth_tracker.34.js",
    ]);
  }
} else {
  load_code(11);
  if (character.ctype !== "merchant") {
    // Strategy that Pulls Mobs and blast them with lolipops, gstaff, etc
    load_code(13);
    // Normal
    load_code(12);
    load_code(34);
    var currentStrategy = usePullStrategies;
  }
}

// Party plan — read by 25 and 14, so it loads first
if (parent.caracAL) {
  parent.caracAL.load_scripts(["adventure-land-scripts-backup/party_plan.37.js"]);
} else {
  load_code(37);
}

// Server hoping — 25 defines the policy 14 consults, so it loads first
if (parent.caracAL && caracALconfig.characters[character.name].enabled) {
  parent.caracAL.load_scripts([
    "adventure-land-scripts-backup/server_hop_utilities.25.js",
    "adventure-land-scripts-backup/server_hop.14.js",
  ]);
} else if (!parent.caracAL && !character.controller) {
  load_code(25);
  load_code(14);
}

var disablePullingStrategy = false;
const asyncNoop = async () => {};

/** Only the native branch declares one, and never for a merchant */
var currentStrategy =
  typeof currentStrategy === "function" ? currentStrategy : asyncNoop;

function changeToPullStrategies() {
  const normal =
    typeof useNormalStrategy === "function" ? useNormalStrategy : asyncNoop;

  const pull =
    typeof usePullStrategies === "function" ? usePullStrategies : asyncNoop;

  currentStrategy = disablePullingStrategy ? normal : pull;
}

function changeToNormalStrategies() {
  currentStrategy =
    typeof useNormalStrategy === "function" ? useNormalStrategy : asyncNoop;
}

// Debug stucking
var smartmoveDebug = false;

// Smart move strategies
var isAdvanceSmartMoving = false;
if (parent.caracAL) {
  parent.caracAL.load_scripts([
    "adventure-land-scripts-backup/crypt_fighter_strat.16.js",
    "adventure-land-scripts-backup/taut_path.33.js",
    "adventure-land-scripts-backup/strategic_smart_move.21.js",
    "adventure-land-scripts-backup/advance_smart_move.20.js",
  ]);
} else {
  load_code(16);
  load_code(33);
  load_code(21);
  load_code(20);
}

function calculateRangeRate() {
  switch (character.ctype) {
    case "priest":
      return isAssignedAsTanker() && currentStrategy === usePullStrategies
        ? 0.2
        : 0.5;
    default:
      return undefined;
  }
}

function isMerchant() {
  return character.ctype === "merchant";
}

//// Loops started at load
if (parent.leadSkillTimeout)
  parent.socket.off("skill_timeout", parent.leadSkillTimeout);
parent.leadSkillTimeout = leadSkillTimeout;
parent.socket.on("skill_timeout", leadSkillTimeout);

potionLoop();
startCosmeticSkillLoops();
// Starting Positioning loop
hitAndRun();
respawnOnceDead();

setInterval(() => {
  suicide();
  if (!MIDAS_CHARACTER.includes(character.name) || !isEquipingItems) {
    midasLooting();
  }
}, 100);

//// Interval threads
// Code Messaging
setInterval(async function () {
  // No route runs between the cave and the merchant, either way
  if (character.cave) return;

  // Xmas buffs
  if (server.status["holidayseason"] && !character.s.holidayspirit) {
    log("Ting ting ting");
    await advanceSmartMove({ map: "main", x: -152, y: -137 });
    parent.socket.emit("interaction", { type: "newyear_tree" });
  }

  // The merchant has no merchant to ask — it buys its own stack instead of
  // sending itself the buy_potions cm below
  if (isMerchant()) {
    if (canUseNpcsRemotely() && !isInvFull(2)) {
      for (const potionId of desiredPotions) {
        const owned = getTotalQuantityOf(potionId);
        if (owned >= POTION_REFILL_AT) continue;
        await buy(potionId, POTION_STACK - owned).catch((e) => log(e));
      }
    }
    return;
  }

  const obj = {
    map: character.map,
    x: character.x,
    y: character.y,
  };

  // Merchant buff
  if (
    !character.s ||
    !character.s.mluck ||
    character.s.mluck.f !== partyMerchant
  ) {
    log("Asking our merchant for some luck!");
    send_cm(partyMerchant, { msg: "buff_mluck", ...obj });
  }

  // Send things to merchant if he's nearby
  if (get_entity(partyMerchant)) {
    send_gold(partyMerchant, character.gold - 1000000);
    await Promise.all(
      character.items.map(async (item, index) => {
        if (!item) return;
        if (
          item.level > 0 ||
          [
            "tracker",
            "hpot1",
            "mpot1",
            "cdragon",
            "oxhelmet",
            // Remove for christmas snowman server hopping
            // "snowball",
            "spookyamulet",
            "xptome",
            "xpbooster",
            "goldbooster",
            "luckbooster",
            "suckerpunch",
            desiredElixir,
            "elixirluck",
          ].includes(item.name)
        )
          return;
        await send_item(partyMerchant, index, 1000).catch((e) => log(e));
      }),
    );
  }

  const potionToRestock = desiredPotions.find(
    (potion) => getTotalQuantityOf(potion) < POTION_REQUEST_AT,
  );

  // Inventory check and potions
  if (isInvFull(4)) {
    log("Inventory full! Calling our merchant!");
    send_cm(partyMerchant, { msg: "inv_full", ...obj });
  } else if (!isInvFull(2) && potionToRestock) {
    log(`Asking the merchant for some ${potionToRestock}...`);
    send_cm(partyMerchant, {
      msg: "buy_potions",
      potion: potionToRestock,
      ...obj,
    });
  } else if (!character.slots.elixir || !character.slots.elixir.name) {
    log("Drinking Elixir");

    const elixirSlot = locate_item(desiredElixir);

    if (elixirSlot !== -1) {
      consume(elixirSlot);
    } else {
      log("No elixir left! Callin our merchant...");
      send_cm(partyMerchant, { msg: "elixir", ...obj, elixir: desiredElixir });
    }
  } else if (!isInvFull(2) && locate_item("xptome") === -1) {
    log("Asking the merchant for a Tome of Protection...");
    send_cm(partyMerchant, { msg: "xptome", ...obj });
  }
}, 10000);

/**
 * Get all character in the server
 * @author earthiverse
 * @returns list of character in server
 */
async function getServerPlayers() {
  const playersData = new Promise((resolve, reject) => {
    const dataCheck = (data) => {
      resolve(data);
    };

    setTimeout(() => {
      parent.socket.off("players", dataCheck);
      reject(`getServerPlayers timeout (2500ms)`);
    }, 2500);
    parent.socket.once("players", dataCheck);
  });
  parent.socket.emit("players");
  return playersData;
}

/** Raised by cave_fighter_strat.15.js while a run is being set up or fought */
var isPreparingCave = false;

// Party Setups
setInterval(async () => {
  // if (isMerchant()) return;

  // A run's roster is fixed and the server refuses party calls from inside it
  if (character.cave) return;

  const currentPartySize = parent.party_list.length;
  const serverCharacters = await getServerPlayers();
  const partyWhitelistRegex = [/^earth/];
  const whitelistPartyMembers = serverCharacters.filter(
    (char) =>
      !partyMems.includes(char.name) &&
      partyWhitelistRegex.some((regex) => regex.test(char.party)),
  );
  const hasWhitelistedMember = parent.party_list.some((member) =>
    whitelistPartyMembers.some((whitelisted) => whitelisted.name === member),
  );

  const myMemberList = getMyCharacters();

  const characterNotInOutsiderParty = serverCharacters.filter(
    (char) =>
      myMemberList.includes(char) &&
      !partyWhitelistRegex.some((regex) => regex.test(char.party)),
  );

  // The whitelist matches on party name; only an earth* character gets the ask
  const inviteTarget = whitelistPartyMembers.find((member) =>
    partyWhitelistRegex.some((regex) => regex.test(member.name)),
  );

  // A kick fails on anyone who joined before the kicker, so outsiders leave
  const isSittingOutCave =
    USE_CAVE_STRATEGY &&
    !partyMems.includes(character.name) &&
    isCaveUnderway();

  if (isSittingOutCave) {
    if (parent.party_list.some((name) => partyMems.includes(name)))
      leave_party();
  } else if (isPreparingCave) {
    // The cave takes the current party in, and an outsider needs their own visit
    if (hasWhitelistedMember) leave_party();
  } else if (
    inviteTarget &&
    whitelistPartyMembers.length + characterNotInOutsiderParty.length <= 10 &&
    (!currentPartySize || !hasWhitelistedMember)
  ) {
    send_party_request(inviteTarget.name);
  } else if (
    currentPartySize &&
    hasWhitelistedMember &&
    currentPartySize + characterNotInOutsiderParty.length > 10
  )
    leave_party();

  if (Math.min(...parent.pings) > 1000 && character.ctype !== "merchant") {
    if (parent.caracAL) parent.caracAL.shutdown();
    else disconnect();
  }

  // The cave takes only partyMems, so the merchant sits the run out
  const wantedMembers = isPreparingCave ? partyMems : myMemberList;

  if (
    isPreparingCave &&
    character.name === partyMems[0] &&
    typeof kick_party_member === "function"
  ) {
    parent.party_list
      .filter((name) => !partyMems.includes(name))
      .forEach((name) => kick_party_member(name).catch(() => undefined));
  }

  if (wantedMembers.some((id) => !parent.party_list.includes(id))) {
    if (character.name === partyMems[0]) {
      wantedMembers.forEach((member) => {
        send_party_invite(member);
      });
    }
  }

  // put this in a loop somewhere :cow2:
  if (character.afk && !is_paused()) pause();
  else if (!character.afk && is_paused()) pause();

  leaveJail();
}, 10000);

//// Events listeners
// Party Events
function on_party_invite(name) {
  if (name === partyMems[0]) accept_party_invite(name);
}

setInterval(() => {
  if (!isMerchant() && parent.party_list)
    set("currentParty", parent.party_list);
}, 5000);

// party_plan.37.js's presets read HP_RANKED_BOSSES
dynamicParty();
setInterval(dynamicParty, 3000);

// Fighter targeting strategies — the first one to own the tick wins
if (character.ctype !== "merchant") {
  if (parent.caracAL) {
    parent.caracAL.load_scripts([
      ...(USE_CAVE_STRATEGY
        ? ["adventure-land-scripts-backup/cave_fighter_strat.15.js"]
        : []),
      "adventure-land-scripts-backup/daily_event_fighter_strat.26.js",
      "adventure-land-scripts-backup/special_mob_fighter_strat.28.js",
      "adventure-land-scripts-backup/farming_fighter_strat.27.js",
    ]);
  } else {
    if (USE_CAVE_STRATEGY) load_code(15);
    load_code(26);
    load_code(28);
    load_code(27);
  }

  var fighterStrategies = [
    usePriorityMobStrategy,
    // The identifier only resolves when slot 15 was loaded above
    ...(USE_CAVE_STRATEGY ? [useCaveRunStrategy] : []),
    useWitchGatheringStrategy,
    useEventStrategy,
    ...(USE_CAVE_STRATEGY ? [useCaveEntryStrategy] : []),
    useCryptStrategy,
    useTrickOrTreatStrategy,
    useSpecialMobStrategy,
    useFarmingStrategy,
  ];
}

/**
 * This tick is mine, hit this — each class aims at it in mainLoop and its action loop swings.
 * @param {object} [target]
 * @param {Object} [options]
 * @param {boolean} [options.isPinned] - hand-picked: the class's own target pick keeps it
 */
const engage = (target, { isPinned = false } = {}) => ({ target, isPinned });

/** id of the target the tick's strategy pinned, if any */
var pinnedTargetId;

/**
 * @param {Object} [target]
 * @returns {boolean} whether the tick's strategy pinned this target
 */
const isPinnedTarget = (target) =>
  !!target && target.id !== undefined && target.id === pinnedTargetId;

/** @returns {Object|undefined} the nearest priority boss in view, hit to the exclusion of all else */
function getPriorityBossInView() {
  return Object.values(parent.entities)
    .filter(
      (entity) =>
        entity.type === "monster" &&
        !entity.dead &&
        PRIORITY_MOB_IDS.includes(entity.mtype),
    )
    .sort((lhs, rhs) => distance(character, lhs) - distance(character, rhs))[0];
}

/** This tick is mine with nothing to hit: it went into the trip. */
const travelling = () => ({});

/**
 * Runs the fighter strategies in priority order. The first one to claim the
 * tick decides it, and only one that found something answers with a target.
 * Mid-trip only the strategies outranking the trip's owner run, and one of
 * them claiming the tick takes the trip over.
 * @returns {Promise<object|undefined>} the entity to fight, if any
 */
async function selectFightTarget() {
  rangeRate = calculateRangeRate() ?? originRangeRate ?? basicRangeRate;

  try {
    for (const [rank, strategy] of fighterStrategies.entries()) {
      if (isOnTrip() && rank >= tripRank) {
        pinnedTargetId = undefined;
        return undefined;
      }

      activeStrategyRank = rank;
      const outcome = await strategy();
      if (!outcome) continue;

      // Claimed without a trip of its own, so the lower one is stale
      if (isOnTrip() && rank < tripRank) await abandonTrip();

      tickOwnerStrategy = strategy;
      pinnedTargetId = outcome.isPinned ? outcome.target?.id : undefined;
      return outcome.target;
    }
  } finally {
    activeStrategyRank = undefined;
  }

  tickOwnerStrategy = undefined;
  pinnedTargetId = undefined;
  return undefined;
}

function on_magiport(name) {
  if (name === MAGE) {
    accept_magiport(name);
  }
}

function attackErrorHandler(error, target = get_target()) {
  if (error.failed) {
    if (error.response === "cooldown" && error.place) {
      parent.skill_timeout(error.place, error.ms - Math.min(...parent.pings));
    } else if (error.reason === "too_far") {
      if (character.cc < 125 && target && !character.moving) {
        const currentX = character.x;
        const currentY = character.y;

        const targetX = target.real_x ?? target.x;
        const targetY = target.real_y ?? target.y;

        const newX = currentX + 0.4 * (targetX - currentX);
        const newY = currentY + 0.4 * (targetY - currentY);
        move(newX, newY);
      }

      // console.warn(
      //   error,
      //   error.distance
      //     ? `| ${Math.round(error.distance)} distance / ${
      //         character.range + character.xrange
      //       } range`
      //     : "",
      // );
    }
  } else console.warn("Error while attacking:", error);
}

setInterval(() => parent.socket.emit("send_updates", {}), 30000);
