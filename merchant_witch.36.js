// Witch's Cipher: the merchant's ingredient stock, his company while the party gathers, and the brewing.

const WITCH_STOCK_PUBLISH_MS = 30_000;

/** Distance he keeps to a gathering fighter */
const WITCH_ATTEND_DISTANCE = 200;

/** Within this of the mage he walks to the party instead of asking for a magiport */
const WITCH_WALK_TO_MAGE_DISTANCE = 400;

/** @returns {Object<string, number>} ingredient counts over bank and bag */
const countWitchStock = () =>
  Object.fromEntries(
    WITCH_INGREDIENTS.map((kind) => [
      kind,
      [...character.items, ...getItemBankSlots(kind, true, true)].reduce(
        (total, item) => (item?.name === kind ? total + (item.q ?? 1) : total),
        0,
      ),
    ]),
  );

/** Shares bank and bag ingredient counts with the fighters */
function publishWitchStock() {
  if (isBankKnown()) set("witchStock", countWitchStock());
}

setInterval(publishWitchStock, WITCH_STOCK_PUBLISH_MS);

/** @returns {Promise<boolean>} whether staying with the gathering party owned this tick */
async function attendWitchGathering() {
  if (isWitchBrewDue()) return false;

  const plan = getWitchGatherPlan();
  const isFree =
    isBankKnown() &&
    !mustAbandonFight() &&
    (!isOnDuty() || isOnDuty(DUTY.WITCH) || isOnDuty(DUTY.EVENT));

  if (!plan || !isFree) {
    if (isOnDuty(DUTY.WITCH)) releaseDuty(duty);
    return false;
  }

  if (isOnDuty(DUTY.WITCH)) renewDuty(duty);
  else {
    releaseEventDuty();
    if (!takeDuty(DUTY.WITCH)) return false;
  }

  if (smart.moving || isAdvanceSmartMoving) return true;

  const fighter = partyMems.map((name) => get_entity(name)).find(Boolean);
  const anchor = fighter
    ? { map: character.map, x: fighter.real_x, y: fighter.real_y }
    : plan.spot;
  const mage = get_entity(MAGE);
  const isMageNearby =
    !!mage && distance(character, mage) < WITCH_WALK_TO_MAGE_DISTANCE;
  if (distance(character, anchor) > WITCH_ATTEND_DISTANCE)
    await advanceSmartMove(anchor, {
      useScare: true,
      useMagiport: !isMageNearby,
    }).catch((e) => console.warn(e));

  return true;
}


// Brewing

/** Expected Parcels a mix that can't crack must beat: 20 ingredients make one */
const WITCH_MIN_MIX_PARCELS = WITCH_SLOTS / 20;

/** Wait after a refused brew, and after a mix per `WITCH_STRIKE_POSSIBLE` candidates it leaves */
const WITCH_BREW_SPACING_MS = 400;

/** A stack per ingredient, and one for the Parcels */
const WITCH_BAG_SLOTS = WITCH_INGREDIENTS.length + 1;

const WITCH_FINAL_REJECTIONS = [
  "witchcipher_not_live",
  "witchcipher_no_mixes",
  "witchcipher_elsewhere",
];

const WITCH_RECIPES = Array.from(
  { length: WITCH_INGREDIENTS.length ** WITCH_SLOTS },
  (_, n) =>
    Array.from(
      { length: WITCH_SLOTS },
      (_, i) =>
        WITCH_INGREDIENTS[
          Math.floor(n / WITCH_INGREDIENTS.length ** i) %
            WITCH_INGREDIENTS.length
        ],
    ),
);

/** The UTC day the ingredients were last taken out of the bank */
let witchPackedDay;

let nextWitchBrewAt = 0;

/** @returns {number} ingredients of `mix` in the same place as in `recipe` */
const countRightPlaces = (recipe, mix) =>
  recipe.reduce((right, name, i) => right + (name === mix[i]), 0);

/** @returns {string[][]} untried recipes that fit every clue, from `fit` when the server sends it */
function getWitchCandidates({ fit, board = [] }) {
  if (fit)
    return WITCH_RECIPES.filter(
      (_, n) => (parseInt(fit[n >> 2], 16) >> (n & 3)) & 1,
    );

  const tried = new Set(board.map(({ mix }) => mix.join()));
  return WITCH_RECIPES.filter(
    (recipe) =>
      !tried.has(recipe.join()) &&
      board.every(({ mix, right }) => countRightPlaces(recipe, mix) === right),
  );
}

/** @returns {boolean} whether `counts` holds every ingredient of `mix` */
function canAffordMix(mix, counts) {
  const needed = {};
  for (const name of mix) needed[name] = (needed[name] ?? 0) + 1;
  return Object.entries(needed).every(([name, n]) => counts[name] >= n);
}

/**
 * @param {string[]} mix
 * @param {string[][]} candidates
 * @returns {{spread: number, right: number}} the Σ n² of its clue groups, and its expected right places
 */
function scoreWitchMix(mix, candidates) {
  const groups = new Array(WITCH_SLOTS + 1).fill(0);
  for (const recipe of candidates) groups[countRightPlaces(recipe, mix)]++;
  return {
    spread: groups.reduce((sum, n) => sum + n * n, 0),
    right: groups.reduce((sum, n, k) => sum + n * k, 0) / candidates.length,
  };
}

/**
 * @param {Array} items
 * @param {Function} score - an item's score, or undefined to skip it
 * @param {Function} compare - positive when the first score is better
 * @returns {*} the best scored item, a random one among equals
 */
function pickBest(items, score, compare) {
  let best;
  let bestScore;
  let ties = 0;
  for (const item of items) {
    const itemScore = score(item);
    if (itemScore === undefined) continue;

    const order = ties ? compare(itemScore, bestScore) : 1;
    if (order > 0) {
      best = item;
      bestScore = itemScore;
      ties = 1;
    } else if (order === 0 && Math.random() * ++ties < 1) best = item;
  }
  return best;
}

/**
 * @param {Object} cipher - server.status.witchcipher
 * @param {Object<string, number>} counts - ingredients we may spend
 * @param {boolean} hasCracked - whether the account took today's crack bonus
 * @param {boolean} [mayMiss] - whether a mix that can't crack is still worth brewing
 * @returns {string[]|undefined} before the crack, the candidate narrowing most; else the untried mix paying most
 */
function pickWitchMix(cipher, counts, hasCracked, mayMiss = true) {
  const candidates = getWitchCandidates(cipher);
  if (!candidates.length) return;

  if (!hasCracked) {
    const best = pickBest(
      candidates,
      (mix) =>
        canAffordMix(mix, counts) ? scoreWitchMix(mix, candidates) : undefined,
      (a, b) => b.spread - a.spread || a.right - b.right,
    );
    if (best || !mayMiss) return best;
  }

  const tried = new Set((cipher.board ?? []).map(({ mix }) => mix.join()));
  return pickBest(
    WITCH_RECIPES,
    (mix) => {
      if (tried.has(mix.join()) || !canAffordMix(mix, counts)) return;
      const { right } = scoreWitchMix(mix, candidates);
      return right > WITCH_MIN_MIX_PARCELS ? right : undefined;
    },
    (a, b) => a - b,
  );
}

/** @returns {Object<string, number>} counts above the elixir reserve */
const spareWitchIngredients = (counts) =>
  Object.fromEntries(
    WITCH_INGREDIENTS.map((kind) => [
      kind,
      Math.max(0, (counts[kind] ?? 0) - WITCH_ELIXIR_RESERVE),
    ]),
  );

/** @returns {boolean} whether the bag keeps this item: a round here to brew in, or one ahead on any brew realm */
const isHeldForWitchBrew = (itemName) =>
  WITCH_INGREDIENTS.includes(itemName) &&
  (canBrewWitchCipher() ||
    (typeof isWitchBrewAhead === "function" && isWitchBrewAhead()));

const hasRoomForWitchParcels = () =>
  !isInvFull(0) || locate_item("witchparcel") !== -1;

/** @returns {boolean} whether the day's ingredients are still in the bank with a brewable round ahead, or live here */
function needsWitchPack() {
  if (witchPackedDay === getUtcDay() || !isBankKnown()) return false;
  if (typeof isWitchBrewAhead === "function" && isWitchBrewAhead()) return true;
  return canBrewWitchCipher();
}

/** Takes every ingredient out of the bank for the day, with room for the Parcels */
async function packWitchBag() {
  witchPackedDay = getUtcDay();
  if (isInvFull(WITCH_BAG_SLOTS))
    await bankStoreRoutine(true).catch((e) => console.warn(e));

  const slots = WITCH_INGREDIENTS.flatMap((kind) =>
    getItemBankSlots(kind, true, true),
  );
  if (slots.length)
    await retrieveAll(slots, true).catch((e) => console.warn(e));
}

/** @returns {Promise<boolean>} whether getting within her reach took this tick; a computer reaches her from anywhere but the bank */
async function approachWitch(witch) {
  if (haveAComputer()) {
    if (!isInBank()) return false;
    await moveHome();
    return true;
  }

  if (character.map === witch.map && distance(character, witch) <= NPC_REACH)
    return false;

  const spot = strategicSmartMove.getStandablePointNear(witch) ?? witch;
  await advanceSmartMove(spot).catch((e) => console.warn(e));
  return true;
}

function finishWitchBrewing() {
  set("witchBrewDone", getWitchRoundKey());
  if (isOnDuty(DUTY.WITCH)) releaseDuty(duty);
}

/**
 * Brews `mix`, then sets when the next one may go
 * @param {string[]} mix
 * @param {string} reason - strike or flush, and the candidates left before it, for the log
 */
async function brewWitchMix(mix, reason) {
  const result = await brew(mix).catch((e) => e);
  const { right, fits, cracked, parcels, mixes_left, reason: refusal } =
    result ?? {};
  console.warn(
    `[witchcipher] ${reason} ${mix.join(",")}:`,
    JSON.stringify({ right, fits, cracked, parcels, mixes_left, refusal }),
  );

  if (WITCH_FINAL_REJECTIONS.includes(result?.reason)) {
    if (typeof forgetWitchDay === "function") forgetWitchDay();
    return finishWitchBrewing();
  }

  if (!result?.success) {
    nextWitchBrewAt = Date.now() + WITCH_BREW_SPACING_MS;
    return;
  }

  if (typeof noteWitchDay === "function")
    noteWitchDay({ mixes_left: result.mixes_left, server: getCurrentServer() });
  if (result.cracked && result.parcels >= G.events.witchcipher.payout.crack)
    set("witchCrackedDay", getUtcDay());

  const left = server.status.witchcipher?.possible ?? WITCH_STRIKE_POSSIBLE;
  nextWitchBrewAt =
    Date.now() +
    WITCH_BREW_SPACING_MS * (left / WITCH_STRIKE_POSSIBLE);
}

/** @returns {Promise<boolean>} whether brewing, or packing for it, owned this tick */
async function brewWitchCipher() {
  const isFree = !isOnDuty() || isOnDuty(DUTY.WITCH);
  const wantsPack = needsWitchPack();
  if (character.rip || !isFree || (!wantsPack && !isWitchBrewDue())) {
    if (isOnDuty(DUTY.WITCH)) releaseDuty(duty);
    return false;
  }

  if (isOnDuty(DUTY.WITCH)) renewDuty(duty);
  else if (!takeDuty(DUTY.WITCH)) return false;

  if (smart.moving || isAdvanceSmartMoving) return true;
  if (wantsPack) {
    await packWitchBag();
    return true;
  }

  // Packed before any hop, so a fresh landing brews from the bag ahead of its first bank walk
  if (isBankKnown() && !hasRoomForWitchParcels()) {
    await bankStoreRoutine(true).catch((e) => console.warn(e));
    return true;
  }

  const witch = find_npc("witch");
  if (!witch) {
    finishWitchBrewing();
    return false;
  }
  if (await approachWitch(witch)) return true;
  if (Date.now() < nextWitchBrewAt) return true;

  const cipher = server.status.witchcipher;
  const key = getCurrentServer();
  const isFlushing = isWitchFlushDue(cipher);
  if (!isFlushing && !isWitchBoardWorthStriking(key, cipher)) return true;

  const possible = cipher.possible ?? getWitchCandidates(cipher).length;
  const hasCracked = get("witchCrackedDay") === getUtcDay();
  const mix = pickWitchMix(
    cipher,
    spareWitchIngredients(countBagWitchIngredients()),
    hasCracked,
    isFlushing,
  );
  if (!mix) {
    if (!isFlushing) return true;
    finishWitchBrewing();
    return false;
  }

  witchStrikingBoard = `${key}|${cipher.id}|${cipher.cracks}`;
  await brewWitchMix(mix, `${isFlushing ? "flush" : "strike"} @${possible}`);
  return true;
}
