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
 * @returns {string[]|undefined} before the crack, the candidate narrowing most; else the untried mix paying most
 */
function pickWitchMix(cipher, counts, hasCracked) {
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
    if (best) return best;
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

/** @returns {Promise<boolean>} whether brewing owned this tick */
async function brewWitchCipher() {
  const isFree = !isOnDuty() || isOnDuty(DUTY.WITCH);
  if (!canBrewWitchCipher() || mustAbandonFight() || !isFree) return false;
  if (!hasVisitedBank) return false;

  const key = getWitchRoundKey();
  const isWorthBrewing = pickWitchMix(
    server.status.witchcipher,
    spareWitchIngredients(countWitchStock()),
    get("witchCrackedDay") === getUtcDay(),
  );
  if (!isWorthBrewing) {
    set("witchBrewDone", key);
    return false;
  }

  if (!isOnDuty(DUTY.WITCH) && !takeDuty(DUTY.WITCH)) return false;

  try {
    const slots = WITCH_INGREDIENTS.flatMap((kind) =>
      getItemBankSlots(kind, true, true),
    );
    if (slots.length) await retrieveAll(slots, true);

    await advanceSmartMove(find_npc("witch")).catch((e) => console.warn(e));

    while (canBrewWitchCipher()) {
      const hasCracked = get("witchCrackedDay") === getUtcDay();
      const mix = pickWitchMix(
        server.status.witchcipher,
        spareWitchIngredients(countBagWitchIngredients()),
        hasCracked,
      );
      if (!mix) break;

      const result = await brew(mix).catch((e) => e);
      console.log(`[witchcipher] ${mix.join(",")}:`, result);
      if (!result?.success) break;
      if (result.cracked && result.parcels >= G.events.witchcipher.payout.crack)
        set("witchCrackedDay", getUtcDay());
    }
  } finally {
    set("witchBrewDone", key);
    releaseDuty(duty);
  }
  return true;
}
