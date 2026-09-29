// Finds the hidden lucky upgrade slot from the rolls the server leaks (see REFERENCE.md)

var FIND_LUCKY_SLOT = true;
var USE_LUCKY_SLOT = true;

const LUCKY_SLOT_COUNT = 42;
const LUCKY_SLOT_MAX_ATTEMPTS = 2000;
const LUCKY_SLOT_CONFIDENCE = 0.9999;
const LUCKY_SLOT_USE_CONFIDENCE = 0.99;
const LUCKY_SLOT_GOLD_FLOOR = 4_000_000_000;
const LUCKY_SLOT_PROBE_ITEM = "helmet";
const LUCKY_SLOT_PROBE_MAX_LEVEL = 4;
const LUCKY_SLOT_LOG_ROLLS = 5;
const LUCKY_SLOT_LS_KEY = "luckySlotTally";
const LUCKY_SLOT_EXPORT_DIR = "./CODE/adventure-land-scripts-backup/exports";
const LUCKY_SLOT_EXPORT_EVERY = 100;

/** Shortest upgrade whose four roll digits all reach the client */
const ROLL_LEAK_MIN_MS = 500;

/** At `rate`, the lucky slot's roll becomes max(rand/1e4, roll*scale - shift) */
const luckyBend = { rate: 0.6, scale: 0.975, shift: 0.012 };

const LUCKY_SLOT_HIGH_BIN = Math.round(
  (luckyBend.scale - luckyBend.shift) * 1e4,
);

/** Log likelihood ratio, lucky over normal, per 1e-4 roll bin */
const luckyLogLr = {
  zero: Math.log(
    1 -
      luckyBend.rate +
      luckyBend.rate *
        ((luckyBend.shift / luckyBend.scale) * 1e4 + 1 / luckyBend.scale),
  ),
  mid: Math.log(1 - luckyBend.rate + luckyBend.rate / luckyBend.scale),
  high: Math.log(1 - luckyBend.rate),
};

/** @type {{found: number|null, slots: {attempts: number, zeros: number, highs: number}[]}} */
const luckySlotTally = loadLuckySlotTally();
updateLuckySlotFound();

let isRollRecorded = false;
let rollsLogged = 0;

function loadLuckySlotTally() {
  const saved = readStore(LUCKY_SLOT_LS_KEY)[character.name];
  return {
    found: null,
    slots: Array.from({ length: LUCKY_SLOT_COUNT }, (_, slot) => ({
      attempts: 0,
      zeros: 0,
      highs: 0,
      ...saved?.slots?.[slot],
    })),
  };
}

function saveLuckySlotTally() {
  updateStoreEntry(LUCKY_SLOT_LS_KEY, character.name, luckySlotTally);
}

/** Counts every uscroll upgrade's roll once all four digits are in */
function onUpgradeProgress(data) {
  const { q, num, p } = data ?? {};
  if (q?.upgrade?.num !== num || !p?.nums) return;
  if (G.items[p.scroll]?.type !== "uscroll") return;

  // nums[3] is the tenths digit
  const digits = [3, 2, 1, 0].map((index) => p.nums[index]);
  if (digits.some((digit) => typeof digit !== "number")) {
    isRollRecorded = false;
    return;
  }
  if (isRollRecorded) return;
  isRollRecorded = true;

  recordLuckySlotRoll(
    num,
    digits.reduce((total, digit) => total * 10 + digit, 0),
  );
}

/**
 * @param {number} slot
 * @param {number} bin floor(roll * 1e4)
 */
function recordLuckySlotRoll(slot, bin) {
  if (!FIND_LUCKY_SLOT || isLuckySlotSettled()) return;

  const tally = luckySlotTally.slots[slot];
  if (!tally) return;

  tally.attempts++;
  if (bin === 0) tally.zeros++;
  else if (bin >= LUCKY_SLOT_HIGH_BIN) tally.highs++;

  if (rollsLogged < LUCKY_SLOT_LOG_ROLLS) {
    rollsLogged++;
    console.log(`Lucky slot: slot ${slot} rolled ${(bin / 1e4).toFixed(4)}`);
  }

  const chance = updateLuckySlotFound();
  if (luckySlotTally.found !== null)
    console.log(
      `Lucky slot found: ${luckySlotTally.found} at ${(chance * 100).toFixed(4)}%`,
    );

  saveLuckySlotTally();

  const total = luckySlotTally.slots.reduce(
    (sum, { attempts }) => sum + attempts,
    0,
  );
  if (
    parent.caracAL &&
    (isLuckySlotSettled() || total % LUCKY_SLOT_EXPORT_EVERY === 0)
  ) {
    try {
      exportLuckySlotTally();
    } catch (e) {
      console.warn("Lucky slot export failed:", e);
    }
  }
}

/** @returns {number[]} each slot's chance of being the lucky one */
function getLuckySlotPosterior() {
  const logLr = luckySlotTally.slots.map(
    ({ attempts, zeros, highs }) =>
      zeros * luckyLogLr.zero +
      highs * luckyLogLr.high +
      (attempts - zeros - highs) * luckyLogLr.mid,
  );
  const peak = Math.max(...logLr);
  const weights = logLr.map((value) => Math.exp(value - peak));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

/**
 * Re-derives `found` from the counts, so a raised confidence resumes probing.
 * @returns {number} the likeliest slot's chance
 */
function updateLuckySlotFound() {
  const posterior = getLuckySlotPosterior();
  const best = posterior.indexOf(Math.max(...posterior));
  luckySlotTally.found =
    posterior[best] >= LUCKY_SLOT_CONFIDENCE ? best : null;
  return posterior[best];
}

/** @returns {number} the slot upgradeInv should upgrade from, or -1 while unsure */
function getLuckyUpgradeSlot() {
  if (!USE_LUCKY_SLOT) return -1;
  const posterior = getLuckySlotPosterior();
  const best = posterior.indexOf(Math.max(...posterior));
  return posterior[best] >= LUCKY_SLOT_USE_CONFIDENCE ? best : -1;
}

/**
 * upgrade(), from the lucky slot when one is known.
 * @param {number} itemSlot
 * @param {number} scrollSlot
 * @param {number} [offeringSlot]
 * @returns {Promise<object>} upgrade()'s result
 */
function upgradeInLuckySlot(itemSlot, scrollSlot, offeringSlot) {
  const luckySlot = getLuckyUpgradeSlot();
  if (
    luckySlot === -1 ||
    luckySlot === itemSlot ||
    isInBank() ||
    character.q.compound ||
    character.items[luckySlot]?.name === "placeholder"
  )
    return upgrade(itemSlot, scrollSlot, offeringSlot);

  const afterSwap = (slot) => (slot === luckySlot ? itemSlot : slot);
  const moved = swap(itemSlot, luckySlot);
  const upgraded = parent.push_deferred("upgrade");
  parent.socket.emit("upgrade", {
    item_num: luckySlot,
    scroll_num: afterSwap(scrollSlot),
    offering_num:
      offeringSlot === undefined ? undefined : afterSwap(offeringSlot),
    clevel: character.items[itemSlot]?.level ?? 0,
  });

  return Promise.all([moved, upgraded]).then(([, result]) => result);
}

function isLuckySlotSettled() {
  return (
    luckySlotTally.found !== null ||
    luckySlotTally.slots.every(
      ({ attempts }) => attempts >= LUCKY_SLOT_MAX_ATTEMPTS,
    )
  );
}

function getLuckySlotExport() {
  const posterior = getLuckySlotPosterior();
  return {
    character: character.name,
    exportedAt: new Date().toISOString(),
    found: luckySlotTally.found,
    model: {
      luckyBend,
      luckyLogLr,
      highBin: LUCKY_SLOT_HIGH_BIN,
      maxAttempts: LUCKY_SLOT_MAX_ATTEMPTS,
      confidence: LUCKY_SLOT_CONFIDENCE,
    },
    slots: luckySlotTally.slots.map((tally, slot) => ({
      slot,
      chance: posterior[slot],
      ...tally,
    })),
  };
}

function luckySlotReport() {
  const { found, slots } = getLuckySlotExport();
  const total = slots.reduce((sum, row) => sum + row.attempts, 0);

  console.log(`Lucky slot: ${found ?? "unknown"}, ${total} rolls counted`);
  console.table(
    slots
      .sort((lhs, rhs) => rhs.chance - lhs.chance)
      .slice(0, 10)
      .map((row) => ({ ...row, chance: `${(row.chance * 100).toFixed(2)}%` })),
  );
}

/** @returns {string} the exports/ path under caracAL, else a browser download's name */
function exportLuckySlotTally() {
  const fileName = `lucky_slot_${character.name}.json`;
  const json = JSON.stringify(getLuckySlotExport(), null, 2);

  if (parent.caracAL) {
    const fs = require("fs");
    const path = `${LUCKY_SLOT_EXPORT_DIR}/${fileName}`;
    fs.mkdirSync(LUCKY_SLOT_EXPORT_DIR, { recursive: true });
    fs.writeFileSync(path, json);
    console.log(`Lucky slot tally exported to ${path}`);
    return path;
  }

  const link = parent.document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([json], { type: "application/json" }),
  );
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
  return fileName;
}

parent.socket.on("q_data", onUpgradeProgress);
parent.socket.on("game_response", (data) => {
  const response = data?.response ?? data;
  if (response === "upgrade_success" || response === "upgrade_fail")
    isRollRecorded = false;
});

/** @returns {number} the server's upgrade duration before mass production */
function getUpgradeDurationMs(item) {
  const newLevel = (item.level ?? 0) + 1;
  const tierMultiplier = [1, 1.5, 2][item_grade({ name: item.name })] ?? 1;
  return 500 * newLevel * Math.sqrt(newLevel) * tierMultiplier;
}

/** @returns {"pp"|"mp"|null} the fastest mass production that still leaks the roll */
function getLeakSafeProduction(item) {
  if (!FIND_LUCKY_SLOT || isLuckySlotSettled()) return "pp";

  const durationMs = getUpgradeDurationMs(item);
  if (durationMs / 20 >= ROLL_LEAK_MIN_MS) return "pp";
  if (durationMs / 2 >= ROLL_LEAK_MIN_MS) return "mp";
  return null;
}

/** @returns {number} the least-rolled slot under its cap, or -1 */
function getNextProbeSlot() {
  let next = -1;
  luckySlotTally.slots.forEach(({ attempts }, slot) => {
    if (attempts >= LUCKY_SLOT_MAX_ATTEMPTS) return;
    if (next === -1 || attempts < luckySlotTally.slots[next].attempts)
      next = slot;
  });
  return next;
}

function isProbeItem(item) {
  return (
    item?.name === LUCKY_SLOT_PROBE_ITEM &&
    !item.l &&
    (item.level ?? 0) < LUCKY_SLOT_PROBE_MAX_LEVEL
  );
}

function findProbeItemSlot(target) {
  if (isProbeItem(character.items[target])) return target;
  return character.items.findIndex(isProbeItem);
}

/** @param {boolean} [all=false] also sell the ones still worth a scroll */
async function sellProbeItems(all = false) {
  const sales = [];
  character.items.forEach((item, slot) => {
    if (item?.name !== LUCKY_SLOT_PROBE_ITEM || item.l) return;
    if (!all && isProbeItem(item)) return;
    sales.push(sell(slot, 1).catch(() => {}));
  });
  await Promise.allSettled(sales);
}

/** One scroll0 on the least-rolled slot; only called when upgradeInv sent nothing */
async function probeLuckySlot() {
  if (!FIND_LUCKY_SLOT || isInBank()) return;
  if (character.q.upgrade || character.q.exchange) return;

  const settled = isLuckySlotSettled();
  if (!settled && character.gold < LUCKY_SLOT_GOLD_FLOOR) return;
  if (!lockInventory("mutate")) return;

  try {
    if (settled) return await sellProbeItems(true);
    return await runLuckySlotProbe();
  } finally {
    unlockInventory("mutate");
  }
}

async function runLuckySlotProbe() {
  const target = getNextProbeSlot();
  if (target === -1) return;

  await sellProbeItems();

  if (findProbeItemSlot(target) === -1) {
    if (!character.esize) return;
    try {
      await buy(LUCKY_SLOT_PROBE_ITEM, 1);
    } catch (e) {
      return;
    }
  }

  if ((await ensureScroll("scroll0", 0)) === -1) return;

  const itemSlot = findProbeItemSlot(target);
  if (itemSlot === -1) return;
  if (itemSlot !== target) {
    try {
      await swap(itemSlot, target);
    } catch (e) {
      return;
    }
  }

  const item = character.items[target];
  const scrollSlot = locate_item("scroll0");
  if (!isProbeItem(item) || scrollSlot === -1 || scrollSlot === target) return;

  const production = getLeakSafeProduction(item);
  if (production) activateMassProduction(production === "pp");

  const result = await upgrade(target, scrollSlot).catch(() => null);
  if (result?.success && result.level >= LUCKY_SLOT_PROBE_MAX_LEVEL)
    await sell(target, 1).catch(() => {});
}
