// Grace planning for listed upgrades and compounds (see REFERENCE.md)

/** Gold a primling is counted as */
const PRIMLING_VALUE = 5_000_000;

/** Per item: `value` is a +0 copy's gold (or { level: gold }), `graceFromLevel` where grace planning starts */
const UPGRADE_CONFIG = {
  essenceoffire: { value: 200_000 },
  firestars: { value: 400_000, graceFromLevel: 7 },
  fireblade: { graceFromLevel: 7 },
  firestaff: { graceFromLevel: 7 },
  firebow: { graceFromLevel: 7 },
  vattire: { graceFromLevel: 4, value: 4_000_000 },
  vhammer: { graceFromLevel: 4, value: 10_000_000 },
  vdagger: { graceFromLevel: 4, value: 12_000_000 },
};

/** Vendor item failed on purpose */
const FAILSTACK_FODDER = "helmet";

/** Spare leveled copies failed before a helmet is bought: these sets plus vendor gear, `pull` per bank visit */
const FAILSTACK_POOL = { sets: ["bunny", "holidays", "wanderers"], pull: 3 };

/** Gold kept before any fodder is bought */
const FAILSTACK_GOLD_FLOOR = 100_000_000;

/** How long after a stack step the fodder is kept */
const FAILSTACK_HOLD_MS = 60_000;

/** Fails in a row before the stack gives up */
const FAILSTACK_MAX_FAILS = 18;

/** Stack sizes weighed ahead */
const FAILSTACK_LOOKAHEAD = 12;

/** Grace one fodder fail adds: 1/4.5 personal + 1/3 realm-wide */
const FAILSTACK_GRACE = 1 / 4.5 + 1 / 3;

/** Grace a scroll-less primling adds */
const FEED_GRACE = 0.5;

/** Highest scroll grade the planner buys */
const GRACE_MAX_SCROLL_GRADE = 2;

/** Offering grace a listed compound waits for */
const COMPOUND_WARM_OGRACE = 1.2;

/** Longest a listed compound waits */
const COMPOUND_HOLD_MS = 60 * 60_000;

/** Held set -> when it started waiting */
const compoundHoldSince = {};

/** New level -> fodder fails since its last success */
const stackFails = {};

/** The probe leaves fodder alone until then */
var failstackUntil = 0;

/** The level the running failstack builds, and the bag slot it builds for */
var failstackLevel = 0;
var failstackSlot = -1;

/** How long a request to the bank loop stands */
const BANK_REQUEST_MS = 10 * 60_000;

/** What the tick asks the next bank visit to bring out */
const bankRequests = { fodderLevel: 0, fodderUntil: 0, primlingUntil: 0 };

/** Last feed, `{ key, chance, gain }` */
var lastGraceFeed = null;

/** Copies whose own grace is capped */
const graceFeedCapped = {};

var lastGracePlanLog = "";

// ---------------------------------------------------------------------------
// Worth
// ---------------------------------------------------------------------------

/** @returns {number} gold price of an upgrade scroll */
function getScrollPrice(grade) {
  return G.items[`scroll${grade}`]?.g ?? Infinity;
}

/** @returns {number|undefined} base chance of reaching `newLevel` */
function getBaseUpgradeChance(name, newLevel) {
  return G.upgrades[item_grade({ name, level: 0 })]?.[newLevel];
}

/** @returns {number} expected gold to climb a copy worth `cost` on plain scrolls */
function getClimbCost(name, fromLevel, toLevel, cost) {
  if (!G.items[name]?.upgrade) return cost;

  for (let level = fromLevel + 1; level <= toLevel; level++) {
    const chance = getBaseUpgradeChance(name, level);
    if (!chance) return cost;
    const grade = item_grade({ name, level: level - 1 });
    cost = (cost + getScrollPrice(grade)) / chance;
  }
  return cost;
}

/** @returns {number} what losing a copy costs: config value, vendor price or recipe, climbed to its level */
function getItemWorth(item, depth = 0) {
  const level = item.level ?? 0;
  const value = UPGRADE_CONFIG[item.name]?.value;

  if (typeof value === "number")
    return getClimbCost(item.name, 0, level, value);

  if (value) {
    const known = Object.keys(value)
      .map(Number)
      .filter((key) => key <= level);
    if (known.length) {
      const from = Math.max(...known);
      return getClimbCost(item.name, from, level, value[from]);
    }
  }

  if (BUYABLE.includes(item.name))
    return getClimbCost(item.name, 0, level, G.items[item.name].g);

  const recipe = G.craft[item.name];
  if (recipe && depth < 4) {
    const base = recipe.items.reduce(
      (sum, [quantity, name, ingredientLevel]) =>
        sum +
        quantity * getItemWorth({ name, level: ingredientLevel }, depth + 1),
      recipe.cost ?? 0,
    );
    return getClimbCost(item.name, 0, level, base);
  }

  return item_value(item) * 2;
}

// ---------------------------------------------------------------------------
// Chance model
// ---------------------------------------------------------------------------

/** @returns {number} the server's upgrade chance at a grace number */
function modelUpgradeChance(item, graceNum, scrollGrade, usePrimling) {
  const newLevel = (item.level ?? 0) + 1;
  const grade = item_grade(item);
  const base = getBaseUpgradeChance(item.name, newLevel);
  const grace = Math.max(0, graceNum) * (base / newLevel + 0.001);

  let chance = base;
  let high = false;
  if (scrollGrade > grade && newLevel <= 10) {
    chance = chance * 1.2 + 0.01;
    high = true;
  }

  if (usePrimling) {
    const offeringGrade = G.items.offeringp.grade;
    if (offeringGrade > grade + 1) {
      chance = chance * 1.7 + grace * 4;
      high = true;
    } else if (offeringGrade > grade) {
      chance = chance * 1.5 + grace * 1.2;
      high = true;
    } else if (offeringGrade === grade) {
      chance = chance * 1.4 + grace;
    } else if (offeringGrade === grade - 1) {
      chance = chance * 1.15 + grace / 3.2;
    } else {
      chance = chance * 1.08 + grace / 4;
    }
  } else {
    chance += Math.max(0, grace / 4.8 - 0.4 / (newLevel - 0.999) ** 2);
  }

  const cap = high
    ? Math.min(base + 0.36, base * 3)
    : Math.min(base + 0.24, base * 2);
  return Math.min(chance, cap);
}

/** @returns {number} the lowest grace number that explains a chance the server reported */
function estimateGraceNum(item, chance, scrollGrade, usePrimling) {
  let low = 0;
  let high = 40;
  if (modelUpgradeChance(item, low, scrollGrade, usePrimling) >= chance - 1e-9)
    return 0;

  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (
      modelUpgradeChance(item, mid, scrollGrade, usePrimling) >=
      chance - 1e-9
    )
      high = mid;
    else low = mid;
  }
  return high;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/** @returns {boolean} whether the item's next upgrade is planned for grace */
function isGraceUpgrade(item, targeted) {
  const fromLevel = UPGRADE_CONFIG[item.name]?.graceFromLevel;
  if (targeted || fromLevel === undefined) return false;
  if ((item.level ?? 0) < fromLevel) return false;
  return !!getBaseUpgradeChance(item.name, (item.level ?? 0) + 1);
}

/** @returns {number} primlings in the bag and the bank */
function countPrimlings() {
  return [...character.items, ...getItemBankSlots("offeringp", true)].reduce(
    (sum, item) => sum + (item?.name === "offeringp" ? item.q ?? 1 : 0),
    0,
  );
}

/** @returns {number} gold one fodder attempt at `newLevel` spends */
function getFodderAttemptCost(newLevel) {
  const fodder = { name: FAILSTACK_FODDER, level: newLevel - 1 };
  return getItemWorth(fodder) + getScrollPrice(item_grade(fodder));
}

/** @returns {{ scrollGrade, usePrimling, chance, spend }} the cheapest upgrade per success at a grace number */
function pickUpgradeSend(item, worth, graceNum, primlings) {
  const grade = item_grade(item);
  let best;

  for (
    let scrollGrade = grade;
    scrollGrade <= Math.min(grade + 1, GRACE_MAX_SCROLL_GRADE);
    scrollGrade++
  ) {
    for (const usePrimling of primlings > 0 ? [false, true] : [false]) {
      const chance = modelUpgradeChance(
        item,
        graceNum,
        scrollGrade,
        usePrimling,
      );
      const spend =
        worth +
        getScrollPrice(scrollGrade) +
        (usePrimling ? PRIMLING_VALUE : 0);
      if (!best || spend / chance < best.spend / best.chance)
        best = { scrollGrade, usePrimling, chance, spend };
    }
  }
  return best;
}

/** @returns {object} the cheapest next step, `action` being "upgrade", "feed" or "stack" */
function planGraceUpgrade(state) {
  const { item, worth, graceNum, primlings } = state;
  const send = pickUpgradeSend(item, worth, graceNum, primlings);
  let plan = {
    action: "upgrade",
    ...send,
    costPerSuccess: send.spend / send.chance,
  };

  if (state.canFeed && primlings > 0) {
    const fed = pickUpgradeSend(
      item,
      worth,
      graceNum + FEED_GRACE,
      primlings - 1,
    );
    const cost = (fed.spend + PRIMLING_VALUE) / fed.chance;
    if (cost < plan.costPerSuccess)
      plan = { ...plan, action: "feed", costPerSuccess: cost };
  }

  if (state.canStack) {
    const cost = getFailstackCost(state, send);
    if (cost < plan.costPerSuccess)
      plan = { ...plan, action: "stack", costPerSuccess: cost };
  }

  return plan;
}

/** @returns {number} gold per success after stacking first, Infinity when a step is not worth it */
function getFailstackCost(state, send) {
  const { item, worth, graceNum, primlings } = state;
  const newLevel = (item.level ?? 0) + 1;
  const fodder = pickFailstackFodder(newLevel, state.itemIndex);
  if (!fodder) return Infinity;
  const { failChance, cost: attemptCost } = fodder;
  const chanceAt = (grace) =>
    modelUpgradeChance(item, grace, send.scrollGrade, send.usePrimling);

  // A fodder success wipes the stack
  const gain =
    failChance * (chanceAt(graceNum + FAILSTACK_GRACE) - send.chance);
  const risk = (1 - failChance) * (send.chance - chanceAt(state.floorGraceNum));
  if (gain < risk) return Infinity;

  let best = Infinity;
  for (let fails = 1; fails <= FAILSTACK_LOOKAHEAD; fails++) {
    const stacked = pickUpgradeSend(
      item,
      worth,
      graceNum + fails * FAILSTACK_GRACE,
      primlings,
    );
    // Attempts for that many fails in a row
    const attempts = (failChance ** -fails - 1) / (1 - failChance);
    best = Math.min(
      best,
      (stacked.spend + attempts * attemptCost) / stacked.chance,
    );
  }
  return best;
}

/** @returns {string} one copy at one level in one slot */
function getGraceKey(item, slot) {
  return `${slot}:${item.name}:${item.level ?? 0}`;
}

function logGracePlan(item, plan, graceNum, worth) {
  const line =
    `grace: ${item.name}+${item.level ?? 0} ${plan.action}` +
    ` scroll${plan.scrollGrade}${plan.usePrimling ? " +primling" : ""}`;
  if (line === lastGracePlanLog) return;
  lastGracePlanLog = line;
  console.log(
    `${line}, chance ${(plan.chance * 100).toFixed(2)}%,` +
      ` grace ${graceNum.toFixed(2)}, worth ${Math.round(worth / 1e3)}k,` +
      ` ${Math.round(plan.costPerSuccess / 1e6)}m per success`,
  );
}

/** Feeds or stacks when that is cheaper (`sent`), else returns the slots to upgrade with */
async function planGraceStep(itemIndex) {
  const item = character.items[itemIndex];
  const grade = item_grade(item);
  const newLevel = (item.level ?? 0) + 1;

  const scrollSlot = await ensureScroll(`scroll${grade}`, grade);
  if (scrollSlot === -1) return {};
  await ensureOffering(true);
  if (isInBank()) return {};

  const primlingSlot = locate_item("offeringp");
  const hasPrimling = primlingSlot !== -1;

  const reading = await upgrade(
    itemIndex,
    scrollSlot,
    hasPrimling ? primlingSlot : undefined,
    true,
  ).catch(() => null);
  if (typeof reading?.chance !== "number") return {};

  const itemGrace = reading.grace ?? 0;
  const igrace = [1, -1, -2][item_grade({ name: item.name, level: 0 })] ?? -2;
  const fails = stackFails[newLevel] ?? 0;
  const floorGraceNum = Math.max(0, Math.min(newLevel + 1, itemGrace + igrace));
  const graceNum = Math.max(
    estimateGraceNum(item, reading.chance, grade, hasPrimling),
    Math.max(
      0,
      Math.min(newLevel + 1, itemGrace + igrace + Math.min(3, fails / 4.5)),
    ),
  );

  const key = getGraceKey(item, itemIndex);
  updateGraceFeedback(key, reading.chance);

  const worth = getItemWorth(item);
  const plan = planGraceUpgrade({
    item,
    itemIndex,
    worth,
    graceNum,
    floorGraceNum,
    primlings: countPrimlings(),
    canFeed:
      hasPrimling && !graceFeedCapped[key] && itemGrace + igrace < newLevel + 1,
    canStack:
      fails < FAILSTACK_MAX_FAILS &&
      character.gold >= FAILSTACK_GOLD_FLOOR &&
      !!getBaseUpgradeChance(FAILSTACK_FODDER, newLevel),
  });
  logGracePlan(item, plan, graceNum, worth);

  if (plan.action === "feed") {
    lastGraceFeed = {
      key,
      chance: reading.chance,
      gain:
        modelUpgradeChance(item, graceNum + FEED_GRACE, grade, true) -
        modelUpgradeChance(item, graceNum, grade, true),
    };
    await upgrade(itemIndex, undefined, primlingSlot).catch(() => {});
    return { sent: true };
  }

  if (plan.action === "stack") {
    return { sent: await runFailstackStep(newLevel, itemIndex) };
  }

  // A banked primling arrives with the next bank trip
  if (plan.usePrimling && !hasPrimling) {
    requestPrimling();
    return {};
  }

  let sendSlot = scrollSlot;
  if (plan.scrollGrade !== grade) {
    const better = await ensureScroll(
      `scroll${plan.scrollGrade}`,
      plan.scrollGrade,
    );
    if (better !== -1) sendSlot = better;
  }
  return {
    scrollSlot: sendSlot,
    offeringSlot: plan.usePrimling ? primlingSlot : undefined,
  };
}

/** Marks a feed the cap swallowed */
function updateGraceFeedback(key, chance) {
  if (lastGraceFeed?.key === key) {
    if (
      lastGraceFeed.gain > 1e-4 &&
      chance < lastGraceFeed.chance + lastGraceFeed.gain / 2
    )
      graceFeedCapped[key] = true;
  }
  lastGraceFeed = null;
}

/** A success wipes that level's pity counters */
function noteUpgradeSuccess(level) {
  stackFails[level] = 0;
}

// ---------------------------------------------------------------------------
// Failstack
// ---------------------------------------------------------------------------

/** @returns {boolean} whether the failstack still owns its fodder */
function isFailstacking() {
  return Date.now() < failstackUntil;
}

/** @returns {number} bag slot of the highest fodder at or under `maxLevel`, or -1 */
function findFodderSlot(maxLevel) {
  let best = -1;
  character.items.forEach((item, slot) => {
    if (item?.name !== FAILSTACK_FODDER || item.l) return;
    if ((item.level ?? 0) > maxLevel) return;
    if (best === -1 || (item.level ?? 0) > (character.items[best].level ?? 0))
      best = slot;
  });
  return best;
}

/**
 * A copy the server would fail at `newLevel` for us: it tries that very level,
 * is low grade, and is vendor gear or in a pool set. Spareness is the caller's.
 * @param {object} item
 * @param {number} newLevel
 * @returns {boolean}
 */
function isPoolFodder(item, newLevel) {
  if (!item || item.l || item.p || item.ach) return false;
  if ((item.level ?? 0) !== newLevel - 1 || item_grade(item) > 1) return false;

  const def = G.items[item.name];
  if (!def?.upgrade || UPGRADE_CONFIG[item.name]) return false;
  if (IGNORE.includes(item.name) || isCraftIngredient(item.name)) return false;
  return (
    FAILSTACK_POOL.sets.includes(def.set) || !!findVendorMerchantOf(item.name)
  );
}

/**
 * @param {object} item
 * @param {number} [slot] - its bag slot; the stack's own target is never held
 * @returns {boolean} whether the bag keeps this copy for the running failstack
 */
function isHeldFailstackFodder(item, slot) {
  const level = isFailstacking() ? failstackLevel : getRequestedFodderLevel();
  return level > 0 && slot !== failstackSlot && isPoolFodder(item, level);
}

/** @returns {number} the level the bank loop was asked to bring fodder for, 0 if none */
function getRequestedFodderLevel() {
  return Date.now() < bankRequests.fodderUntil ? bankRequests.fodderLevel : 0;
}

/** Asks the next bank visit for a primling */
function requestPrimling() {
  bankRequests.primlingUntil = Date.now() + BANK_REQUEST_MS;
}

/** @returns {object | undefined} the banked primling a waiting upgrade or compound asked for */
function selectPrimlingPull() {
  if (Date.now() >= bankRequests.primlingUntil) return;
  if (locate_item("offeringp") !== -1) return;
  return getItemBankSlots("offeringp", true)[0];
}

/**
 * Spare pool copies for a stack at `newLevel`, cheapest fail first. A line
 * gives only what it holds above its keep threshold.
 * @param {number} newLevel
 * @param {number} [excludeSlot] - the bag slot being upgraded
 * @returns {Array<{ item: object, where: "bag"|"bank", slot: number, pack?: string, floor?: string, cost: number, failChance: number }>}
 */
function listPoolFodder(newLevel, excludeSlot) {
  const gear = getMerchantGearCounts();
  const level = newLevel - 1;
  const copies = [];
  const consider = (item, where, slot, pack, floor) => {
    if (!isPoolFodder(item, newLevel) || gear.has(item.name)) return;
    const chance =
      G.upgrades[item_grade({ name: item.name, level: 0 })]?.[newLevel];
    if (!chance) return;
    copies.push({
      item,
      where,
      slot,
      pack,
      floor,
      // A spare copy's only other use is its sale price
      cost: item_value(item) + getScrollPrice(item_grade(item)),
      failChance: 1 - chance,
    });
  };

  character.items.forEach((item, slot) => {
    if (slot !== excludeSlot) consider(item, "bag", slot);
  });
  forEachBankSlot((item, pack, slot, floor) =>
    consider(item, "bank", slot, pack, floor),
  );

  copies.sort(
    (lhs, rhs) =>
      lhs.cost / lhs.failChance - rhs.cost / rhs.failChance ||
      (lhs.where === "bag" ? -1 : 1),
  );

  const spare = {};
  return copies.filter(({ item }) => {
    const key = getItemKey(item);
    spare[key] ??= countKeyAtOrAbove(key, level) - getKeepThreshold(key);
    return spare[key]-- > 0;
  });
}

/**
 * The cheapest fodder for one fail at `newLevel`, by gold per fail: a spare
 * pool copy (bag, or bank while the bag has room to pull it), else a helmet.
 * @param {number} newLevel
 * @param {number} [excludeSlot] - the bag slot being upgraded
 * @returns {{ where: "bag"|"bank"|"buy", slot?: number, cost: number, failChance: number } | undefined}
 */
function pickFailstackFodder(newLevel, excludeSlot) {
  const canPull = !isInvFull(RETRIEVE_SCROLL_SLOTS + FAILSTACK_POOL.pull);
  const pool = listPoolFodder(newLevel, excludeSlot).find(
    ({ where }) => where === "bag" || canPull,
  );

  const helmetChance = getBaseUpgradeChance(FAILSTACK_FODDER, newLevel);
  const helmet = helmetChance && {
    where: "buy",
    cost: getFodderAttemptCost(newLevel),
    failChance: 1 - helmetChance,
  };

  if (!pool) return helmet || undefined;
  if (!helmet) return pool;
  return pool.cost / pool.failChance <= helmet.cost / helmet.failChance
    ? pool
    : helmet;
}

/**
 * Bank copies a waiting failstack asked for, up to `limit`, less what the bag
 * already holds for it.
 * @param {number} limit
 * @returns {Array<object>} bank slots, shaped like getItemBankSlots
 */
function selectFailstackPull(limit) {
  const level = getRequestedFodderLevel();
  if (!level || limit <= 0) return [];

  const pool = listPoolFodder(level);
  const held = pool.filter(({ where }) => where === "bag").length;
  return pool
    .filter(({ where }) => where === "bank")
    .slice(0, Math.max(0, Math.min(limit, FAILSTACK_POOL.pull - held)))
    .map(({ item, pack, slot, floor }) => ({ ...item, pack, slot, floor }));
}

/** One fodder upgrade towards a fail at `newLevel`; returns true once something was sent */
async function runFailstackStep(newLevel, excludeSlot) {
  failstackUntil = Date.now() + FAILSTACK_HOLD_MS;
  failstackLevel = newLevel;
  failstackSlot = excludeSlot;

  const pick = pickFailstackFodder(newLevel, excludeSlot);
  // The bank loop brings the copy out on its next visit
  if (pick?.where === "bank") {
    bankRequests.fodderLevel = newLevel;
    bankRequests.fodderUntil = Date.now() + BANK_REQUEST_MS;
    return false;
  }
  bankRequests.fodderUntil = 0;

  let slot = pick?.where === "bag" ? pick.slot : findFodderSlot(newLevel);
  if (slot === -1) {
    if (isInvFull(0)) return;
    try {
      await buy(FAILSTACK_FODDER, 1);
    } catch (e) {
      return;
    }
    slot = findFodderSlot(newLevel);
    if (slot === -1) return;
  }

  const fodder = character.items[slot];
  const attempt = (fodder.level ?? 0) + 1;
  const grade = item_grade(fodder);
  const isBonus = attempt > newLevel;
  if (
    isBonus &&
    (!getBaseUpgradeChance(FAILSTACK_FODDER, attempt) ||
      getScrollPrice(grade) > getFodderAttemptCost(newLevel))
  ) {
    await sell(slot, 1).catch(() => {});
    return true;
  }

  const scrollSlot = await ensureScroll(`scroll${grade}`, grade);
  if (scrollSlot === -1 || isInBank()) return;

  const production = getLeakSafeProduction(fodder);
  if (production) activateMassProduction(production === "pp");

  const result = await (attempt < newLevel
    ? upgradeInLuckySlot(slot, scrollSlot)
    : upgrade(slot, scrollSlot)
  ).catch(() => null);
  if (!result) return true;

  if (result.success) {
    noteUpgradeSuccess(attempt);
    if (isBonus) {
      const grown = character.items.findIndex(
        (item) => item?.name === FAILSTACK_FODDER && item.level === attempt,
      );
      if (grown !== -1) await sell(grown, 1).catch(() => {});
    }
    return true;
  }

  if (attempt < newLevel) return true;
  stackFails[newLevel] =
    (stackFails[newLevel] ?? 0) + (isBonus && attempt >= 8 ? 2 : 1);
  return true;
}

/** Sells leftover fodder, never the probe's own low copies */
async function sellStaleFodder() {
  if (isFailstacking() || isInBank()) return;

  for (let slot = 0; slot < character.items.length; slot++) {
    const item = character.items[slot];
    if (item?.name !== FAILSTACK_FODDER || item.l) continue;
    if ((item.level ?? 0) < LUCKY_SLOT_PROBE_MAX_LEVEL) continue;
    await sell(slot, 1).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Compounds
// ---------------------------------------------------------------------------

/** @returns {boolean} whether the item's compound set is on the grace list */
function isGraceCompound(item, targeted) {
  const fromLevel = UPGRADE_CONFIG[item.name]?.graceFromLevel;
  if (targeted || fromLevel === undefined) return false;
  return !!G.items[item.name]?.compound && (item.level ?? 0) >= fromLevel;
}

/** @returns {number|undefined} the server's compound chance with a primling */
function modelCompoundChance(item, graceSum, scrollGrade) {
  const level = item.level ?? 0;
  const grade = item_grade(item);
  const tableGrade = item_grade({
    name: item.name,
    level: level >= 3 ? level - 2 : 0,
  });
  const base = G.compounds[tableGrade]?.[level + 1];
  if (!base) return undefined;

  let chance = base;
  let high = 0;
  if (scrollGrade > grade) {
    chance = chance * 1.1 + 0.001;
    high = scrollGrade - grade;
  }

  const grace = 0.027 * (graceSum + 0.5);
  const offeringGrade = G.items.offeringp.grade;
  if (offeringGrade > grade + 1) {
    chance = chance * 1.64 + grace * 2;
    high = 1;
  } else if (offeringGrade > grade) {
    chance = chance * 1.48 + grace;
    high = 1;
  } else if (offeringGrade === grade) {
    chance = chance * 1.36 + Math.min(30 * 0.027, grace);
  } else if (offeringGrade === grade - 1) {
    chance =
      chance * 1.15 + Math.min(25 * 0.019, grace) / Math.max(level - 2, 1);
  } else {
    chance =
      chance * 1.08 + Math.min(15 * 0.015, grace) / Math.max(level - 1, 1);
  }

  return Math.min(chance, base * (3 + high * 0.6), base + 0.2 + high * 0.05);
}

/** @returns {Promise<boolean>} whether a listed set should wait for a warmer chance */
async function shouldHoldCompound(slots, scrollSlot, offeringSlot) {
  const item = character.items[slots[0]];
  const key = `${getItemKey(item)}:${item.level ?? 0}`;

  const reading = await compound(
    ...slots,
    scrollSlot,
    offeringSlot,
    true,
  ).catch(() => null);
  const warm = modelCompoundChance(
    item,
    (reading?.grace ?? 0) + COMPOUND_WARM_OGRACE,
    G.items[character.items[scrollSlot]?.name]?.grade,
  );
  const isWarm =
    typeof reading?.chance !== "number" ||
    warm === undefined ||
    reading.chance >= warm - 1e-6;

  const isNewHold = compoundHoldSince[key] === undefined;
  const since = (compoundHoldSince[key] = compoundHoldSince[key] ?? Date.now());
  if (isWarm || Date.now() - since > COMPOUND_HOLD_MS) {
    delete compoundHoldSince[key];
    return false;
  }

  if (isNewHold)
    console.log(
      `grace: holding ${item.name}+${item.level ?? 0} set at ` +
        `${(reading.chance * 100).toFixed(2)}%, warm at ${(warm * 100).toFixed(
          2,
        )}%`,
    );
  return true;
}
