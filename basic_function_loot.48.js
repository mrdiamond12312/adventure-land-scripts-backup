// basic_function part: respawn and harakiri, potion stock, chests and midas looting

//// RESPAWN
/** Ms past the server's cant_respawn wait before the retry */
const RESPAWN_RETRY_PAD_MS = 300;
const RESPAWN_DEATH_CHECKS = 5;
/** Seconds a harakiri is watched for the server's rip, and how long another one is held back */
const HARAKIRI_DEATH_CHECKS = 30;

/** A respawn in flight or waiting out the cooldown */
let isRespawnPending = false;
/** When the last harakiri went out, 0 once its death has arrived */
let harakiriSentAt = 0;

/** Respawns, and on cant_respawn retries once its `ms` has passed */
async function respawnWhenReady() {
  if (isRespawnPending || !character.rip) return;

  isRespawnPending = true;
  const retryMs = await respawn().then(
    () => 0,
    (e) => e?.ms ?? 0,
  );
  if (retryMs) await sleep(retryMs + RESPAWN_RETRY_PAD_MS);
  isRespawnPending = false;

  if (retryMs) respawnWhenReady();
}

function handle_death() {
  respawnWhenReady();
}

function respawnOnceDead(checksLeft = RESPAWN_DEATH_CHECKS) {
  if (character.rip) {
    harakiriSentAt = 0;
    return respawnWhenReady();
  }
  if (checksLeft > 1) setTimeout(() => respawnOnceDead(checksLeft - 1), 1000);
}

/** One harakiri until its death arrives or HARAKIRI_DEATH_CHECKS runs out */
function commitHarakiri() {
  if (Date.now() - harakiriSentAt < HARAKIRI_DEATH_CHECKS * 1000) return;

  harakiriSentAt = Date.now();
  parent.socket.emit("harakiri");
  respawnOnceDead(HARAKIRI_DEATH_CHECKS);
}

// Potions every character keeps stocked; fighters name one of these in their
// buy_potions cm, the merchant refuses anything else
const desiredPotions = ["mpot1", "hpot1"];

// Merchant's own potions: restock to POTION_STACK once it is nearly out
const POTION_STACK = 20;
const POTION_REFILL_AT = 2;

// Fighters ask the merchant for a refill below this
const POTION_REQUEST_AT = 200;

const LOOTING_LIMIT = 15;
var isLooting = false;

/** How far from a chest midasLooting opens it */
const CHEST_OPEN_REACH = 800;

const MIDAS_GEAR = {
  helmet: "wcap",
  chest: "wattire",
  pants: "wbreeches",
  shoes: "wshoes",
  gloves: "handofmidas",
  amulet: "spookyamulet",
  booster: "goldbooster",
  cape: "horsecapeg",
};

/** @returns {number} chest count that triggers a midas loot */
function midasLootingThreshold() {
  const currentTarget = get_target();
  const modifier =
    currentTarget?.type === "monster"
      ? Math.max(5000 / currentTarget.hp, 1)
      : 1;
  return LOOTING_LIMIT * modifier;
}

/** @returns {boolean} whether to wear MIDAS_GEAR */
function wantsMidasGear() {
  return (
    MIDAS_CHARACTER.includes(character.name) &&
    !character.cave &&
    Object.keys(parent.chests).length >= midasLootingThreshold()
  );
}

/**
 * MIDAS_GEAR slots not worn yet whose item is carried.
 * @returns {string[]}
 */
function midasSlotsPending() {
  return Object.entries(MIDAS_GEAR)
    .filter(([slot, name]) => {
      if (slot === "booster") {
        const booster = findInvBooster();
        return booster && booster !== name;
      }
      return (
        character.slots[slot]?.name !== name && findMaxLevelItem(name) >= 0
      );
    })
    .map(([slot]) => slot);
}

/** How far cave_open_chest reaches */
const CAVE_LOOT_RANGE = 400;

/**
 * Takes every cave chest in reach.
 * @param {object[]} chests
 * @returns {Promise<void>}
 */
async function lootCaveChests(chests) {
  if (isLooting || character.rip || character.cave.paused) return;

  const reachable = chests.filter(
    (chest) =>
      chest.map === character.map &&
      distance(chest, character) <= CAVE_LOOT_RANGE,
  );
  if (!reachable.length) return;

  isLooting = true;

  try {
    await withTimeout(
      Promise.allSettled(reachable.map((chest) => parent.open_chest(chest.id))),
      2500,
    );
  } finally {
    isLooting = false;
  }
}

async function midasLooting(forced = false) {
  const chests = Object.values(parent.chests);

  // A cave chest pays the shared purse at face value, so no gear changes it
  if (character.cave) return lootCaveChests(chests);

  // Early exit: do NOT touch isLooting here
  if (
    (isLooting && !forced) ||
    !chests.length ||
    // Only the midas swap spends penalty_cd; opening a chest costs nothing
    (character.s.penalty_cd && MIDAS_CHARACTER.includes(character.name))
  )
    return;

  let shouldReset = false;
  const promises = [];

  const bestLooterCharacter = bestLooter();
  const partyMidasUsers = [...getAlliedNames()]
    .map((id) => get_player(id))
    .filter((player) => player && MIDAS_CHARACTER.includes(player.name));

  const lootingThreshold = midasLootingThreshold();
  const isTravelling =
    (smart.moving || isAdvanceSmartMoving) && !smartmoveDebug;

  try {
    if (MIDAS_CHARACTER.includes(character.name)) {
      if (chests.length >= lootingThreshold || isTravelling || forced) {
        if (!forced && !isTravelling && midasSlotsPending().length) return;

        isLooting = true;
        shouldReset = true;

        if (forced)
          await withTimeout(
            equipBatch(
              { ...MIDAS_GEAR },
              { preventPenaltizeNextAttack: false, preventKeySnatch: false },
            ),
            500,
          );

        let breakFlag = lootingThreshold * 2;
        for (const chest of chests) {
          if (breakFlag-- <= 0) break;
          if (distance(chest, character) <= CHEST_OPEN_REACH) {
            promises.push(parent.open_chest(chest.id));
          }
        }
      }
    } else if (
      !MIDAS_CHARACTER.includes(character.name) &&
      partyMidasUsers.length
    ) {
      if (chests.length >= lootingThreshold && (isTravelling || forced)) {
        isLooting = true;
        shouldReset = true;

        let breakFlag = lootingThreshold * 2;
        for (const chest of chests) {
          if (breakFlag-- <= 0) break;

          if (
            partyMidasUsers.every(
              (player) => distance(chest, player) > CHEST_OPEN_REACH,
            )
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

/**
 * As a trip sets off, a Midas user forces a Midas loot of the chests it would
 * leave behind, without holding the trip up. Skipped with a mob on us: the
 * set swaps out our armour.
 * @param {string|Object} destination - what advanceSmartMove was handed
 */
function lootBeforeTrip(destination) {
  if (!MIDAS_CHARACTER.includes(character.name) || character.cave) return;

  const isLeavingReach =
    typeof destination !== "object" ||
    (!!destination.map && destination.map !== character.map) ||
    distance(character, destination) > CHEST_OPEN_REACH;
  const isChestInReach = Object.values(parent.chests).some(
    (chest) => distance(chest, character) <= CHEST_OPEN_REACH,
  );
  const isTargeted = Object.values(parent.entities).some(
    (mob) => mob.type === "monster" && mob.target === character.name,
  );
  if (!isLeavingReach || !isChestInReach || isTargeted) return;

  midasLooting(true).catch((e) => console.warn(e));
}

function suicide() {
  if (
    !character.rip &&
    character.hp + (projectileManager?.getIncomingNumber(character.name) ?? 0) <
      Math.max(0.15 * character.max_hp, 3500) &&
    (avgDmgTaken(character) > character.hp ||
      character.ping > 600 ||
      character.s.burned)
  ) {
    commitHarakiri();
    game_log("Harakiri");
  }
}
