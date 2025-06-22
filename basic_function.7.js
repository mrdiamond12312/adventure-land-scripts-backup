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

var TANKER = "MooohMoooh";
// var TANKER = "CowTheMooh";

const MAGE = "MowTheCooh";
var HEALER = "CowTheMooh";
// const HEALER = "CupidCow";
const RANGER = "MoohThatCow";

const MIDAS_CHARACTER = [MAGE];

// var partyCodeSlot = [4, 15, 3, 5];
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

function assignRoles() {
  if (partyMems.includes("MooohMoooh") && partyMems.includes("CowTheMooh")) {
    if (get_targeted_monster()?.damage_type === "magical") {
      TANKER = "CowTheMooh";
    } else TANKER = "MooohMoooh";
  }
}

//  run and hit
const movementHistory = [];
var flipRotation = 1;
var flipRotationCooldown = 0;
var angle; // Your desired angle from the monster, in radians
var flip_cooldown = 0;
var stuck_threshold = 2;
var basicRangeRate = 0.5; // Is used to reset
var rangeRate = basicRangeRate; // Variate range rate

const spacial = 16;

// Monsters selector
var min_xp = 100;
var max_att = 2000;
var bossOffset = 0.99;
var boss = ["mrpumpkin", "mrgreen"];

// var map = "main";
// var mapX = 1248;
// var mapY = -63;

var map = "winterland";
var mapX = 423;
var mapY = -2614;

// var map = "uhills";
// var mapX = -289;
// var mapY = -188;

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

// desired elixir named
var desiredElixir = "elixirluck";

//// INVENTORY functions
function item_info(item) {
  if (!item) return undefined;
  return parent.G.items[item.name];
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

const disablePullingStrategy = false;

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
  "x0",
  "staff",
  "x1",
  "x2",
  "x3",
  "x4",
  "x5",
  "x6",
  "x7",
  "x8",
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
  "candycane",
  "candy0",
  "stand0",
  "pickaxe",
  "rod",
  "broom",
  "tracker",
  "sword",
  "throwingstars",
  "orboffire",
  "orboffrost",
  "orbofplague",
  "orbofresolve",
  ...BUYABLE,
];

const STORE_ABLE = [
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
  "dexscroll",
  "cshell",
  "crabclaw",
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
  "orboffire",
  "orboffrost",
  "orbofplague",
  "orbofresolve",
];

const SALE_ABLE = [
  "frankypants",
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
  // "wcap",
  // "wshoes",
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
  "gphelmet",
  "phelmet",
  "maceofthedead",
  "pmaceofthedead",
  "maceofthedead",
  "staffofthedead",
  "swordofthedead",
  "throwingstars",
  "ringsj",
  "mshield",
  "hhelmet",
  "hgloves",
  "harmor",
  "hpants",
  "hboots",
  "smoke",
  "sword",
  "spear",
  // Easter's loots
  // "eears",
  // "eslippers",
  // Sell and replace by crypts's drops
  "intearring",
  "strearring",
];
var maxUpgrade = 7;
var maxCompound = 3;

// Bank
const bankSlots = ["items0", "items1", "items3"];

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
  var inv = character.items;
  const invLength = inv.length;
  const promises = [];
  for (let i = 0; i < invLength; i++) {
    for (let j = i; j < invLength; j++) {
      const lhs = inv[i];
      const rhs = inv[j];
      if (rhs === null) continue;
      if (lhs === null) {
        const temp = inv[i];
        inv[i] = inv[j];
        inv[j] = temp;
        promises.push(swap(i, j));
        continue;
      }
      if (lhs.name.localeCompare(rhs.name) === -1) {
        const temp = inv[i];
        inv[i] = inv[j];
        inv[j] = temp;
        promises.push(swap(i, j));
        continue;
      }
      if (lhs.name === rhs.name) {
        if ((lhs?.level ?? 0) > (rhs?.level ?? 0)) {
          const temp = inv[i];
          inv[i] = inv[j];
          inv[j] = temp;
          promises.push(swap(i, j));
        }
      }
    }
  }
  return Promise.all(promises).finally(() => {
    isSortingInventory = false;
  });
}

function calculateRangeRate() {
  switch (character.ctype) {
    case "priest":
      return character.name === TANKER && currentStrategy === usePullStrategies
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
  for (monster of mobsToFarm) {
    if (get_nearest_monster({ min_xp, type: monster })) {
      return get_nearest_monster({ min_xp, type: monster });
    }
  }
  // return (
  //   get_nearest_monster({ min_xp, max_att, type }) ??
  //   get_nearest_monster({ min_xp, max_att, type: altType1 }) ??
  //   get_nearest_monster({ min_xp, max_att, type: altType2 })
  // );
}

function buff() {
  if (
    character.hp / character.max_hp < character.mp / character.max_mp ||
    (character.hp < character.max_hp * 0.6 && character.mp > 500)
  ) {
    if (
      character.hp < 0.8 * character.max_hp &&
      character.hp < character.max_hp - 500 &&
      !is_on_cooldown("use_hp")
    )
      use_skill("use_hp").then(() => {
        reduce_cooldown("use_mp", character.ping * 0.95);
        reduce_cooldown("use_hp", character.ping * 0.95);
      });
    else if (
      character.hp < character.max_hp - 50 &&
      !is_on_cooldown("regen_hp")
    )
      use_skill("regen_hp").then(() => {
        reduce_cooldown("use_mp", character.ping * 0.95);
        reduce_cooldown("use_hp", character.ping * 0.95);
      });
  } else {
    if (character.mp < character.max_mp - 500 && !is_on_cooldown("use_mp")) {
      use_skill("use_mp").then(() => {
        reduce_cooldown("use_mp", character.ping * 0.95);
        reduce_cooldown("use_hp", character.ping * 0.95);
      });
    } else if (
      character.mp < character.max_mp - 100 &&
      !is_on_cooldown("regen_mp")
    )
      use_skill("regen_mp").then(() => {
        reduce_cooldown("use_mp", character.ping * 0.95);
        reduce_cooldown("use_hp", character.ping * 0.95);
      });
  }
}

function getTarget() {
  const leader = get_entity(partyMems[0]);
  var target = get_targeted_monster();

  if (target && !get_nearest_monster({ type: target.mtype }))
    target = undefined;

  if (!target) {
    if (character.name === partyMems[0]) {
      target = getMonstersOnDeclares();

      const mobsTargetingNonTanker = Object.values(parent.entities)
        .filter(
          (entity) =>
            entity.type === "monster" &&
            (entity.target === HEALER || entity.target === MAGE),
        )
        .sort(
          (lhs, rhs) => distance(rhs, character) - distance(lhs, character),
        );
      if (
        mobsTargetingNonTanker.length &&
        (!target ||
          (target &&
            target.target !== character.name &&
            partyMems.includes(target.target)))
      ) {
        target = mobsTargetingNonTanker.shift();
      }
    } else {
      const mob = getMonstersOnDeclares();
      const aggroedMobs = Object.values(parent.entities).filter(
        (mob) =>
          mob.type === "monster" &&
          [...partyMems, partyMerchant].includes(mob.target) &&
          is_in_range(mob, "attack"),
      );
      if (leader)
        target =
          get_target_of(leader) ?? aggroedMobs.length > 0
            ? aggroedMobs[0]
            : mob && mob.attack < 200
            ? mob
            : undefined;
      else target = mob;
    }

    if (target) change_target(target);
    else {
      set_message("No Monsters");
      if (
        character.map !== "crypt" &&
        leader &&
        !smart.moving &&
        !isAdvanceSmartMoving &&
        Math.sqrt(
          (character.x - leader.x) * (character.x - leader.x) +
            (character.y - leader.y) * (character.y - leader.y),
        ) > spacial &&
        can_move_to(
          character.x + (leader.x - character.x) / 2,
          character.y + (leader.y - character.y) / 2,
        )
      )
        move(
          character.x + (leader.x - character.x) / 2,
          character.y + (leader.y - character.y) / 2,
        );
      return;
    }
  }

  return target;
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
    smart_move(find_npc("jailer")).then(() => {
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
  return Math.min(get_height(target), get_width(target) / 2) / 2;
}

function hitAndRun(target, rangeRate) {
  if (!target) {
    angle = undefined;
    return;
  }

  if (!angle) {
    const diff_x = character.real_x - target.real_x;
    const diff_y = character.real_y - target.real_y;
    angle = Math.atan2(diff_y, diff_x);
  }

  let cosA = Math.cos(angle);
  let sinA = Math.sin(angle);

  movementHistory.push({ x: character.real_x, y: character.real_y });
  if (movementHistory.length > 5) movementHistory.shift();

  let totalMovement = 0;
  for (let i = 1; i < movementHistory.length; i++) {
    let dx = movementHistory[i].x - movementHistory[i - 1].x;
    let dy = movementHistory[i].y - movementHistory[i - 1].y;
    totalMovement += Math.sqrt(dx * dx + dy * dy);
  }

  if (totalMovement < stuck_threshold * movementHistory.length) {
    if (flipRotationCooldown <= 0) {
      flipRotation *= -1;
      flipRotationCooldown = 4;
      angle += (flipRotation * Math.PI) / 2;
    }
  }

  // const extraRangeByMobHitbox = extraDistanceWithinHitbox(
  //   angle,
  //   target ? get_width(target) ?? 0 : 0,
  //   target ? get_height(target) ?? 0 : 0
  // );

  const extraRangeByMobHitbox = extraDistanceWithinHitbox(target);
  const extraRangeBySelfHitbox = extraDistanceWithinHitbox(character);

  let new_x =
    target.x +
    character.range * rangeRate * cosA +
    (character.xrange * 0.9 + extraRangeByMobHitbox + extraRangeBySelfHitbox) *
      cosA;

  let new_y =
    target.y +
    character.range * rangeRate * sinA +
    (character.xrange * 0.9 + extraRangeByMobHitbox + extraRangeBySelfHitbox) *
      sinA;

  if (flip_cooldown > 9) {
    if (
      distance(character, target) <=
      (character.range + character.xrange) * 0.1 * rangeRate
    ) {
      angle += (flipRotation * Math.PI) / 16;
    }
    flip_cooldown = 0;
  }
  flip_cooldown--;
  flipRotationCooldown--;

  if (!is_in_range(target, "attack")) {
    // const diff_x = character.real_x - target.real_x;
    // const diff_y = character.real_y - target.real_y;
    // angle = Math.atan2(diff_y, diff_x);
    // const alt_x =
    //   target.x +
    //   (character.range * rangeRate + character.xrange) * Math.cos(angle);
    // const alt_y =
    //   target.y +
    //   (character.range * rangeRate + character.xrange) * Math.sin(angle);
    // move(alt_x, alt_y);

    move(new_x, new_y);
  } else if (!can_move_to(new_x, new_y)) {
    for (let i = 1; i <= 8; i++) {
      let adjustedAngle = angle + (flipRotation * Math.PI) / (16 / i);
      let alt_x =
        target.x +
        (character.range * rangeRate + character.xrange) *
          Math.cos(adjustedAngle);
      let alt_y =
        target.y +
        (character.range * rangeRate + character.xrange) *
          Math.sin(adjustedAngle);

      if (can_move_to(alt_x, alt_y)) {
        angle = adjustedAngle;
        move(alt_x, alt_y);
        return;
      }
    }
    flipRotation *= -1;
  } else {
    move(new_x, new_y);
  }
}

function getLowestHealth() {
  const allies = parent.party_list.map((name) => get_entity(name));
  allies.filter((entity) => entity);
  allies.sort((lhs, rhs) => lhs.hp / lhs.max_hp - rhs.hp / rhs.max_hp);
  return allies[0] || character;
}

function getLowestMana() {
  const allies = parent.party_list.map((name) => get_entity(name));
  allies.filter((entity) => entity);
  allies.sort((lhs, rhs) => lhs.mp / lhs.max_mp - rhs.mp / rhs.max_mp);
  return allies[0] || character;
}

//// RESPAWN
function handle_death() {
  respawn();
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

const LOOTING_LIMIT = 10;
var isLooting = false;
async function midasLooting(forced = false) {
  const chests = Object.values(parent.chests);
  if ((isLooting && !forced) || !chests.length) return;

  const promises = [];
  const partyMidasUsers = Object.keys(parent.party)
    .map((id) => get_player(id))
    .filter((player) => player && MIDAS_CHARACTER.includes(player.name));

  if (
    MIDAS_CHARACTER.includes(character.name) &&
    (chests.length >= LOOTING_LIMIT ||
      smart.moving ||
      isAdvanceSmartMoving ||
      forced)
  ) {
    isLooting = true;

    const currentBooster = findInvBooster();
    if (currentBooster && currentBooster !== "goldbooster") {
      await shift(locate_item(currentBooster), "goldbooster");
    }

    if ((!smart.moving && !isAdvanceSmartMoving) || forced)
      await equipBatch({
        helmet: "wcap",
        chest: "wattire",
        pants: "wbreeches",
        shoes: "wshoes",
        gloves: "handofmidas",
        amulet: "spookyamulet",
      });
    // Prevent overflooding code cost
    let breakFlag = LOOTING_LIMIT * 2;
    for (const chest of chests) {
      if (breakFlag <= 0) break;
      if (distance(chest, character) <= 800) {
        promises.push(loot(chest.id));
        breakFlag--;
      }
    }
    await Promise.all(promises);
    await equipBatch(calculateBestItems(), true);
  } else if (partyMidasUsers.length) {
    if (chests.length && (smart.moving || isAdvanceSmartMoving || forced)) {
      isLooting = true;
      let breakFlag = LOOTING_LIMIT * 1.5;
      for (const chest of chests) {
        if (breakFlag <= 0) break;
        if (
          partyMidasUsers.every((player) => distance(chest, player) > 800) ||
          10000 > mssince(chest.last_loot)
        ) {
          promises.push(loot(chest.id));
          breakFlag--;
        }
      }
    }
  } else if (
    (bestLooter().name === character.name || !bestLooter()) &&
    Object.keys(get_chests()).length
  ) {
    isLooting = true;
    promises.push(loot());
  }

  return Promise.all(promises).finally(() => {
    isLooting = false;
  });
}

setInterval(() => {
  if (!MIDAS_CHARACTER.includes(character.name) || !isEquipingItems) {
    midasLooting();
  }
}, 100);

async function cupidHeal() {
  if (
    (locate_item("cupid") === -1 &&
      character.slots.mainhand?.name !== "cupid") ||
    ms_to_next_skill("attack") > 0
  )
    return;

  const lowHealthPlayers = Object.values(parent.entities)
    .filter(
      (entity) =>
        entity &&
        entity.player &&
        is_in_range(entity, "attack") &&
        entity.hp < entity.max_hp * 0.8 &&
        entity.hp <
          entity.max_hp -
            character.attack *
              dps_multiplier(entity.armor - (character.apiercing ?? 0)),
    )
    .sort((lhs, rhs) => {
      if ([...partyMems, partyMerchant].includes(lhs.name)) return -1;
      if ([...partyMems, partyMerchant].includes(rhs.name)) return 1;

      return lhs.hp / lhs.max_hp - rhs.hp / rhs.max_hp;
    });

  const promises = [];

  if (lowHealthPlayers.length > 0) {
    promises.push(
      equipBatch({
        mainhand: "cupid",
      }),
    );

    await Promise.all(promises);

    if (
      character.level >= G.skills["5shot"].level &&
      lowHealthPlayers.length >= 4 &&
      character.mp > 400 &&
      !character.fear &&
      ms_to_next_skill("attack") === 0
    ) {
      set_message("5shot Cupid");
      log(
        `Healing ${lowHealthPlayers
          .slice(0, 5)
          .map((player) => player.name)
          .join(", ")}`,
      );
      use_skill("5shot", lowHealthPlayers.slice(0, 5)).then(() =>
        reduce_cooldown("attack", Math.min(...parent.pings)),
      );
      reduce_cooldown("attack", -(1 / character.frequency) * 1000);
    } else if (
      character.level >= G.skills["3shot"].level &&
      lowHealthPlayers.length >= 2 &&
      character.mp > 300 &&
      !character.fear &&
      ms_to_next_skill("attack") === 0
    ) {
      set_message("3shot Cupid");
      log(
        `Healing ${lowHealthPlayers
          .slice(0, 3)
          .map((player) => player.name)
          .join(", ")}`,
      );
      use_skill("3shot", lowHealthPlayers.slice(0, 3)).then(() =>
        reduce_cooldown("attack", Math.min(...parent.pings)),
      );
      reduce_cooldown("attack", -(1 / character.frequency) * 1000);
    } else if (
      ms_to_next_skill("attack") === 0 &&
      distance(lowHealthPlayers[0], character) <
        character.range +
          character.xrange +
          extraDistanceWithinHitbox(lowHealthPlayers[0]) +
          extraDistanceWithinHitbox(character)
    ) {
      set_message("Single Cupid");
      log(`Healing ${lowHealthPlayers[0].name}`);
      attack(lowHealthPlayers[0]).then(() =>
        reduce_cooldown("attack", Math.min(...parent.pings)),
      );
      reduce_cooldown("attack", -(1 / character.frequency) * 1000);
    }
  }
}

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
  const currentTarget = get_targeted_monster();

  if (
    currentTarget &&
    distance(currentTarget, character) >
      character.range +
        character.xrange +
        extraDistanceWithinHitbox(currentTarget) +
        extraDistanceWithinHitbox(character) &&
    !smart.moving &&
    !isAdvanceSmartMoving
  ) {
    smartmoveDebug = true;
    log("Debug being stuck while kiting");
    smart_move({ map: character.map, x: currentTarget.x, y: currentTarget.y })
      .then(() => {
        smartmoveDebug = false;
      })
      .catch(() => {
        smartmoveDebug = false;
      });
  }

  // Re-equip

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

  // Send gold to merchant if he's nearby
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
            "snowball",
            "spookyamulet",
            "xptome",
            "xpbooster",
            "goldbooster",
            "luckbooster",
            desiredElixir,
          ].includes(item.name)
        )
          return;
        await send_item(partyMerchant, index, 1000);
      }),
    );
  }

  // Inventory check and potions
  if (isInvFull(10)) {
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

// Party Setups
setInterval(async function () {
  //// Deploy characters which arent active
  const loadedCharacters = get_active_characters();
  const allCharacters = [...partyMems, partyMerchant];

  if (parent.caracAL && caracALconfig.characters[character.name].enabled) {
    for (const [index, id] of allCharacters.entries()) {
      if (
        parent.caracAL &&
        !parent.caracAL.siblings.find((sibling) => sibling === id)
      ) {
        parent.caracAL.deploy(id, null, caracALPartyCodeSlot[index]);
      }
    }
  } else if (
    !character.controller &&
    allCharacters.filter((characterId) => characterId !== character.name)
      .length !== loadedCharacters.length
  ) {
    for (const [index, id] of allCharacters.entries()) {
      if (!loadedCharacters[id]) {
        start_character(id, partyCodeSlot[index]);
      }
    }
    // allCharacters.forEach((characterId, index) => {
    //   if (!loadedCharacters[characterId]) {
    //     start_character(characterId, partyCodeSlot[index]);
    //   }
    // });
  }
  if (partyMems.length !== parent.party_list.length) {
    if (character.name === partyMems[0]) {
      partyMems.map((member) => {
        send_party_invite(member);
      });
      if (!parent.party_list.length || !parent.party_list.includes("earthPri"))
        send_party_request("earthPri");
    }
  }

  leaveJail();
}, 10000);

//// Events listeners
// Party Events
function on_party_invite(name) {
  if (name === partyMems[0]) accept_party_invite(name);
}

//// Daily Events
// var pinkGooVisitedBoundary = [];
async function changeToDailyEventTargets() {
  let target = getTarget();
  const isFightingBoss = boss.includes(getTarget()?.mtype);

  if (
    (parent.S.goobrawl || get_nearest_monster({ type: "bgoo" })) &&
    !isFightingBoss &&
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
  }

  if (parent.S.dragold?.live && !isFightingBoss) {
    changeToNormalStrategies();

    const dragoldInstance = get_nearest_monster({ type: "dragold" });
    if (!dragoldInstance) advanceSmartMove(parent.S.dragold);
    else {
      change_target(dragoldInstance);

      return dragoldInstance;
    }
  }

  if (parent.S.pinkgoo?.live && !isFightingBoss) {
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

  if (parent.S.snowman?.live && !isFightingBoss) {
    changeToNormalStrategies();

    const snowmanInstance = get_nearest_monster({ type: "snowman" });
    if (!snowmanInstance) advanceSmartMove(parent.S.snowman);
    else {
      if (snowmanInstance.s?.fullguardx)
        change_target(get_nearest_monster({ type: "arcticbee" }));
      else change_target(snowmanInstance);

      return snowmanInstance.s?.fullguardx
        ? get_nearest_monster({ type: "arcticbee" })
        : snowmanInstance;
    }
  }

  if (
    parent.S.crabxx?.live &&
    parent.S.crabxx.hp < parent.S.crabxx.max_hp &&
    !isFightingBoss &&
    parent.S.crabxx?.target &&
    !partyMems.includes(parent.S.crabxx.target)
  ) {
    changeToNormalStrategies();
    if (character.range > 100) rangeRate = 0.3;

    const findBestCrabx = () =>
      Object.values(parent.entities)
        .filter((m) => m.mtype === "crabx")
        .sort((lhs, rhs) =>
          lhs.hp === rhs.hp
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
    //   use_skill("cburst", [[crabxxInstance, 1]]);
    // }

    let targetCrab;
    if (character.ctype === "warrior") {
      targetCrab = crabxxInstance?.target ? crabxxInstance : crabxInstance;
    } else {
      targetCrab =
        crabxInstance || (crabxxInstance?.target ? crabxxInstance : undefined);
    }

    change_target(targetCrab);
    return targetCrab;
  }

  if (parent.S.icegolem?.live && !isFightingBoss) {
    changeToNormalStrategies();
    const iceGolemInstance = get_nearest_monster({ type: "icegolem" });
    if (!iceGolemInstance) {
      await advanceSmartMove({ map: "winterland", x: 792, y: 416 });
    }
    change_target(get_nearest_monster({ type: "icegolem" }));
    return get_nearest_monster({ type: "icegolem" });
  } else if (get_nearest_monster({ type: "icegolem" })) {
    changeToNormalStrategies();
    change_target(target);
    return get_nearest_monster({ type: "icegolem" });
  }

  if (
    parent.S.franky?.live &&
    parent.S.franky?.target &&
    parent.S.franky?.hp < 0.97 * parent.S.franky?.max_hp &&
    !isFightingBoss
  ) {
    changeToNormalStrategies();
    let frankyInstance = get_nearest_monster({ type: "franky" });
    if (!frankyInstance) {
      join("franky").catch(
        async () =>
          await advanceSmartMove(parent.S.franky).then(() =>
            change_target(get_nearest_monster({ type: "franky" })),
          ),
      );
      await smart_move(parent.S.franky);
      change_target(get_nearest_monster({ type: "franky" }));
      frankyInstance = get_nearest_monster({ type: "franky" });
    }

    if (frankyInstance)
      if (frankyInstance.target && !partyMems.includes(frankyInstance.target)) {
        rangeRate = 0.2;
        return frankyInstance;
      } else {
        change_target();
        await advanceSmartMove({ map: "level2w", x: -530, y: -173 });
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

      if (currentCharacter.team === character.team) continue;

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

    target = pvpTarget.entity;
  }

  if (parent.S.wabbit?.live && !isFightingBoss) {
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

  if (
    get_entity(HEALER) &&
    !get_entity(HEALER).rip &&
    character.ping < 600 &&
    (get_targeted_monster()?.level < 5 || get_targeted_monster()?.attack < 500)
  )
    changeToPullStrategies();
  else changeToNormalStrategies();

  rangeRate = calculateRangeRate() ?? originRangeRate ?? basicRangeRate;
  return target;
}

function on_magiport(name) {
  if (name === MAGE) {
    accept_magiport(name);
  }
}
