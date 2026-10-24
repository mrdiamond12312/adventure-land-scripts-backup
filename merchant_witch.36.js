// Witch's Cipher: the merchant's ingredient stock, his company while the party gathers, and the brewing.

const WITCH_STOCK_PUBLISH_MS = 30_000;

/** Distance he keeps to a gathering fighter */
const WITCH_ATTEND_DISTANCE = 200;

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
  if (hasVisitedBank) set("witchStock", countWitchStock());
}

setInterval(publishWitchStock, WITCH_STOCK_PUBLISH_MS);

/** @returns {Promise<boolean>} whether staying with the gathering party owned this tick */
async function attendWitchGathering() {
  if (canBrewWitchCipher()) return false;

  const plan = getWitchGatherPlan();
  const isFree =
    hasVisitedBank &&
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
  if (distance(character, anchor) > WITCH_ATTEND_DISTANCE)
    await advanceSmartMove(anchor).catch((e) => console.warn(e));

  return true;
}

// Brewing

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

/** Expected Parcels a mix that can't crack must beat: 20 ingredients make one */
const WITCH_MIN_MIX_PARCELS = WITCH_SLOTS / 20;

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
    let best;
    let bestScore;
    for (const mix of candidates) {
      if (!canAffordMix(mix, counts)) continue;

      const score = scoreWitchMix(mix, candidates);
      if (
        !bestScore ||
        score.spread < bestScore.spread ||
        (score.spread === bestScore.spread && score.right > bestScore.right)
      ) {
        best = mix;
        bestScore = score;
      }
    }
    if (best || !mayMiss) return best;
  }

  const tried = new Set((cipher.board ?? []).map(({ mix }) => mix.join()));
  let best;
  let bestRight = WITCH_MIN_MIX_PARCELS;
  for (const mix of WITCH_RECIPES) {
    if (tried.has(mix.join()) || !canAffordMix(mix, counts)) continue;

    const { right } = scoreWitchMix(mix, candidates);
    if (right > bestRight) {
      best = mix;
      bestRight = right;
    }
  }
  return best;
}

/** @returns {Object<string, number>} counts above the elixir reserve */
const spareWitchIngredients = (counts) =>
  Object.fromEntries(
    WITCH_INGREDIENTS.map((kind) => [
      kind,
      Math.max(0, (counts[kind] ?? 0) - WITCH_ELIXIR_RESERVE),
    ]),
  );

const WITCH_FINAL_REJECTIONS = [
  "witchcipher_not_live",
  "witchcipher_no_mixes",
  "witchcipher_elsewhere",
];

/** Candidates left at or below which a guess is worth one of the day's mixes */
const WITCH_STRIKE_POSSIBLE = 32;

/** How long before the cauldron closes the day's last round spends what is left */
const WITCH_FLUSH_LEAD_MS = 60_000;

/** How long an untouched board waits, once gathering is over, before the day's last round brews alone */
const WITCH_QUIET_MS = 2 * 60_000;

const WITCH_BREW_SPACING_MS = 3_000;

/** @returns {boolean} whether today's mixes end with this round: we are abroad, or the lineup holds no later round before the UTC day ends */
function isLastWitchRoundOfDay(cipher) {
  if (!isAtHomeServer()) return true;

  const dayEnd = getUtcDayEnd(cipher.start);
  return !getLineup(server.status.schedule, ["witchcipher"]).some(
    ({ status, at }) => status === "scheduled" && at > cipher.end && at < dayEnd,
  );
}

let witchBoardSeen = { state: undefined, at: 0 };

let witchSoloRound;

/** @returns {number} ms since the board last took a mix or a crack */
function getWitchBoardQuietMs(cipher) {
  const state = `${cipher.id}|${cipher.cracks}|${cipher.mixes}`;
  if (witchBoardSeen.state !== state) witchBoardSeen = { state, at: Date.now() };
  return Date.now() - witchBoardSeen.at;
}

/** @returns {boolean} whether the day's last round spends what is left: nobody is narrowing, or it is about to close */
function isFlushingWitchMixes(cipher) {
  const quietMs = getWitchBoardQuietMs(cipher);
  if (!isLastWitchRoundOfDay(cipher)) return false;

  const key = getWitchRoundKey(cipher);
  if (witchSoloRound === key) return true;

  const now = Date.now();
  const isQuiet = now >= cipher.gather_end && quietMs >= WITCH_QUIET_MS;
  if (!isQuiet && now < cipher.end - WITCH_FLUSH_LEAD_MS) return false;

  witchSoloRound = key;
  return true;
}

/** A stack per ingredient, and one for the Parcels */
const WITCH_BAG_SLOTS = WITCH_INGREDIENTS.length + 1;

const hasRoomForWitchParcels = () =>
  !isInvFull(0) || locate_item("witchparcel") !== -1;

let witchRetrievedRound;

let nextWitchBrewAt = 0;

/** @returns {boolean} whether the bag keeps this item for the round's brewing */
const isHeldForWitchBrew = (itemName) =>
  WITCH_INGREDIENTS.includes(itemName) && canBrewWitchCipher();

function finishWitchBrewing() {
  set("witchBrewDone", getWitchRoundKey());
  if (isOnDuty(DUTY.WITCH)) releaseDuty(duty);
}

/** @returns {Promise<boolean>} whether brewing owned this tick */
async function brewWitchCipher() {
  const isFree = !isOnDuty() || isOnDuty(DUTY.WITCH);
  if (!canBrewWitchCipher() || character.rip || !isFree || !hasVisitedBank) {
    if (isOnDuty(DUTY.WITCH)) releaseDuty(duty);
    return false;
  }

  const cipher = server.status.witchcipher;
  const hasCracked = get("witchCrackedDay") === getUtcDay();
  const spareStock = spareWitchIngredients(countWitchStock());
  if (!pickWitchMix(cipher, spareStock, hasCracked)) {
    finishWitchBrewing();
    return false;
  }

  if (isOnDuty(DUTY.WITCH)) renewDuty(duty);
  else if (!takeDuty(DUTY.WITCH)) return false;

  if (smart.moving || isAdvanceSmartMoving) return true;

  const key = getWitchRoundKey();
  if (witchRetrievedRound !== key) {
    witchRetrievedRound = key;
    if (isInvFull(WITCH_BAG_SLOTS))
      await bankStoreRoutine(true).catch((e) => console.warn(e));

    const slots = WITCH_INGREDIENTS.flatMap((kind) =>
      getItemBankSlots(kind, true, true),
    );
    if (slots.length)
      await retrieveAll(slots, true).catch((e) => console.warn(e));
    return true;
  }

  if (!hasRoomForWitchParcels()) {
    await bankStoreRoutine(true).catch((e) => console.warn(e));
    return true;
  }

  const witch = find_npc("witch");
  if (!witch) {
    finishWitchBrewing();
    return false;
  }

  const isAtWitch =
    character.map === witch.map &&
    distance(character, witch) <= NPC_REACH;
  if (!isAtWitch) {
    const spot = strategicSmartMove.getStandablePointNear(witch) ?? witch;
    await advanceSmartMove(spot).catch((e) => console.warn(e));
    return true;
  }

  if (Date.now() < nextWitchBrewAt) return true;

  const isFlushing = isFlushingWitchMixes(cipher);
  const possible = cipher.possible ?? getWitchCandidates(cipher).length;
  if (!isFlushing && possible > WITCH_STRIKE_POSSIBLE) return true;

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

  const result = await brew(mix).catch((e) => e);
  console.log(`[witchcipher] ${mix.join(",")}:`, result);

  nextWitchBrewAt = Date.now() + WITCH_BREW_SPACING_MS;

  if (result?.success) {
    if (result.cracked && result.parcels >= G.events.witchcipher.payout.crack)
      set("witchCrackedDay", getUtcDay());
  } else if (WITCH_FINAL_REJECTIONS.includes(result?.reason)) {
    finishWitchBrewing();
  }
  return true;
}
