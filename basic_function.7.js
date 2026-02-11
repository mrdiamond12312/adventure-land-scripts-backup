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

// var partyCodeSlot = [4, 15, 3, 5];
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

var partyCodeSlot = [9, 2, 4, 5];
// var caracALPartyCodeSlot = [
//   "adventure-land-scripts-backup/basic_mage.4.js",
//   "adventure-land-scripts-backup/solo_ranger.15.js",
//   "adventure-land-scripts-backup/basic_archer.3.js",
//   "adventure-land-scripts-backup/basic_merchant.5.js",
// ];
var caracALPartyCodeSlot = [
  "adventure-land-scripts-backup/basic_warrior.9.js",
  "adventure-land-scripts-backup/basic_priest.2.js",
  "adventure-land-scripts-backup/basic_mage.4.js",
  "adventure-land-scripts-backup/basic_merchant.5.js",
];
// var partyCodeSlot = [2, 4, 15, 5];

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
var bossOffset = 0.99;
var boss = ["mrpumpkin", "mrgreen"];

// Ignore mob with high d-return
const MELEE_IGNORE_LIST = ["porcupine"];
// var map = "main";
// var mapX = 1248;
// var mapY = -63;

// var map = "uhills";
// var mapX = -289;
// var mapY = -188;

var map = "winterland";
var mapX = 423;
var mapY = -2614;

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
// var mapX = -800;
// var mapY = -354;

// var map = "level1";
// var mapX = 50;
// var mapY = 425;

// var mobsToFarm = ["grinch", "phoenix", "spider", "bigbird", "scorpion"];
// var mobsToFarm = ["goldenbot", "sparkbot", "sparkbot"];
var mobsToFarm = ["phoenix", "stompy", "wolf"];
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
// var mobsToFarm = ["plantoid"];
// var mobsToFarm = ["prat"];

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

function filterCompoundableAndStackable() {
  const inv = character.items;
  const res = Array.from({ length: inv.length }, (_, i) => i + 0).filter(
    (i) =>
      inv[i] &&
      (item_info(inv[i]).compound || inv[i].q) &&
      !["hpot1", "mpot1"].includes(inv[i].name),
  );
  return res;
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

function changeToPullStrategies() {
  currentStrategy = disablePullingStrategy
    ? useNormalStrategy
    : usePullStrategies;
}

function changeToNormalStrategies() {
  currentStrategy = useNormalStrategy;
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
  "throwingstars",
  "orboffire",
  "orboffrost",
  "orbofplague",
  "orbofresolve",
  "gphelmet",
  // "bowofthedead",
  // "daggerofthedead",
  "maceofthedead",
  "pmaceofthedead",
  "staffofthedead",
  "swordofthedead",
  ...BUYABLE,
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
  "elixirint0",
  "elixirdex0",
  "egg5",
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
  "feather0",
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
];

const SALE_ABLE = [
  // "smoke",
  "vgloves",
  "mcape",
  "wbook0",
  "quiver",
  "santasbelt",
  "mushroomstaff",
  "slimestaff",
  "fieldgen0",
  "snowball",
  "carrotsword",
  "shield",
  // "wcap",
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
  "gphelmet",
  "maceofthedead",
  "pmaceofthedead",
  "staffofthedead",
  "swordofthedead",
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
  "throwingstars",
  // Easter's loots
  // "eears",
  // "eslippers",

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
  "dexbelt",
  "intbelt",
  // Halloween temp for gold
  // "bowofthedead",
  // "daggerofthedead",
];
var maxUpgrade = 7;
var maxCompound = 3;

if (parent.caracAL) {
  parent.caracAL.load_scripts([
    "adventure-land-scripts-backup/crypt_strategy.16.js",
    "adventure-land-scripts-backup/advance_smart_move.20.js",
  ]);
} else {
  load_code(20);
  load_code(16);
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

  // Sorting name -> level -> slot order -> null
  inv.sort((lhs, rhs) => {
    const lhsItem = lhs.item;
    const rhsItem = rhs.item;

    if (!lhsItem && !rhsItem) return 0;
    if (!lhsItem) return 1; // nulls last
    if (!rhsItem) return -1;

    const nameOrder = lhsItem.name.localeCompare(rhsItem.name);
    if (nameOrder !== 0) return nameOrder;

    const levelOrder = (lhsItem.level ?? 0) - (rhsItem.level ?? 0);
    if (levelOrder !== 0) return levelOrder;

    // same name + same level — preserve original slot order for stability
    return lhs.slot - rhs.slot;
  });

  // Create a mapping from target slot → original slot
  const promises = [];
  const usedSlots = new Set();

  for (let index = 0; index < inv.length; index++) {
    const desired = inv[index];
    const targetItem = character.items[index];

    // skip if already correct
    if (desired.item === targetItem) continue;

    // find the specific matching slot by identity
    const fromSlot = character.items.findIndex(
      (x, idx) => x === desired.item && !usedSlots.has(idx),
    );

    if (fromSlot !== -1 && fromSlot !== index) {
      usedSlots.add(fromSlot);
      usedSlots.add(index);
      promises.push(swap(fromSlot, index));
    }
  }

  return Promise.all(promises).finally(() => {
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
  for (monster of ["grinch"]) {
    if (get_nearest_monster({ type: monster })) {
      return get_nearest_monster({ type: monster });
    }
  }

  for (monster of mobsToFarm) {
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

async function waitUntil(fn, timeout = 10_000, interval = character.ping) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) return false;
    await sleep(interval);
  }
  return true;
}

async function buff() {
  try {
    if (Object.keys(character.c).length) {
      throw new Error("Wait for channeling before using potions");
    }
    const minPing = Math.min(...parent.pings);
    const adjustPotionsCooldown = () => {
      reduce_cooldown("use_mp", minPing);
      reduce_cooldown("use_hp", minPing);
    };

    if (
      character.hp / character.max_hp < character.mp / character.max_mp ||
      (character.hp < character.max_hp * 0.6 && character.mp > 500)
    ) {
      if (
        character.hp < 0.8 * character.max_hp &&
        character.hp < character.max_hp - 500 &&
        !is_on_cooldown("use_hp")
      ) {
        await withTimeout(use_skill("use_hp"), 500);
        adjustPotionsCooldown();
      } else if (
        character.hp < character.max_hp - 50 &&
        !is_on_cooldown("regen_hp")
      ) {
        await withTimeout(use_skill("regen_hp"), 500);
        adjustPotionsCooldown();
      }
    } else {
      if (character.mp < character.max_mp - 500 && !is_on_cooldown("use_mp")) {
        await withTimeout(use_skill("use_mp"), 500);
        adjustPotionsCooldown();
      } else if (
        character.mp < character.max_mp - 100 &&
        !is_on_cooldown("regen_mp")
      ) {
        await withTimeout(use_skill("regen_mp"), 500);
        adjustPotionsCooldown();
      }
    }
  } catch (e) {}
  setTimeout(
    async () => buff(),
    Math.min(
      Math.max(ms_to_next_skill("use_mp"), 5),
      Math.max(ms_to_next_skill("use_hp"), 5),
    ),
  );
}
buff();

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
            entity.target !== character.name,
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
    (breakpoint) => Math.max((1 / character.frequency) * 1000) / breakpoint,
  ).find((loopInterval) => loopInterval > 250);
  const frequencyInterval = (1 / character.frequency) * 1000;

  return ms_to_next_skill("attack") <= dynamicInterval
    ? Math.max(ms_to_next_skill("attack"), 1)
    : dynamicInterval ?? frequencyInterval;
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

/**
 *
 * @param {*} theta -- current angle from target and character
 * @param {*} width -- width of hitbox border
 * @param {*} height -- height of hitbox border
 * @returns -- extra distance allow by attack range
 */
// function extraDistanceWithinHitbox(theta, width, height) {
//   let halfW = width / 2;
//   let halfH = height / 2;

//   let dx = Math.abs(halfW / Math.cos(theta)); // Distance to vertical boundary of hitbox
//   let dy = Math.abs(halfH / Math.sin(theta)); // Distance to horizontal boundary of hitbox

//   return Math.min(dx, dy); // Extra range from mob's hitbox
// }

function extraDistanceWithinHitbox(target) {
  if (!target) return 0;
  return Math.min(get_height(target) / 2, get_width(target) / 2) / 2;
}

var lastKitingTargetId = undefined;
async function hitAndRun(target = get_target(), rangeRateFn = rangeRate) {
  // Debug: Fixed width and height of target
  if (target) {
    target.awidth = 24;
    target.aheight = 24;
    target.width = 24;
    target.height = 24;
  }

  const loopInterval = Math.max(200, getLoopInterval());
  // const totalExtraRange = extraRangeTarget + extraRangeSelf;
  const rangeRadius = character.range * rangeRateFn;
  const extendedRadius = character.xrange * 0.9;
  // + totalExtraRange;

  // --- 1. Early exits and sanity checks ---
  if (character.cc >= 125) return setTimeout(hitAndRun, loopInterval);
  if (!target || smart.moving || isAdvanceSmartMoving) {
    angle = undefined;
    lastKitingTargetId = undefined;
    return setTimeout(hitAndRun, loopInterval);
  }

  if (
    character.ctype === "warrior" &&
    distance(character, target) > character.range * 0.35 &&
    distance(character, target) < rangeRadius + extendedRadius
  ) {
    const allEntities = Object.values(parent.entities);
    const noAggro = allEntities
      .filter((entity) => entity.type === "monster")
      .every((mob) => mob.target !== character.name || mob["1hp"]);
    const noNearbyPlayers = allEntities
      .filter((entity) => entity.type === "character" && !entity.moving)
      .every((char) => distance(character, char) >= 8);

    if (noAggro && noNearbyPlayers) {
      const dx = character.real_x - target.real_x;
      const dy = character.real_y - target.real_y;
      angle = Math.atan2(dy, dx);
      return setTimeout(hitAndRun, loopInterval);
    }
  }

  // Reset angle when switching or losing target
  const lastTarget = parent.entities[lastKitingTargetId];
  const targetChanged =
    !lastTarget ||
    lastKitingTargetId !== target.id ||
    distance(lastTarget, target) > 30;
  if (targetChanged) angle = undefined;

  lastKitingTargetId = target.id;

  // --- 2. Initialize angle if needed ---
  if (!angle) {
    const dx = character.real_x - target.real_x;
    const dy = character.real_y - target.real_y;
    angle = Math.atan2(dy, dx);
  }

  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  // --- 3. Track recent movement to detect being stuck ---
  movementHistory.push({ x: character.real_x, y: character.real_y });
  if (movementHistory.length > 5) movementHistory.shift();

  let totalMovement = 0;
  for (let i = 1; i < movementHistory.length; i++) {
    const dx = movementHistory[i].x - movementHistory[i - 1].x;
    const dy = movementHistory[i].y - movementHistory[i - 1].y;
    totalMovement += Math.sqrt(dx * dx + dy * dy);
  }

  const averageMovement = totalMovement / movementHistory.length;
  if (averageMovement < stuckThreshold) {
    if (flipRotationCooldown <= 0) {
      flipRotation *= -1;
      flipRotationCooldown = 4;
      angle += (flipRotation * Math.PI) / 2; // turn 90°
    }
  }

  // --- 5. Desired destination based on current orbit angle ---
  let new_x = target.x + (rangeRadius + extendedRadius) * cosA;
  let new_y = target.y + (rangeRadius + extendedRadius) * sinA;

  // --- 6. Smooth micro-rotation when close to target ---
  if (flipCooldown > 9) {
    const closeToTarget =
      distance(character, target) <=
      (character.range + character.xrange) * 0.1 * rangeRateFn;

    if (closeToTarget) {
      angle += (flipRotation * Math.PI) / 16; // subtle orbit shift
    }

    flipCooldown = 0;
  }

  flipCooldown++;
  flipRotationCooldown--;

  // --- 7. Collision handling and alternative movement path ---
  let destinationX, destinationY;

  if (!can_move_to(new_x, new_y)) {
    // Try small angular adjustments in the current flip direction
    if (flipRotationCooldown < 0) {
      flipRotation *= -1;
      flipRotationCooldown = 6;
    }
    for (let i = 1; i <= 48; i++) {
      const adjustedAngle = angle + (flipRotation * Math.PI) / (48 / i);
      const alt_x =
        target.x + (rangeRadius + extendedRadius) * Math.cos(adjustedAngle);
      const alt_y =
        target.y + (rangeRadius + extendedRadius) * Math.sin(adjustedAngle);

      if (can_move_to(alt_x, alt_y)) {
        angle = adjustedAngle;
        destinationX = alt_x;
        destinationY = alt_y;
        break;
      }
    }
  } else {
    destinationX = new_x;
    destinationY = new_y;
  }

  // --- 8. Execute movement or retry later ---
  if (destinationX !== undefined && destinationY !== undefined) {
    const maxStep = (character.speed * 500) / 1000;

    const dx = destinationX - character.real_x;
    const dy = destinationY - character.real_y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > maxStep) {
      const scale = maxStep / dist;
      destinationX = character.real_x + dx * scale;
      destinationY = character.real_y + dy * scale;
    }

    move(destinationX, destinationY);
  } else {
    return setTimeout(hitAndRun, loopInterval);
  }

  const radiusTotal = rangeRadius + extendedRadius;
  const rotationStep =
    flipRotation *
    Math.asin((character.speed * loopInterval) / 1000 / 2 / radiusTotal) *
    2;

  angle += rotationStep;

  const moveTime =
    (distance(character, { x: destinationX, y: destinationY }) /
      character.speed) *
    1000;

  setTimeout(hitAndRun, Math.max(moveTime, 200));
}
hitAndRun();

const HEAL_IGNORE = ["Geoffriel"];

function prioritizedNames() {
  return [...new Set([...partyMems, partyMerchant, ...parent.party_list])];
}

function getPlayersToHeal() {
  const minHealMod = 0.9;
  const healThreshold = character.ctype === "priest" ? 0.8 : 0.65;
  const healPower = character.heal || character.attack * 2.5;
  const prioritizedNamesList = prioritizedNames();

  const shouldHeal = (entity) => {
    const missing = entity.max_hp - entity.hp;
    return (
      missing > minHealMod * healPower ||
      entity.hp < healThreshold * entity.max_hp
    );
  };

  // Prioritized characters
  // const prioritized = prioritizedNamesList
  //   .map((name) => get_entity(name))
  //   .filter(
  //     (player) => player && !player.dead && !player.rip && shouldHeal(player),
  //   )
  //   .sort((lhs, rhs) => lhs.hp / lhs.max_hp - rhs.hp / rhs.max_hp);

  // Other healable entities
  const potentialHealees = [
    ...Object.values(parent.entities),
    ...(character.ctype === "priest" ? [character] : []),
  ]
    .filter((entity) => {
      if (!entity) return false;
      if (entity.dead || entity.rip) return false;

      if (character.ctype === "priest" && entity.mtype === "ghost") {
        return !entity.s.healed && entity.hp < 7000;
      }

      if (entity.type === "monster" || entity.citizen) return false;
      if (HEAL_IGNORE.includes(entity.name)) return false;

      return shouldHeal(entity);
    })
    .sort((lhs, rhs) => {
      // Ghosts first if both exist

      const isLhsPrioritized = prioritizedNamesList.includes(lhs.name);
      const isRhsPrioritized = prioritizedNamesList.includes(rhs.name);

      if (isLhsPrioritized !== isRhsPrioritized)
        return isLhsPrioritized ? -1 : 1;

      const ghostLhs = lhs.mtype === "ghost";
      const ghostRhs = rhs.mtype === "ghost";
      if (ghostLhs !== ghostRhs) return ghostLhs ? -1 : 1;
      return lhs.hp / lhs.max_hp - rhs.hp / rhs.max_hp;
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

// BOSS fight functions
function targetBoss(boss) {
  const target = get_nearest_monster({ type: boss });
  if (target) change_target(target);
}

function sleep(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function shouldGoToBoss(mboss) {
  return (
    !boss.includes(getTarget()?.mtype) &&
    parent.S[mboss] &&
    parent.S[mboss].live &&
    ((parent.S[mboss].hp < bossOffset * parent.S[mboss].max_hp &&
      parent.S[mboss].target !== null &&
      !partyMems.includes(parent.S[mboss].target)) ||
      mboss === "snowman")
  );
}

function goToBoss() {
  for (i in boss) {
    if (shouldGoToBoss(boss[i])) {
      log("Attempting boss");
      stop("move");
      change_target();
      smartmoveDebug = false;
      if (!smart.moving && !isAdvanceSmartMoving)
        advanceSmartMove(parent.S[boss[i]])
          .then(() => targetBoss(boss[i]))
          .catch((e) => {
            use_skill("use_town");
            change_target();
          });
      return true;
    }
  }
  return false;
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

  try {
    if (MIDAS_CHARACTER.includes(character.name)) {
      if (
        chests.length >= LOOTING_LIMIT ||
        ((smart.moving || isAdvanceSmartMoving) && !smartmoveDebug) ||
        forced
      ) {
        isLooting = true;
        shouldReset = true;

        if ((!smart.moving && !isAdvanceSmartMoving) || forced)
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
              },
              true,
            ),
            500,
          );

        let breakFlag = LOOTING_LIMIT * 2;
        for (const chest of chests) {
          if (breakFlag-- <= 0) break;
          if (distance(chest, character) <= 800) {
            promises.push(loot(chest.id));
          }
        }
      }
    } else if (
      !MIDAS_CHARACTER.includes(character.name) &&
      partyMidasUsers.length
    ) {
      const currentTarget = get_target();
      let modifier = 1;

      if (currentTarget && currentTarget.type === "monster") {
        modifier = Math.max(5000 / currentTarget.hp, 1);
      }

      if (
        chests.length >= LOOTING_LIMIT * modifier &&
        (smart.moving || isAdvanceSmartMoving || forced)
      ) {
        isLooting = true;
        shouldReset = true;

        let breakFlag = LOOTING_LIMIT * 1.5 * modifier;
        for (const chest of chests) {
          if (breakFlag-- <= 0) break;

          if (
            partyMidasUsers.every((player) => distance(chest, player) > 800)
          ) {
            promises.push(loot(chest.id));
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
    character.hp < Math.max(0.15 * character.max_hp, 2000) &&
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
        await smartMove({
          map: character.map,
          x: currentTarget.real_x,
          y: currentTarget.real_y,
        });
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
  if (isInvFull(6)) {
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
  const allCharacters = [...partyMems, partyMerchant];

  if (parent.caracAL && caracALconfig.characters[character.name].enabled) {
    if (character.ctype === "merchant" && parent.caracAL.siblings.length)
      parent.caracAL.siblings
        .filter((id) => id !== character.name && !partyMems.includes(id))
        .forEach((id) => parent.caracAL.shutdown(id));

    allCharacters
      .filter((id) => parent.caracAL && !parent.caracAL.siblings.includes(id))
      .forEach((id) => {
        parent.caracAL.deploy(id, null, caracALconfig.characters[id].script);
      });
  } else if (
    !character.controller &&
    allCharacters.filter((characterId) => characterId !== character.name)
      .length !== loadedCharacters.length
  ) {
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

  const serverCharacters = await getServerPlayers();
  const partyWhitelistRegex = [/^earth/];
  const whitelistPartyMembers = serverCharacters.filter(
    (char) =>
      !partyMems.includes(char.name) &&
      char.type !== "merchant" &&
      partyWhitelistRegex.some((regex) => regex.test(char.party)),
  );
  const hasWhitelistedMember = parent.party_list.some((member) =>
    whitelistPartyMembers.some((whitelisted) => whitelisted.name === member),
  );

  if (
    whitelistPartyMembers.length &&
    whitelistPartyMembers.length <= 9 &&
    (!parent.party_list.length || !hasWhitelistedMember)
  ) {
    send_party_request(
      whitelistPartyMembers.find((member) =>
        partyWhitelistRegex.some((regex) => regex.test(member.name)),
      ).name,
    );
  }

  if (Math.min(...parent.pings) > 1000 && character.ctype !== "merchant") {
    if (parent.caracAL) parent.caracAL.shutdown();
    else disconnect();
  }

  if (partyMems.some((id) => !parent.party_list.includes(id))) {
    if (character.name === partyMems[0]) {
      partyMems.forEach((member) => {
        send_party_invite(member);
      });
    }
  }

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
const RSPEED_MARGIN = 5 * 60 * 1000; // 5 minutes

const setRogueSpeedLastDeployment = () => {
  const last = get("rogueLastDeployed");
  const lastDate = last ? new Date(last) : null;

  // If we recently deployed (still inside rspeed - 5m), DO NOT overwrite
  if (lastDate && mssince(lastDate) < RSPEED_DURATION - RSPEED_MARGIN) {
    return; // Too early to overwrite
  }

  // Otherwise update the timestamp
  set("rogueLastDeployed", new Date());
};

const shouldDeployRogue = () => {
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
  snowman: () => {
    RANGER = RANGER1;
    HEALER = RANGER;
    return [WARRIOR, RANGER, MAGE];
  },
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
    const isAggroed = !!parent.S.franky?.target;
    HEALER = PRIEST;
    return [WARRIOR, PRIEST, isAggroed ? ROGUE : MAGE];
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
      return [ROGUE, RANGER, PRIEST];
    },
    EUII: () => {
      RANGER = RANGER2;
      HEALER = PRIEST;
      return [ROGUE, RANGER, PRIEST];
    },
    USII: () => {
      RANGER = RANGER1;
      HEALER = PRIEST;
      return [WARRIOR, RANGER, PRIEST];
    },
    default: [WARRIOR, PRIEST, ROGUE],
  },
  pinkgoo: {
    USI: [WARRIOR, MAGE, ROGUE],
    EUII: () => {
      RANGER = RANGER2;
      HEALER = RANGER;
      return [WARRIOR, RANGER, MAGE];
    },
    USII: () => {
      RANGER = RANGER1;
      HEALER = PRIEST;
      return [MAGE, RANGER, PRIEST];
    },
    default: () => {
      RANGER = RANGER1;
      HEALER = RANGER;
      return [WARRIOR, RANGER, MAGE];
    },
  },
  crabxx: () => {
    const isAggroed = !!parent.S.crabxx?.target;
    if (isAggroed) RANGER = RANGER1;
    HEALER = isAggroed ? RANGER1 : PRIEST;
    return [WARRIOR, isAggroed ? RANGER1 : PRIEST, isAggroed ? RANGER2 : MAGE];
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
        RANGER = RANGER1;
        HEALER = RANGER;
        return [WARRIOR, RANGER, MAGE];
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

  if (parent.S.pinkgoo?.live) {
    changeToNormalStrategies();
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

    const currentTarget = get_target();
    const snowmanInstance = get_nearest_monster({ type: "snowman" });
    const grinchInstance = get_nearest_monster({ type: "grinch" });
    const beeToAttack =
      currentTarget && currentTarget.mtype === "arcticbee"
        ? currentTarget
        : get_nearest_monster({ type: "arcticbee" });

    if (!snowmanInstance) advanceSmartMove(parent.S.snowman);
    else {
      if (grinchInstance) change_target(grinchInstance);
      else if (snowmanInstance.s?.fullguardx) change_target(beeToAttack);
      else change_target(snowmanInstance);

      return grinchInstance ?? snowmanInstance.s?.fullguardx
        ? beeToAttack
        : snowmanInstance;
    }
  }

  const activeBosses = [];

  if (
    parent.S.mrpumpkin &&
    parent.S.mrpumpkin.live &&
    parent.S.mrpumpkin.target
  ) {
    activeBosses.push({
      ...parent.S.mrpumpkin,
      type: "mrpumpkin",
      strategy: changeToPullStrategies,
    });
  }

  if (parent.S.mrgreen?.live && parent.S.mrgreen.target) {
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
      const bossInstance = get_nearest_monster({ type: bossToFight.type });
      bossToFight.strategy();
      if (!bossInstance) advanceSmartMove(bossToFight);
      else {
        change_target(bossInstance);
        return bossInstance;
      }
    }
  }

  if (
    parent.S.crabxx?.live &&
    parent.S.crabxx.hp < parent.S.crabxx.max_hp &&
    parent.S.crabxx?.target &&
    !partyMems.includes(parent.S.crabxx.target)
  ) {
    if (character.range > 100) rangeRate = 0.3;

    const findBestCrabx = () =>
      Object.values(parent.entities)
        .filter((m) => m.mtype === "crabx")
        .sort((lhs, rhs) =>
          is_in_range(lhs, "attack") !== is_in_range(rhs, "attack")
            ? is_in_range(lhs, "attack")
              ? -1
              : 1
            : lhs.hp === rhs.hp
            ? distance(rhs, character) - distance(lhs, character)
            : lhs.hp - rhs.hp,
        )
        .pop();

    let crabxxInstance = get_nearest_monster({ type: "crabxx" });
    let crabxInstance = findBestCrabx();

    if (!crabxxInstance) {
      if (character.s.hopsickness) {
        await advanceSmartMove({ map: "main", x: -960, y: 1655 });
      } else {
        await join("crabxx");
        await sleep(character.ping);
      }

      crabxxInstance = get_nearest_monster({ type: "crabxx" });
      crabxInstance = findBestCrabx();
    }

    if (
      character.ctype === "warrior" &&
      crabxxInstance &&
      !crabxxInstance.s.stunned &&
      Object.values(parent.entities).filter((e) => e?.mtype === "crabx")
        .length <= 1
    ) {
      await warriorStomp();
    }

    // if (
    //   character.ctype === "mage" &&
    //   crabxxInstance &&
    //   crabxxInstance.target &&
    //   character.mp > 600 &&
    //   is_in_range(crabxxInstance, "cburst") &&
    //   !is_on_cooldown("cburst")
    // ) {
    //   const crabxToCBurst = Object.values(parent.entities)
    //     .filter(
    //       (entity) =>
    //         entity.type === "monster" &&
    //         entity.mtype === "crabx" &&
    //         entity.hp < 500 &&
    //         !entity.rip,
    //     )
    //     .map((crabx) => [crabx, crabx.hp * 2]);
    //   use_skill("cburst", [[crabxxInstance, 1], ...crabxToCBurst]);
    // }

    let targetCrab;
    if (character.ctype === "warrior") {
      targetCrab = crabxxInstance?.target ? crabxxInstance : crabxInstance;
    } else {
      targetCrab =
        crabxInstance || (crabxxInstance?.target ? crabxxInstance : undefined);
    }

    // if (
    //   crabxxInstance &&
    //   crabxxInstance.target &&
    //   !partyMems.includes(crabxxInstance.target)
    // )
    //   changeToPullStrategies();
    // else
    changeToNormalStrategies();

    change_target(targetCrab);
    return targetCrab;
  }

  if (
    parent.S.franky?.live &&
    parent.S.franky?.target &&
    parent.S.franky?.hp < 0.97 * parent.S.franky?.max_hp
  ) {
    changeToNormalStrategies();
    let frankyInstance = get_nearest_monster({ type: "franky" });
    if (!frankyInstance) {
      await join("franky").catch((e) => console.warn(e));
      await sleep(character.ping);
      await advanceSmartMove(parent.S.franky);
      frankyInstance = get_nearest_monster({ type: "franky" });
      change_target(frankyInstance);
    }

    if (frankyInstance)
      if (frankyInstance.target && !partyMems.includes(frankyInstance.target)) {
        rangeRate = 0.2;
        return frankyInstance;
      } else {
        scareAwayMobs();
        return frankyInstance;
      }
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

    for (id in parent.entities) {
      const currentCharacter = parent.entities[id];

      if (currentCharacter.team === character.team || currentCharacter.rip)
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
    changeToNormalStrategies();
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

      console.warn(
        error,
        error.distance
          ? `| ${Math.round(error.distance)} distance / ${
              character.range + character.xrange
            } range`
          : "",
      );
    }
  } else console.warn("Error while attacking:", error);
}

setInterval(() => parent.socket.emit("send_updates", {}), 30000);
