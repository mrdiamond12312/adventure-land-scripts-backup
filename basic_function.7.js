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

const CODE_SLOTS = {
  MoohThatCow: {
    homeServer: "EUII",
    script: 32,
  },
  CowTheMooh: {
    homeServer: "ASIAI",
    script: 2,
  },
  MooohMoooh: {
    homeServer: "ASIAI",
    script: 9,
  },
  MowTheCooh: {
    homeServer: "ASIAI",
    script: 4,
  },
  MerchantMooh: {
    homeServer: "ASIAI",
    script: 5,
  },
  MoohChan: {
    homeServer: "USIII",
    script: 5,
  },
  CupidCow: {
    homeServer: "USII",
    script: 32,
  },
  MooohSteak: {
    homeServer: "USI",
    script: 31,
  },
};

var partyMerchant = "MerchantMooh";
var buffThreshold = 0.7;

//  run and hit
const movementHistory = [];
var flipRotation = 1;
var flipRotationCooldown = 0;
var angle; // Your desired angle from the monster, in radians
var flipCooldown = 0;
var stuckThreshold = 2;
var basicRangeRate = 0.5; // Is used to reset
var rangeRate = basicRangeRate; // Variate range rate

const spacial = 16;

// Monsters selector
var min_xp = 100;
var max_att = 2000;

// Ignore mob with high d-return
const MELEE_IGNORE_LIST = ["porcupine"];
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

var map = "desertland";
var mapX = -840.75;
var mapY = -340.75;

// var map = "level1";
// var mapX = 50;
// var mapY = 425;

// var map = "spookytown";
// var mapX = 255;
// var mapY = -1160;

// var map = "spookytown";
// var mapX = 412;
// var mapY = -694;

// var map = "mforest";
// var mapX = -172;
// var mapY = 708;

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
var mobsToFarm = ["ent", "plantoid", "mechagnome"];
// var mobsToFarm = ["prat"];
// var mobsToFarm = ["mummy"];
// var mobsToFarm = ["jr", "booboo"];
// var mobsToFarm = ["odino"];

// desired elixir named
var desiredElixir = "elixirluck";

//// INVENTORY functions
function item_info(item) {
  if (!item) return undefined;

  const baseInfo = parent.G.items[item.name];
  if (!baseInfo) return undefined;
  const itemProperties = calculate_item_properties(item, {
    def: baseInfo,
    class: character.class,
    map: character.map,
  });
  return { ...baseInfo, ...itemProperties };
}

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

// Strategic functions
if (parent.caracAL) {
  parent.caracAL.load_scripts([
    "adventure-land-scripts-backup/strategic_fn.11.js",
  ]);
  if (character.ctype !== "merchant") {
    parent.caracAL.load_scripts([
      "adventure-land-scripts-backup/normal_strategy.12.js",
      "adventure-land-scripts-backup/pull_strategy.13.js",
    ]);
  }
} else {
  load_code(11);
  if (character.ctype !== "merchant") {
    // Strategy that Pulls Mobs and blast them with lolipops, gstaff, etc
    load_code(13);
    // Normal
    load_code(12);
    var currentStrategy = usePullStrategies;
  }
}

// Server hoping
if (parent.caracAL && caracALconfig.characters[character.name].enabled) {
  parent.caracAL.load_scripts([
    "adventure-land-scripts-backup/server_hop.14.js",
  ]);
} else if (!character.controller) {
  load_code(14);
}

var disablePullingStrategy = false;
const asyncNoop = async () => {};

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

// Merch boundary
const BUYABLE = [
  "helmet",
  "shoes",
  "gloves",
  "pants",
  "coat",
  "blade",
  "claw",
  "staff",
  "bow",
  "shield",
  "wand",
  "mace",
  "wbasher",
];

var IGNORE = [
  "staff",
  "hpot0",
  "mpot0",
  "cscroll0",
  "cscroll1",
  "cscroll2",
  "scroll0",
  "scroll1",
  "ornament",
  "mistletoe",
  "candy1",
  "candypop",
  "candycane",
  "candy0",
  "stand0",
  "pickaxe",
  "rod",
  "tracker",
  "sword",
  "orboffire",
  "orboffrost",
  "orbofplague",
  "orbofresolve",
  "snring",
  // "bowofthedead",
  // "daggerofthedead",
  "maceofthedead",
  "pmaceofthedead",
  "staffofthedead",
  "swordofthedead",
  "supermittens",

  // "horsecapeg",
  "throwingstars",
  "computer",
  "ancientcomputer",

  // avoid for manually upgrade/compound
  "northstar",
  "fallen",
  "fury",
  "starkillers",

  // avoid upgrading for selling
  "cape",
  "carrotsword",
  "xgloves",
  ...BUYABLE,
  // .filter((id) => id !== "blade"),
];

const STORE_ABLE = [
  "x0",
  "x1",
  "x2",
  "x3",
  "x4",
  "x5",
  "x6",
  "x7",
  "x8",
  "xbox",
  "egg0",
  "egg1",
  "egg2",
  "egg3",
  "egg4",
  "egg5",
  "egg6",
  "egg7",
  "egg8",
  "essenceofether",
  "spidersilk",
  "feather0",
  "vitscroll",
  "bunnyelixir",
  "pvptoken",
  "pumpkinspice",
  "eggnog",
  "offeringp",
  "offering",
  "monstertoken",
  "hotchocolate",
  "gum",
  "essenceofgreed",
  "mbones",
  "elixirint0",
  "elixirdex0",
  "cscroll2",
  "cryptkey",
  "cake",
  "elixirstr0",
  "elixirstr1",
  "elixirvit0",
  "elixirvit1",
  "elixirvit2",
  "essenceoflife",
  "frozenkey",
  "funtoken",
  "gem1",
  "rfangs",
  "whiteegg",
  "sstinger",
  "spores",
  "snakefang",
  "seashell",
  "rattail",
  "pstem",
  "poison",
  "pleather",
  "lspores",
  "lotusf",
  "lostearring",
  "leather",
  "ink",
  "gslime",
  "frogt",
  "forscroll",
  "essenceofnature",
  "essenceoffrost",
  "essenceoffire",
  "dexscroll",
  "cshell",
  "carrot",
  "bwing",
  "btusk",
  "bfur",
  "beewings",
  "ascale",
  "tombkey",
  "cscale",
  "spiderkey",
  "svenom",
  "vblood",
  "orboffire",
  "orboffrost",
  "orbofplague",
  "orbofresolve",
  "orba",
  "orbofstr",
  "orbofdex",
  "mysterybox",
  "weaponbox",
  "armorbox",
  "fury",
  "snring",
  "starkillers",
  "northstar",
  "orboftemporal",
  "networkcard",
  "electronics",
];

const SALE_ABLE = [
  // "smoke",
  "vgloves",
  "mcape",
  "wbook0",
  "santasbelt",
  "mushroomstaff",
  "slimestaff",
  "fieldgen0",
  "snowball",
  "carrotsword",
  "shield",
  // "wshoes",
  "wgloves",
  "wbreeches",
  "cclaw",
  "dagger",
  "rednose",
  "iceskates",
  "stinger",
  "vitring",
  "vitearring",
  "harmor",
  "hammer",
  "basher",
  "skullamulet",
  "stinger",
  "lantern",
  "hpbelt",
  "hpamulet",
  "phelmet",
  "ringsj",
  "hhelmet",
  "hgloves",
  "harmor",
  "hpants",
  "glolipop",
  "whiteegg",
  "hboots",
  "sword",
  "spear",
  "cape",
  // Easter's loots
  // "eears",
  "eslippers",
  "epyjamas",

  //Christmas loots
  // "xmashat",
  // "xmassweater",
  // "xmaspants",
  // "warmscarf",

  // Sell and replace by crypt's loots
  "intearring",
  "strearring",
  // "dexring",
  // "intring",
  // "dexamulet",
  // "stramulet",
  // Halloween temp for gold
  // "bowofthedead",
  // "daggerofthedead",
];

const DISMANTLE_LIST = [
  "maceofthedead",
  "pmaceofthedead",
  "staffofthedead",
  "swordofthedead",
];

var maxUpgrade = 7;
var maxCompound = 3;

// Smart move strategies
var isAdvanceSmartMoving = false;
if (parent.caracAL) {
  parent.caracAL.load_scripts([
    "adventure-land-scripts-backup/crypt_strategy.16.js",
    "adventure-land-scripts-backup/strategic_smart_move.21.js",
    "adventure-land-scripts-backup/advance_smart_move.20.js",
  ]);
} else {
  load_code(20);
  load_code(16);
}

// Wrapper to use which depends on client platform
async function advanceSmartMove(props, options = { useScare: true }) {
  if (
    parent.caracAL &&
    (typeof smartMove !== "function" ||
      typeof oldAdvanceSmartMove !== "function")
  )
    return asyncNoop();

  if (parent.caracAL) {
    return smartMove(props, options);
  } else {
    return oldAdvanceSmartMove(props, options);
  }
}

// Pre-set function
var isSortingInventory = false;

async function sortInv() {
  if (
    isSortingInventory ||
    character.q.upgrade ||
    character.q.compound ||
    character.q.exchange
  )
    return;

  isSortingInventory = true;

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
    isSortingInventory = false;
  });
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

function arrayShuffle(array) {
  let currentIndex = array.length;

  // While there remain elements to shuffle...
  while (currentIndex != 0) {
    // Pick a remaining element...
    let randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }
}

function getMonstersOnDeclares() {
  // if (character.name === partyMems[0]) arrayShuffle(mobsToFarm);
  for (const monster of ["grinch"]) {
    if (get_nearest_monster({ type: monster })) {
      return get_nearest_monster({ type: monster });
    }
  }

  // The merchant is actively dragging this mob type in from elsewhere (see dragEnt
  // in merchant_service.19.js) — don't declare it until it's actually arrived.
  const luringMobType = get("luringMobType");

  for (const monster of mobsToFarm) {
    if (monster === luringMobType) continue;
    if (get_nearest_monster({ type: monster })) {
      return get_nearest_monster({ type: monster });
    }
  }
}

async function withTimeout(
  promise,
  timeoutInterval = Math.max(...parent.pings),
) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(resolve, timeoutInterval)),
  ]);
}

async function waitUntil(fn, timeout = 10_000, interval = 100) {
  const start = Date.now();

  while (true) {
    try {
      if (fn()) return true;
    } catch (e) {
      console.warn("waitUntil fn error:", e);
      return false;
    }

    if (Date.now() - start > timeout) return false;

    await sleep(interval || 100);
  }
}

function pickRestoreSkill() {
  const isChanneling =
    character.c.town || character.c.fishing || character.c.mining;

  const shouldRestoreHp =
    character.hp / character.max_hp < character.mp / character.max_mp ||
    (character.hp < character.max_hp * 0.6 && character.mp > 1000);

  const stat = shouldRestoreHp ? "hp" : "mp";
  const missing = character[`max_${stat}`] - character[stat];
  const regenMissing = stat === "hp" ? 50 : 100;

  if (missing > 500 && !is_on_cooldown(`use_${stat}`) && !isChanneling)
    return `use_${stat}`;
  if (missing > regenMissing && !is_on_cooldown(`regen_${stat}`))
    return `regen_${stat}`;

  return undefined;
}

async function potionLoop() {
  try {
    const skillToUse = pickRestoreSkill();

    if (skillToUse) {
      await withTimeout(use_skill(skillToUse));

      const minPing = Math.min(...parent.pings);
      reduce_cooldown("use_mp", minPing);
      reduce_cooldown("use_hp", minPing);
    }
  } catch (e) {}
  setTimeout(
    potionLoop,
    Math.min(
      Math.max(ms_to_next_skill("use_mp"), 5),
      Math.max(ms_to_next_skill("use_hp"), 5),
    ),
  );
}
potionLoop();

function isMelee() {
  return character.range < 75;
}

function getTarget() {
  const leader = get_entity(TANKER) ?? get_entity(partyMems[0]);
  const declared = getMonstersOnDeclares();
  const party = new Set([...partyMems, partyMerchant, ...parent.party_list]);

  let target =
    declared && declared.cooperative ? declared : get_targeted_monster();
  if (target && !get_entity(target.id)) target = undefined;

  if (!target) {
    const isLeader = character.name === (leader?.name ?? partyMems[0]);

    if (isLeader) {
      target = declared ?? undefined;

      const mobsHittingParty = Object.values(parent.entities)
        .filter(
          (entity) =>
            entity.type === "monster" &&
            entity.target &&
            party.has(entity.target) &&
            entity.target !== character.name &&
            (!isMelee() || !MELEE_IGNORE_LIST.includes(entity.mtype)),
        )
        .sort(
          (lhs, rhs) => distance(rhs, character) - distance(lhs, character),
        );
      if (
        mobsHittingParty.length &&
        (!target || target.target === character.name || !target.cooperative)
      ) {
        target = mobsHittingParty[0];
      }
    } else {
      const declaredMob = declared;
      const aggroed = Object.values(parent.entities)
        .filter(
          (entity) =>
            entity.type === "monster" &&
            entity.target &&
            party.has(entity.target) &&
            distance(entity, character) < character.range + character.xrange,
        )
        .sort(
          (lhs, rhs) => distance(rhs, character) - distance(lhs, character),
        );

      if (leader) {
        let leaderTarget =
          get_target_of(leader) ?? get_nearest_monster({ target: leader.name });
        if (leaderTarget && party.has(leaderTarget.name))
          leaderTarget = undefined;

        target =
          leaderTarget ??
          aggroed[0] ??
          (declaredMob && declaredMob.attack < 200 ? declaredMob : undefined);
      } else {
        target = aggroed[0] ?? declaredMob;
      }
    }

    if (target) {
      change_target(target);
      return target;
    }

    set_message("No Monsters");

    if (
      !character.moving &&
      character.map !== "crypt" &&
      leader &&
      !smart.moving &&
      !isAdvanceSmartMoving &&
      character.cc < 125
    ) {
      const dist = distance(character, leader);
      if (dist > spacial) {
        const midX = character.x + (leader.x - character.x) / 2;
        const midY = character.y + (leader.y - character.y) / 2;
        if (can_move_to(midX, midY)) move(midX, midY);
      }
    }

    return;
  }

  return target;
}

const INTERVAL_BREAKPOINTS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
function getLoopInterval() {
  const dynamicInterval = INTERVAL_BREAKPOINTS.map(
    (breakpoint) => ((1 / character.frequency) * 1000) / breakpoint,
  ).find((loopInterval) => loopInterval > 250);
  const frequencyInterval = (1 / character.frequency) * 1000;

  return ms_to_next_skill("attack") <= dynamicInterval
    ? Math.max(ms_to_next_skill("attack"), 1)
    : (dynamicInterval ?? frequencyInterval);
}

function ms_to_next_skill(skill) {
  const next_skill = parent.next_skill[skill];
  if (next_skill == undefined) return 0;
  const ms = parent.next_skill[skill].getTime() - Date.now();
  return ms < 0 ? 0 : ms;
}

async function leaveJail() {
  if (character.map === "jail" && !smart.moving && !isAdvanceSmartMoving) {
    log("Jail escape plan!");
    return smart_move(find_npc("jailer")).then(() => {
      parent.socket.emit("leave");
    });
  }
}

function extraDistanceWithinHitbox(target) {
  if (!target) return 0;
  return Math.min(get_height(target) / 2, get_width(target) / 2) / 2;
}

var lastKitingTargetId = undefined;
const FRANKY_PREFER_SPOT = {
  x: 11,
  y: 8,
  map: "level2w",
};
function withFixedSpot(target, spot) {
  return {
    ...target,
    x: spot.x,
    y: spot.y,
    real_x: spot.x,
    real_y: spot.y,
    going_x: spot.x,
    going_y: spot.y,
  };
}

// Per-mtype overrides: some mobs get kited around a fixed spot instead of their own
// (moving) position — a corner of the map for FRANKY, the spawn center for CRABXX.
async function resolveKiteTarget(target) {
  if (
    target.type === "monster" &&
    ["franky", "nerfedmummy"].includes(target.mtype) &&
    isAssignedAsTanker()
  ) {
    if (distance(FRANKY_PREFER_SPOT, character) > 100) {
      smartmoveDebug = true;
      await advanceSmartMove(FRANKY_PREFER_SPOT, {
        speed: 200,
        useScare: false,
        useMagiport: false,
        useBlink: false,
      });
      smartmoveDebug = false;
    }
    return withFixedSpot(target, FRANKY_PREFER_SPOT);
  }

  if (
    target?.type === "monster" &&
    target.mtype.includes("crabx") &&
    isAssignedAsTanker()
  ) {
    return withFixedSpot(target, getMonsterSpawns("crabxx")[0]);
  }

  return target;
}

// Warrior sitting just outside melee range of its own target, with nothing else
// aggroed on it and no other player nearby: hold still and turn to face it
// instead of orbiting, so it doesn't wander off pulling extra aggro.
function shouldHoldWarriorPosition(target, radiusTotal) {
  if (character.ctype !== "warrior") return false;

  const dist = distance(character, target);
  if (dist <= character.range * 0.35 || dist >= radiusTotal) return false;

  const allEntities = Object.values(parent.entities);
  const noAggro = allEntities
    .filter((entity) => entity.type === "monster")
    .every((mob) => mob.target !== character.name || mob["1hp"]);
  const noStackRisk = allEntities
    .filter((entity) => entity.type === "character")
    .every((char) => !canStackWith(char));

  return noAggro && noStackRisk;
}

// Combo hits splash onto related players (party/team/account/coop, or anyone in
// PvP) sharing the victim's 6x6px grid cell. Box instead of raw cell hash so we
// don't sit on a boundary.
const STACK_CELL = 6;
function canStackWith(other) {
  if (other.id === character.id || other.rip || other.hp <= 0) return false;
  if (Math.abs(character.real_x - other.real_x) >= STACK_CELL) return false;
  if (Math.abs(character.real_y - other.real_y) >= STACK_CELL) return false;

  // PvP zone: relation is ignored, any overlapping player can stack.
  if (typeof is_pvp === "function" && is_pvp()) return true;

  return (
    (other.owner && other.owner === character.owner) ||
    (other.team && other.team === character.team) ||
    other.cooperative ||
    prioritizedNames().includes(other.name)
  );
}

function faceTarget(target) {
  const dx = character.real_x - target.real_x;
  const dy = character.real_y - target.real_y;
  angle = Math.atan2(dy, dx);
}

// Resets/initializes the kiting angle when the target changed (or on first tick).
function updateKitingAngle(target) {
  const lastTarget = parent.entities[lastKitingTargetId];
  const targetChanged =
    !lastTarget ||
    lastKitingTargetId !== target.id ||
    distance(lastTarget, target) > 30;
  if (targetChanged) angle = undefined;

  lastKitingTargetId = target.id;

  if (!angle) faceTarget(target);
}

// Flips the orbit direction if we haven't actually moved much over the last
// few ticks (e.g. wedged against a wall) — nudges the angle by 90° to break out.
function trackStuckMovement() {
  movementHistory.push({ x: character.real_x, y: character.real_y });
  if (movementHistory.length > 5) movementHistory.shift();

  let totalMovement = 0;
  for (let i = 1; i < movementHistory.length; i++) {
    const dx = movementHistory[i].x - movementHistory[i - 1].x;
    const dy = movementHistory[i].y - movementHistory[i - 1].y;
    totalMovement += Math.sqrt(dx * dx + dy * dy);
  }

  const averageMovement = totalMovement / movementHistory.length;
  if (averageMovement < stuckThreshold && flipRotationCooldown <= 0) {
    flipRotation *= -1;
    flipRotationCooldown = 4;
    angle += (flipRotation * Math.PI) / 2; // turn 90°
  }
}

// Tanker holding a farmed mob near the default spot orbits the spot itself rather
// than the (moving) mob; far from the spot, it instead walks the mob home, with a
// lead distance that widens the faster the mob outpaces the tanker's own speed.
function getFarmMobOrbit(target) {
  const isTankerHoldingFarmMob =
    isAssignedAsTanker() &&
    target.type === "monster" &&
    target.target === character.name &&
    mobsToFarm.includes(target.mtype);
  const isNearDefaultSpot =
    isTankerHoldingFarmMob &&
    distance(target, { x: mapX, y: mapY }) <=
      character.range + character.xrange;
  const orbitCenter = isNearDefaultSpot ? { x: mapX, y: mapY } : target;
  const speedRate =
    isTankerHoldingFarmMob && !isNearDefaultSpot
      ? Math.max(
          1,
          (target.charge ?? target.speed ?? character.speed) / character.speed,
        )
      : 1;

  return { isTankerHoldingFarmMob, isNearDefaultSpot, orbitCenter, speedRate };
}

function getOrbitDestination(target, orbit, radiusTotal, cosA, sinA) {
  if (orbit.isTankerHoldingFarmMob && !orbit.isNearDefaultSpot) {
    const holdRadius = radiusTotal * orbit.speedRate;
    return { x: target.x + holdRadius * cosA, y: target.y + holdRadius * sinA };
  }
  return {
    x: orbit.orbitCenter.x + radiusTotal * cosA,
    y: orbit.orbitCenter.y + radiusTotal * sinA,
  };
}

// Subtle orbit shift applied every ~10 ticks while right on top of the target,
// so the kite doesn't settle into a perfectly static holding pattern.
function applyMicroRotation(target, rangeRateFn) {
  if (flipCooldown > 9) {
    const closeToTarget =
      distance(character, target) <=
      (character.range + character.xrange) * 0.1 * rangeRateFn;

    if (closeToTarget) angle += (flipRotation * Math.PI) / 16;

    flipCooldown = 0;
  }

  flipCooldown++;
  flipRotationCooldown--;
}

// Returns the actual point to move to: the desired orbit spot if reachable, an
// alternative point swept around the same radius if not, or null if a farm-mob
// tanker instead needs a full smart-move to path around the obstacle.
async function resolveDestination(desired, orbit, radiusTotal) {
  if (can_move_to(desired.x, desired.y)) return desired;

  if (orbit.isTankerHoldingFarmMob) {
    smartmoveDebug = true;
    await advanceSmartMove(
      { x: desired.x, y: desired.y, map: character.map },
      { useScare: false, speed: 200, useTown: false },
    );
    smartmoveDebug = false;
    return null;
  }

  if (flipRotationCooldown < 0) {
    flipRotation *= -1;
    flipRotationCooldown = 6;
  }
  for (let i = 1; i <= 48; i++) {
    const adjustedAngle = angle + (flipRotation * Math.PI) / (48 / i);
    const alt = {
      x: orbit.orbitCenter.x + radiusTotal * Math.cos(adjustedAngle),
      y: orbit.orbitCenter.y + radiusTotal * Math.sin(adjustedAngle),
    };
    if (can_move_to(alt.x, alt.y)) {
      angle = adjustedAngle;
      return alt;
    }
  }
  return null;
}

// Steps toward the destination (clamped to one loop's worth of travel) and returns
// the point actually moved to, or null if already close enough to skip the move().
function moveTowardDestination(destination) {
  const maxStep = (character.speed * 500) / 1000;
  const dx = destination.x - character.real_x;
  const dy = destination.y - character.real_y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 3) return null;

  let { x, y } = destination;
  if (dist > maxStep) {
    const scale = maxStep / dist;
    x = character.real_x + dx * scale;
    y = character.real_y + dy * scale;
  }

  move(x, y);
  return { x, y };
}

// Advances the orbit angle for next tick — walks straight home while far with a
// farmed mob in tow, otherwise keeps sweeping around the orbit center as usual.
function advanceOrbitAngle(target, orbit, radiusTotal, loopInterval) {
  if (orbit.isTankerHoldingFarmMob && !orbit.isNearDefaultSpot) {
    angle = Math.atan2(mapY - target.y, mapX - target.x);
    return;
  }

  const rotationStep =
    flipRotation *
    Math.asin((character.speed * loopInterval) / 1000 / 2 / radiusTotal) *
    2;
  angle += rotationStep;
}

async function hitAndRun(target = get_target(), rangeRateFn = rangeRate) {
  const loopInterval = Math.max(200, getLoopInterval());
  const radiusTotal = character.range * rangeRateFn + character.xrange * 0.5;
  let nextDelay = loopInterval;

  if (character.cc >= 125) return setTimeout(hitAndRun, loopInterval);
  if (!target || smart.moving || isAdvanceSmartMoving) {
    angle = undefined;
    lastKitingTargetId = undefined;
    return setTimeout(hitAndRun, loopInterval);
  }

  try {
    target = await resolveKiteTarget(target);

    if (shouldHoldWarriorPosition(target, radiusTotal)) {
      faceTarget(target);
      return;
    }

    updateKitingAngle(target);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    trackStuckMovement(); // may perturb `angle`, but cosA/sinA above stay from before the flip

    const orbit = getFarmMobOrbit(target);
    const desired = getOrbitDestination(target, orbit, radiusTotal, cosA, sinA);
    applyMicroRotation(target, rangeRateFn);

    const destination = await resolveDestination(desired, orbit, radiusTotal);
    if (!destination) return;

    const moved = moveTowardDestination(destination);
    if (!moved) return;

    advanceOrbitAngle(target, orbit, radiusTotal, loopInterval);
    nextDelay = Math.max(
      (distance(character, moved) / character.speed) * 1000,
      200,
    );
  } catch (e) {
    console.error(e);
    angle = undefined;
    lastKitingTargetId = undefined;
  } finally {
    setTimeout(hitAndRun, nextDelay);
  }
}
if (!isMerchant()) hitAndRun();

const HEAL_IGNORE = ["Geoffriel"];

function prioritizedNames() {
  return [...new Set([...partyMems, partyMerchant, ...parent.party_list])];
}

function getPlayersToHeal() {
  const minHealMod = 0.9;
  const healThreshold = character.ctype === "priest" ? 0.8 : 0.65;
  const healPower = character.heal || character.attack * 2.5;
  const prioritizedNamesList = new Set(prioritizedNames());

  const shouldHeal = (entity) => {
    const entityHp = entity.predictedHp ?? entity.hp;
    const missing = entity.max_hp - entityHp;
    return (
      missing > minHealMod * healPower ||
      entityHp < healThreshold * entity.max_hp
    );
  };

  // Other healable entities
  const potentialHealees = [
    ...Object.values(parent.entities),
    ...(character.ctype === "priest" ? [character] : []),
  ]
    .map((entity) => {
      const incomingNumber =
        PROJECTILE_MANAGER?.getIncomingNumber(entity.name) ?? 0;

      const predictedHp =
        entity.name === character.name ? entity.hp : entity.hp + incomingNumber;

      return { ...entity, predictedHp };
    })
    .filter((entity) => {
      if (!entity) return false;
      if (entity.dead || entity.rip) return false;

      if (character.ctype === "priest" && entity.mtype === "ghost") {
        return !entity.s.healed && entity.hp < 7000;
      }

      if (entity.type === "monster" || entity.citizen) return false;
      if (HEAL_IGNORE.includes(entity.name)) return false;

      if (entity.name !== character.name) {
        if (character.team && entity.team !== character.team) return false;
        if (is_pvp() && !prioritizedNamesList.has(entity.name)) return false;
      }

      return shouldHeal(entity);
    })
    .sort((lhs, rhs) => {
      // Ghosts first if both exist

      const isLhsPrioritized = prioritizedNamesList.has(lhs.name);
      const isRhsPrioritized = prioritizedNamesList.has(rhs.name);

      if (isLhsPrioritized !== isRhsPrioritized)
        return isLhsPrioritized ? -1 : 1;

      const ghostLhs = lhs.mtype === "ghost";
      const ghostRhs = rhs.mtype === "ghost";
      if (ghostLhs !== ghostRhs) return ghostLhs ? -1 : 1;

      const lhsHp = lhs.predictedHp ?? lhs.hp;
      const rhsHp = rhs.predictedHp ?? rhs.hp;
      return lhsHp / lhs.max_hp - rhsHp / rhs.max_hp;
    });

  return potentialHealees;
}

function getLowestMana() {
  const allies = parent.party_list
    .filter((name) => name !== character.name)
    .map((name) => get_player(name))
    .filter(
      (entity) =>
        entity &&
        partyMems.includes(entity.name) &&
        !["mage", "priest"].includes(entity.ctype),
    )
    .sort((lhs, rhs) => lhs.mp / lhs.max_mp - rhs.mp / rhs.max_mp);
  return allies.shift();
}

//// RESPAWN
function handle_death() {
  setTimeout(respawn, 15000);
}

function sleep(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

const LOOTING_LIMIT = 15;
var isLooting = false;
async function midasLooting(forced = false) {
  const chests = Object.values(parent.chests);

  // Early exit: do NOT touch isLooting here
  if ((isLooting && !forced) || !chests.length || character.s.penalty_cd)
    return;

  let shouldReset = false;
  const promises = [];

  const bestLooterCharacter = bestLooter();
  const partyMidasUsers = [...parent.party_list, ...partyMems, character.name]
    .map((id) => get_player(id))
    .filter((player) => player && MIDAS_CHARACTER.includes(player.name));

  const currentTarget = get_target();
  let modifier = 1;

  if (currentTarget && currentTarget.type === "monster") {
    modifier = Math.max(5000 / currentTarget.hp, 1);
  }
  const lootingThreshold = LOOTING_LIMIT * modifier;

  try {
    if (MIDAS_CHARACTER.includes(character.name)) {
      if (
        chests.length >= lootingThreshold ||
        ((smart.moving || isAdvanceSmartMoving) && !smartmoveDebug) ||
        forced
      ) {
        isLooting = true;
        shouldReset = true;

        if (
          (!smart.moving &&
            !isAdvanceSmartMoving &&
            ms_to_next_skill("attack")) ||
          forced
        )
          await withTimeout(
            equipBatch(
              {
                helmet: "wcap",
                chest: "wattire",
                pants: "wbreeches",
                shoes: "wshoes",
                gloves: "handofmidas",
                amulet: "spookyamulet",
                booster: "goldbooster",
                cape: "horsecapeg",
              },
              true,
            ),
            500,
          );

        let breakFlag = lootingThreshold * 2;
        for (const chest of chests) {
          if (breakFlag-- <= 0) break;
          if (distance(chest, character) <= 800) {
            promises.push(parent.open_chest(chest.id));
          }
        }
      }
    } else if (
      !MIDAS_CHARACTER.includes(character.name) &&
      partyMidasUsers.length
    ) {
      if (
        chests.length >= lootingThreshold &&
        (smart.moving || isAdvanceSmartMoving || forced)
      ) {
        isLooting = true;
        shouldReset = true;

        let breakFlag = lootingThreshold * 2;
        for (const chest of chests) {
          if (breakFlag-- <= 0) break;

          if (
            partyMidasUsers.every((player) => distance(chest, player) > 800)
          ) {
            promises.push(parent.open_chest(chest.id));
          }
        }
      }
    } else if (
      (bestLooterCharacter?.name === character.name || !bestLooterCharacter) &&
      Object.keys(get_chests()).length
    ) {
      isLooting = true;
      shouldReset = true;
      promises.push(loot());
    }

    if (!shouldReset) return;

    await withTimeout(Promise.allSettled(promises), 2500);
  } finally {
    if (shouldReset) isLooting = false;
  }
}

function suicide() {
  if (
    !character.rip &&
    character.hp +
      (PROJECTILE_MANAGER?.getIncomingNumber(character.name) ?? 0) <
      Math.max(0.15 * character.max_hp, 3500) &&
    (avgDmgTaken(character) > character.hp ||
      character.ping > 600 ||
      character.s.burned)
  ) {
    parent.socket.emit("harakiri");
    game_log("Harakiri");

    setTimeout(() => {
      respawn();
    }, 12500);
  }
}

setInterval(() => {
  suicide();
  if (!MIDAS_CHARACTER.includes(character.name) || !isEquipingItems) {
    midasLooting();
  }
}, 100);

//// Interval threads
// Code Messaging
setInterval(async function () {
  // Xmas buffs
  if (parent.S["holidayseason"] && !character.s.holidayspirit) {
    log("Ting ting ting");
    await advanceSmartMove({ map: "main", x: -152, y: -137 });
    parent.socket.emit("interaction", { type: "newyear_tree" });
  }

  if (isMerchant()) return;

  // Fix a bug where character is stuck to corner
  const currentTarget =
    get_target() ?? getTarget() ?? get_nearest_monster({ target: TANKER });

  if (
    currentTarget &&
    currentTarget.type === "monster" &&
    distance(currentTarget, character) >
      character.range + character.xrange * 0.9 &&
    !smart.moving &&
    !character.moving &&
    !isAdvanceSmartMoving
  ) {
    smartmoveDebug = true;
    log("Debug being stuck while kiting");
    if (parent.caracAL) {
      if (can_move_to(currentTarget.x, currentTarget.y))
        await move(
          (currentTarget.real_x + character.real_x) / 2,
          (currentTarget.real_y + character.real_y) / 2,
        );
      else
        await advanceSmartMove(
          {
            map: character.map,
            x: currentTarget.real_x,
            y: currentTarget.real_y,
          },
          {
            useScare: ![TANKER, PRIEST].includes(character.name),
            useTown: false,
            speed: 200,
          },
        );
    } else {
      if (can_move_to(currentTarget.x, currentTarget.y))
        await move(
          (currentTarget.real_x + character.real_x) / 2,
          (currentTarget.real_y + character.real_y) / 2,
        );
      else
        await advanceSmartMove({
          map: character.map,
          x: currentTarget.real_x,
          y: currentTarget.real_y,
        });
    }

    smartmoveDebug = false;
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
          ].includes(item.name)
        )
          return;
        await send_item(partyMerchant, index, 1000);
      }),
    );
  }

  // Inventory check and potions
  if (isInvFull(4)) {
    log("Inventory full! Calling our merchant!");
    send_cm(partyMerchant, { msg: "inv_full", ...obj });
  } else if (
    !isInvFull(2) &&
    (locate_item("mpot1") === -1 || getTotalQuantityOf("mpot1") < 100)
  ) {
    log("Asking the merchant for some mana potions...");
    send_cm(partyMerchant, { msg: "buy_mana", ...obj });
  } else if (
    !isInvFull(2) &&
    (locate_item("hpot1") === -1 || getTotalQuantityOf("hpot1") < 100)
  ) {
    log("Asking the merchant for some health potions...");
    send_cm(partyMerchant, { msg: "buy_hp", ...obj });
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

function deployCharacters() {
  //// Deploy characters which arent active
  const loadedCharacters = get_active_characters();
  const loadedCharactersNames = Object.keys(loadedCharacters);
  const allCharacters = [...partyMems, partyMerchant];

  if (parent.caracAL && caracALconfig.characters[character.name].enabled) {
    if (character.ctype === "merchant" && parent.caracAL.siblings.length)
      parent.caracAL.siblings
        .filter((id) => id !== character.name && !partyMems.includes(id))
        .forEach(async (id) => {
          send_cm(id, "dc-harakiri");
          await sleep(character.ping);
          parent.caracAL.shutdown(id);
        });

    allCharacters
      .filter((id) => parent.caracAL && !parent.caracAL.siblings.includes(id))
      .forEach((id) => {
        parent.caracAL.deploy(id, null, caracALconfig.characters[id].script);
      });
  } else if (!character.controller) {
    loadedCharactersNames
      .filter(
        (id) => loadedCharacters[id] !== "self" && !allCharacters.includes(id),
      )
      .forEach((id) => stop_character(id));

    allCharacters
      .filter((id) => !loadedCharacters[id])
      .forEach((id) => start_character(id, CODE_SLOTS[id].script));
  }
}

// Party Setups
setTimeout(deployCharacters, 5000);
setInterval(deployCharacters, 30000);

setInterval(async () => {
  // if (isMerchant()) return;

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

  const myMemberList = [...partyMems, partyMerchant];

  const characterNotInOutsiderParty = serverCharacters.filter(
    (char) =>
      myMemberList.includes(char) &&
      !partyWhitelistRegex.some((regex) => regex.test(char.party)),
  );

  if (
    whitelistPartyMembers.length &&
    whitelistPartyMembers.length + characterNotInOutsiderParty.length <= 10 &&
    (!currentPartySize || !hasWhitelistedMember)
  ) {
    send_party_request(
      whitelistPartyMembers.find((member) =>
        partyWhitelistRegex.some((regex) => regex.test(member.name)),
      ).name,
    );
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

  if (myMemberList.some((id) => !parent.party_list.includes(id))) {
    if (character.name === partyMems[0]) {
      myMemberList.forEach((member) => {
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

const PARTICIPATABLE_EVENTS = [
  "icegolem",
  "franky",
  "mrpumpkin",
  "mrgreen",
  "crabxx",
  "dragold",
  "wabbit",
  "snowman",
  "pinkgoo",
  "goobrawl",
  "abtesting",
];

function serverCurrentlyHasLiveEvent() {
  return PARTICIPATABLE_EVENTS.some((eventName) => parent.S[eventName]?.live);
}

const RSPEED_DURATION = G.conditions["rspeed"].duration;
const RSPEED_MARGIN = 0.75 * 60 * 1000; // 45 seconds

const setRogueSpeedLastDeployment = () => {
  const last = get("rogueLastDeployed");
  const lastDate = last ? new Date(last) : null;

  // If we recently deployed (still inside rspeed - margin), DO NOT overwrite
  if (lastDate && mssince(lastDate) < RSPEED_DURATION - RSPEED_MARGIN) {
    return; // Too early to overwrite
  }

  // Otherwise update the timestamp
  set("rogueLastDeployed", new Date());
};

const ENT_FIELD_MAX_FOR_ROGUE = 2;
const ENT_FIELD_STALE_MS = 15 * 1000;

const shouldDeployRogue = () => {
  // Check if it's safe to deploy rogue in place of the priest while farming ents
  const mageLocation = get("mageLocation");
  if (
    !mageLocation ||
    mssince(new Date(mageLocation.time)) > ENT_FIELD_STALE_MS ||
    mageLocation.entsTargetingPartyCount > ENT_FIELD_MAX_FOR_ROGUE
  ) {
    return false;
  }

  const last = get("rogueLastDeployed");
  const lastDate = last ? new Date(last) : null;

  // If never deployed before → SHOULD deploy
  if (!lastDate) return true;

  // Deploy if enough time has passed
  return (
    mssince(lastDate) > RSPEED_DURATION - RSPEED_MARGIN ||
    mssince(lastDate) < RSPEED_MARGIN
  );
};

const DYNAMIC_PARTY_PRESETS = {
  mrgreen: {
    USI: [WARRIOR, PRIEST, ROGUE],
    EUII: () => {
      RANGER = RANGER2;
      HEALER = RANGER;
      return [WARRIOR, RANGER, MAGE];
    },
    USII: () => {
      RANGER = RANGER1;
      HEALER = RANGER;
      return [WARRIOR, RANGER, MAGE];
    },
    default: [WARRIOR, PRIEST, MAGE],
  },
  mrpumpkin: "mrgreen", // share config
  franky: () => {
    // const isAggroed = !!parent.S.franky?.target;
    // HEALER = PRIEST;
    return [WARRIOR, PRIEST, ROGUE];
  },
  icegolem: () => {
    HEALER = PRIEST;
    return [PRIEST, ROGUE, MAGE];
  },
  dragold: {
    USI: [WARRIOR, PRIEST, ROGUE],
    EUI: () => {
      RANGER = RANGER1;
      HEALER = PRIEST;
      return [WARRIOR, RANGER, PRIEST];
    },
    EUII: () => {
      RANGER = RANGER2;
      HEALER = PRIEST;
      return [WARRIOR, RANGER, PRIEST];
    },
    USII: () => {
      HEALER = PRIEST;
      return [WARRIOR, MAGE, PRIEST];
    },
    default: [WARRIOR, PRIEST, ROGUE],
  },
  crabxx: () => {
    // const isAggroed = !!parent.S.crabxx?.target;
    // if (isAggroed) RANGER = RANGER1;
    // HEALER = isAggroed ? RANGER1 : PRIEST;
    // return [WARRIOR, isAggroed ? RANGER1 : PRIEST, isAggroed ? RANGER2 : MAGE];
    RANGER = RANGER1;
    return [WARRIOR, PRIEST, MAGE];
  },
  pinkgoo: {
    USI: [MAGE, PRIEST, ROGUE],
    USII: [WARRIOR, MAGE, PRIEST],
    EUI: () => {
      RANGER = RANGER1;
      HEALER = RANGER;
      return [WARRIOR, RANGER, MAGE];
    },
    EUII: () => {
      RANGER = RANGER2;
      HEALER = RANGER;
      return [WARRIOR, RANGER, MAGE];
    },
    default: () => {
      RANGER = RANGER1;
      HEALER = RANGER;
      return [WARRIOR, RANGER, MAGE];
    },
  },
  wabbit: {
    USI: () => {
      RANGER = RANGER1;
      HEALER = RANGER;
      return [ROGUE, RANGER, MAGE];
    },
    USIII: [MAGE, RANGER, PRIEST],
    EUII: () => {
      RANGER = RANGER2;
      HEALER = RANGER;
      return [WARRIOR, RANGER, MAGE];
    },
    default: () => {
      RANGER = RANGER1;
      HEALER = RANGER;
      return [WARRIOR, RANGER, MAGE];
    },
  },
  snowman: {
    EUII: () => {
      RANGER = RANGER2;
      HEALER = RANGER;
      return [WARRIOR, RANGER, MAGE];
    },
    default: () => {
      RANGER = RANGER1;
      HEALER = RANGER;
      return [WARRIOR, RANGER, MAGE];
    },
  },

  default: () => {
    const globalParty = get("currentParty");
    const knownTankers = ["CrownPriest", "earthPri", "earthWar"];

    if (
      globalParty &&
      globalParty.some((id) => knownTankers.includes(id)) &&
      !serverCurrentlyHasLiveEvent()
    ) {
      setRogueSpeedLastDeployment();
      if (shouldDeployRogue()) {
        return [WARRIOR, ROGUE, MAGE];
      } else {
        // RANGER = RANGER1;
        HEALER = PRIEST;
        return [WARRIOR, PRIEST, MAGE];
      }
    }

    HEALER = PRIEST;
    return [WARRIOR, PRIEST, MAGE];
  },
};

function getPresetMembers(preset, currentServer) {
  if (typeof preset === "function") return preset();
  if (Array.isArray(preset)) return preset;
  if (typeof preset === "string")
    return getPresetMembers(DYNAMIC_PARTY_PRESETS[preset], currentServer);

  const value =
    preset[currentServer] ?? preset.default ?? DYNAMIC_PARTY_PRESETS.default();
  return typeof value === "function" ? value() : value;
}

function dynamicParty() {
  const currentServer = `${server.region}${server.id}`;
  const activeEvent =
    Object.keys(DYNAMIC_PARTY_PRESETS).find((name) => parent.S[name]?.live) ??
    "default";

  if (!activeEvent) return;

  const preset = DYNAMIC_PARTY_PRESETS[activeEvent];
  const members = getPresetMembers(preset, currentServer);

  if (members) partyMems = members;
}
dynamicParty();
setInterval(dynamicParty, 3000);

//// Daily Events
// var pinkGooVisitedBoundary = [];
async function changeToDailyEventTargets() {
  let target = getTarget();
  rangeRate = calculateRangeRate() ?? originRangeRate ?? basicRangeRate;

  if (
    (parent.S.goobrawl || get_nearest_monster({ type: "bgoo" })) &&
    !character.s["hopsickness"]
  ) {
    changeToPullStrategies();
    if (character.map !== "goobrawl") {
      await join("goobrawl");
      await sleep(character.ping);
    }

    const rgooInstance = get_nearest_monster({ type: "rgoo" });
    const bgooInstance = get_nearest_monster({ type: "bgoo" });

    if (rgooInstance) {
      change_target(rgooInstance);
      return get_nearest_monster({ type: "rgoo" });
    }

    if (!(target && ["bgoo", "rgoo"].includes(target.mtype))) {
      change_target(rgooInstance || bgooInstance);
      return rgooInstance || bgooInstance;
    }
    return target || rgooInstance || bgooInstance;
  }

  if (parent.S.dragold?.live) {
    changeToPullStrategies();

    const dragoldInstance = get_nearest_monster({ type: "dragold" });
    if (!dragoldInstance) {
      await advanceSmartMove(parent.S.dragold);
      change_target(get_nearest_monster({ type: "dragold" }));
      return get_nearest_monster({ type: "dragold" });
    } else {
      change_target(dragoldInstance);
      return dragoldInstance;
    }
  }

  const activeBosses = [];

  if (parent.S.mrpumpkin?.live) {
    activeBosses.push({
      ...parent.S.mrpumpkin,
      type: "mrpumpkin",
      strategy: changeToPullStrategies,
    });
  }

  if (parent.S.mrgreen?.live) {
    activeBosses.push({
      ...parent.S.mrgreen,
      type: "mrgreen",
      strategy: changeToPullStrategies,
    });
  }

  if (parent.S.icegolem?.live) {
    activeBosses.push({
      ...parent.S.icegolem,
      type: "icegolem",
      strategy: changeToNormalStrategies,
    });
  }

  if (activeBosses.length) {
    const bossToFight = activeBosses
      .sort(
        (lhs, rhs) =>
          lhs.hp / parent.G.monsters[lhs.type].hp -
          rhs.hp / parent.G.monsters[rhs.type].hp,
      )
      .shift();

    if (bossToFight) {
      let bossInstance = get_nearest_monster({ type: bossToFight.type });
      bossToFight.strategy();
      if (!bossInstance) {
        await advanceSmartMove(bossToFight);
        bossInstance = get_nearest_monster({ type: bossToFight.type });

        change_target(bossInstance);
        return bossInstance;
      } else {
        change_target(bossInstance);
        return bossInstance;
      }
    }
  }

  if (
    parent.S.crabxx?.live
    // parent.S.crabxx.hp < parent.S.crabxx.max_hp &&
    // parent.S.crabxx?.target &&
    // !partyMems.includes(parent.S.crabxx.target)
  ) {
    if (character.range > 100) rangeRate = 0.3;

    const inRange = (entity) =>
      distance(entity, character) < character.range + character.xrange * 0.8;

    const getCrabs = () => {
      const entities = Object.values(parent.entities);
      const crabxList = [];
      let crabxxInstance;

      for (const entity of entities) {
        if (!entity || entity.rip) continue;

        if (entity.mtype === "crabxx" && !crabxxInstance) {
          crabxxInstance = entity;
        }

        const incomingNumber =
          PROJECTILE_MANAGER?.getIncomingNumber(entity.id) ?? 0;

        const predictedHp =
          entity.name === character.name
            ? entity.hp
            : entity.hp + incomingNumber;
        entity.predictedHp = predictedHp;

        if (entity.mtype === "crabx") {
          crabxList.push(entity);
        }
      }
      return { crabxxInstance, crabxList };
    };

    let { crabxxInstance, crabxList } = getCrabs();

    if (!crabxxInstance) {
      if (character.s.hopsickness) {
        await advanceSmartMove(parent.S.crabxx);
      } else {
        await join("crabxx");
        await sleep(character.ping);
      }
      ({ crabxxInstance, crabxList } = getCrabs());

      if (!crabxxInstance) return;
    }

    let bestCrabx;
    let bestClusteredCrabx;

    for (const crabx of crabxList) {
      const isCurrentCrabxInRange = inRange(crabx);
      const currentCrabxHp = crabx.predictedHp ?? crabx.hp ?? 0;
      const bestCrabxHp = bestCrabx?.predictedHp ?? bestCrabx?.hp ?? 0;

      if (!bestCrabx) {
        bestCrabx = crabx;
      } else {
        const isBestCrabxInRange = inRange(bestCrabx);

        if (isCurrentCrabxInRange && !isBestCrabxInRange) {
          bestCrabx = crabx;
        } else if (isCurrentCrabxInRange === isBestCrabxInRange) {
          if (currentCrabxHp > bestCrabxHp) {
            bestCrabx = crabx;
          }
        }
      }

      if (distance(crabx, crabxxInstance) <= BLAST_RADIUS) {
        const bestClusteredCrabxHp =
          bestClusteredCrabx?.predictedHp ?? bestClusteredCrabx?.hp ?? 0;
        if (!bestClusteredCrabx || currentCrabxHp > bestClusteredCrabxHp) {
          bestClusteredCrabx = crabx;
        }
      }
    }

    if (
      character.ctype === "warrior" &&
      (!crabxxInstance.s.stunned ||
        crabxxInstance.s.stunned.ms < character.ping / 2) &&
      crabxList.length <= 1
    ) {
      await warriorStomp();
    }

    let targetCrab;

    if (character.ctype === "warrior") {
      targetCrab = bestClusteredCrabx || crabxxInstance;
    } else {
      targetCrab =
        bestCrabx || (crabxxInstance?.target ? crabxxInstance : undefined);
    }

    const isTanker = isAssignedAsTanker();
    const canAgitate =
      isTanker &&
      !is_on_cooldown("agitate") &&
      character.mp > G.skills["agitate"].mp + 500;

    const hasCrabxSpawnedByCrabxx = crabxList.some(
      (entity) => entity.s?.young && entity.target === character.name,
    );

    if (hasCrabxSpawnedByCrabxx && (!isTanker || canAgitate)) {
      const promisesToAwait = [];
      promisesToAwait.push(scareAwayMobs());

      if (canAgitate) {
        promisesToAwait.push(use_skill("agitate"));
      }
      await Promise.all(promisesToAwait);
    }
    changeToPullStrategies();
    change_target(targetCrab);
    return targetCrab;
  }

  if (parent.S.franky?.live) {
    if (character.ctype === "warrior") changeToPullStrategies();
    else changeToNormalStrategies();

    let frankyInstance = get_nearest_monster({ type: "franky" });
    if (!frankyInstance) {
      await join("franky").catch((e) => console.warn(e));
      await sleep(character.ping);
      await advanceSmartMove(parent.S.franky);
      frankyInstance = get_nearest_monster({ type: "franky" });
      change_target(frankyInstance);
    }

    if (frankyInstance) {
      rangeRate = 0.2;
      await scareAwayMobs();
      return frankyInstance;
    }
  }

  if (parent.S.pinkgoo?.live) {
    changeToPullStrategies();
    let pinkgooInstance = get_nearest_monster({ type: "pinkgoo" });
    if (!pinkgooInstance) {
      if (parent.S.pinkgoo?.x) {
        await advanceSmartMove(parent.S.pinkgoo);
        change_target(get_nearest_monster({ type: "pinkgoo" }));
        return get_nearest_monster({ type: "pinkgoo" });
      }
    } else {
      change_target(pinkgooInstance);

      return pinkgooInstance;
    }
  }

  if (parent.S.snowman?.live) {
    changeToPullStrategies();

    let snowmanInstance = get_nearest_monster({ type: "snowman" });

    if (!snowmanInstance) {
      await advanceSmartMove(parent.S.snowman);
      snowmanInstance = get_nearest_monster({ type: "snowman" });
    }

    const currentTarget = get_target();
    const grinchInstance = get_nearest_monster({ type: "grinch" });
    const beeToAttack =
      currentTarget && currentTarget.mtype === "arcticbee"
        ? currentTarget
        : get_nearest_monster({ type: "arcticbee" });

    if (grinchInstance) change_target(grinchInstance);
    else if (snowmanInstance.s?.fullguardx) change_target(beeToAttack);
    else change_target(snowmanInstance);

    return (grinchInstance ?? snowmanInstance.s?.fullguardx)
      ? beeToAttack
      : snowmanInstance;
  }

  if (parent.S.abtesting && !character.s.hopsickness) {
    if (character.map != "abtesting") join("abtesting");

    changeToNormalStrategies();
    const priority = [
      "priest",
      "mage",
      "ranger",
      "rogue",
      "warrior",
      "paladin",
    ];

    let pvpTarget = {
      priority: priority.length + 1,
      entity: undefined,
      sqrDistance: undefined,
    };

    for (const id in parent.entities) {
      const currentCharacter = parent.entities[id];

      if (
        currentCharacter.team === character.team ||
        currentCharacter.rip ||
        currentCharacter.hp <= 0
      )
        continue;

      const currentCharacterTarget = {
        priority: priority.findIndex(
          (element) => element === currentCharacter.ctype,
        ),
        entity: currentCharacter,
        sqrDistance:
          Math.pow(currentCharacter.real_x - character.real_x, 2) +
          Math.pow(currentCharacter.real_y - character.real_y, 2),
      };

      if (currentCharacterTarget.priority < pvpTarget.priority)
        pvpTarget = currentCharacterTarget;

      if (
        currentCharacterTarget.priority <= pvpTarget.priority &&
        currentCharacterTarget.sqrDistance <= pvpTarget.sqrDistance
      )
        pvpTarget = currentCharacterTarget;
    }

    return pvpTarget.entity;
  }

  if (parent.S.wabbit?.live) {
    changeToPullStrategies();
    if (character.range < 100) rangeRate = 0.1;
    else rangeRate = 0.4;
    const wabbitInstance = get_nearest_monster({ type: "wabbit" });

    if (!wabbitInstance) {
      if (parent.S.wabbit?.x) {
        await advanceSmartMove(parent.S.wabbit);
        change_target(get_nearest_monster({ type: "wabbit" }));
        return get_nearest_monster({ type: "wabbit" });
      }
    } else {
      change_target(wabbitInstance);
      return wabbitInstance;
    }
  }

  const thirdPartyHealerId = parent.party_list.find((id) => {
    const player = get_player(id);
    return !partyMems.includes(id) && player?.ctype === "priest";
  });
  const partyHealer =
    get_entity(HEALER) ||
    (thirdPartyHealerId && get_player(thirdPartyHealerId)) ||
    undefined;
  const partyTanker = get_entity(TANKER);

  if (
    partyTanker &&
    partyTanker.hp > partyTanker.max_hp * 0.35 &&
    partyHealer &&
    !partyHealer.rip &&
    character.ping < 600 &&
    (get_targeted_monster()?.level < 5 || get_target()?.attack < 500)
  )
    changeToPullStrategies();
  else changeToNormalStrategies();

  return target;
}

function on_magiport(name) {
  if (name === MAGE) {
    accept_magiport(name);
  }
}

function attackErrorHandler(error, target = get_target()) {
  if (error.failed) {
    if (error.response === "cooldown" && error.place) {
      reduce_cooldown(error.place, -error.ms + Math.min(...parent.pings) / 2);
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
