// Cavalry: tag one level 3+ oneeye from range, then call the cavalry down on it.

/** Server cavalry rules: range, min_level, max_targets, duration, veteran_range, newcomer_level */
const CAVALRY = G.items.tracker.cavalry;
const CAVALRY_MOB = "oneeye";
const CAVALRY_MAP = "level2w";
/** Centre gap past veteran_range we keep other high-level players to */
const CAVALRY_GUARD_MARGIN = 20;
/** Least centre gap we tag from; inside veteran_range we guard the mob ourselves */
const CAVALRY_TAG_GAP = CAVALRY.veteran_range + 30;
/** Centre gap kept after the call, a stone's walk past veteran_range */
const CAVALRY_KITE_GAP =
  CAVALRY.veteran_range +
  (G.monsters[CAVALRY_MOB].speed * G.conditions.stoned.duration) / 1000 +
  CAVALRY_GUARD_MARGIN;
/** Furthest we kite from the call spot */
const CAVALRY_ORBIT = CAVALRY.range - 40;
const CAVALRY_STEP = 60;
/** Longest the tagging may run before the call goes out */
const CAVALRY_TAG_WINDOW_MS = 10_000;
/** Seconds we must outlast the pack in melee: a full stone, then the scare */
const CAVALRY_MIN_TANK_S = (G.conditions.stoned.duration + 1000) / 1000;
/** Share of our hp the pack may take over CAVALRY_MIN_TANK_S */
const CAVALRY_TANK_HP_SHARE = 0.8;
const CAVALRY_ABORT_HP_RATIO = 0.35;
const CAVALRY_REPLY_TIMEOUT = 5_000;
const CAVALRY_TICK = 50;
const CAVALRY_IDLE_MS = 60_000;
/** Wait after a trip that found nothing to tag */
const CAVALRY_RECHECK_MS = 15 * 60 * 1000;
/** Account-wide `Date.now()` the cavalry can be called again, shared by every character */
const CAVALRY_LS_KEY = "cavalryNextCall";
/** Realm -> { checkedAt, mobs: id -> { level, since } } */
const CAVALRY_LEVELS_LS_KEY = "cavalryMobLevels";
/** The mlevel loop's 16s tick plus last_level's +50s jitter */
const CAVALRY_LEVEL_SLACK_MS = 66_000;
const CAVALRY_MAX_WAIT_MS = 60 * 60 * 1000;

/** @returns {number} ms until the account may call the cavalry again, 0 when ready or unknown */
function cavalryCooldownMs() {
  return Math.max(0, (get(CAVALRY_LS_KEY) ?? 0) - Date.now());
}

/**
 * Server mlevel loop: an untargeted mob levels once
 * max(180s, max_hp × 30ms) × 2^((level − 1) × 0.3) has passed since its last level.
 * @returns {number} the longest that wait can be
 */
function msToMobLevelUp(mtype, level) {
  const { hp } = G.monsters[mtype];
  const maxHp = hp + Math.floor(hp / 2) * (level - 1);
  return (
    Math.max(180_000, maxHp * 30) * 2 ** ((level - 1) * 0.3) +
    CAVALRY_LEVEL_SLACK_MS
  );
}

/** Records each cavalry mob in sight and since when it has held its level */
function noteCavalryMobLevels() {
  if (character.map !== CAVALRY_MAP) return;

  const realm = getCurrentServer();
  const now = Date.now();
  const mobs = Object.values(parent.entities).filter(
    (entity) => entity.type === "monster" && entity.mtype === CAVALRY_MOB,
  );
  if (!mobs.length)
    return updateStoreEntry(CAVALRY_LEVELS_LS_KEY, realm, { checkedAt: now });

  const known = readStore(CAVALRY_LEVELS_LS_KEY)[realm]?.mobs ?? {};
  const seen = {};
  for (const mob of mobs) {
    const level = mob.level ?? 1;
    const since = known[mob.id]?.level === level ? known[mob.id].since : now;
    seen[mob.id] = { level, since };
  }

  updateStoreEntry(CAVALRY_LEVELS_LS_KEY, realm, { checkedAt: now, mobs: seen });
}

setInterval(noteCavalryMobLevels, 1000);

/** @returns {number} `Date.now()` by which a mob on this realm is surely min_level, 0 when unknown */
function getCavalryMobReadyAt() {
  const record = readStore(CAVALRY_LEVELS_LS_KEY)[getCurrentServer()];
  if (!record) return 0;

  const readyAts = Object.values(record.mobs ?? {}).map(({ level, since }) => {
    let at = since;
    for (let l = level; l < CAVALRY.min_level; l++)
      at += msToMobLevelUp(CAVALRY_MOB, l);
    return at;
  });
  const readyAt = readyAts.length ? Math.min(...readyAts) : 0;
  return Math.max(readyAt, record.checkedAt + CAVALRY_RECHECK_MS);
}

/** @returns {number} ms until both the cooldown and a ready mob allow a run */
function msUntilCavalryRun() {
  return Math.max(0, cavalryCooldownMs(), getCavalryMobReadyAt() - Date.now());
}

function scheduleCavalryLoop() {
  const waitMs = Math.max(CAVALRY_IDLE_MS, msUntilCavalryRun());
  setTimeout(cavalryOneeyeLoop, Math.min(waitMs, CAVALRY_MAX_WAIT_MS));
}

/** @returns {boolean} whether the bag holds what the server asks for */
function hasCavalryTracker() {
  return locate_item("tracker") !== -1 || locate_item("supercomputer") !== -1;
}

/**
 * The server's cavalry interaction. A reply carrying cooldown_ms, success or
 * "cooldown" alike, is stored under CAVALRY_LS_KEY.
 * @returns {Promise<Object>} the reply; rejects with it when failed
 */
function callCavalry() {
  const requestId = `cavalry${Date.now()}${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const settle = (data) => {
      clearTimeout(timer);
      parent.socket.off("game_response", onResponse);
      if (Number.isFinite(data?.cooldown_ms))
        set(CAVALRY_LS_KEY, Date.now() + data.cooldown_ms);
      if (data?.failed) reject(data);
      else resolve(data);
    };

    const onResponse = (data) => {
      if (data?.request_id === requestId && data.place === "interaction")
        settle(data);
    };

    const timer = setTimeout(
      () => settle({ failed: true, reason: "timeout" }),
      CAVALRY_REPLY_TIMEOUT,
    );
    parent.socket.on("game_response", onResponse);
    parent.socket.emit("interaction", {
      type: "cavalry",
      request_id: requestId,
    });
  });
}

/**
 * Asks the server for the cooldown with nothing to call on: it answers
 * "cooldown" before looking for mobs, else "no_monsters" without starting one.
 * @returns {Promise<boolean>} whether the cavalry is ready; false when the probe became a call
 */
async function probeCavalryCooldown() {
  try {
    await callCavalry();
    return false;
  } catch (reply) {
    return reply?.reason === "no_monsters" || reply?.reason === "guarded";
  }
}

/** @returns {boolean} whether a probe here could turn into a real call */
function isCavalryProbeUnsafe() {
  const ours = new Set([character.name, ...(parent.party_list ?? [])]);
  return Object.values(parent.entities).some(
    (entity) =>
      entity.type === "monster" &&
      ours.has(entity.target) &&
      cavalryCentreGap(character, entity) <= CAVALRY.range + CAVALRY_STEP,
  );
}

/** @returns {number} centre-to-centre px, the way the server measures cavalry ranges */
function cavalryCentreGap(lhs, rhs) {
  return Math.hypot(
    (lhs.real_x ?? lhs.x) - (rhs.real_x ?? rhs.x),
    (lhs.real_y ?? lhs.y) - (rhs.real_y ?? rhs.y),
  );
}

/** @returns {boolean} whether another high-level player stands close enough to guard the mob */
function isCavalryGuardedByOthers(mob) {
  return Object.values(parent.entities).some(
    (entity) =>
      entity.type === "character" &&
      !entity.npc &&
      !entity.rip &&
      entity.name !== character.name &&
      entity.level >= CAVALRY.newcomer_level &&
      cavalryCentreGap(entity, mob) <= CAVALRY.veteran_range + CAVALRY_GUARD_MARGIN,
  );
}

/** @returns {boolean} whether the cavalry would take this mob once it targets us */
function isCavalryMob(mob) {
  return (
    mob.type === "monster" &&
    mob.mtype === CAVALRY_MOB &&
    !mob.dead &&
    (mob.level ?? 1) >= CAVALRY.min_level &&
    !isCavalryGuardedByOthers(mob)
  );
}

/** @returns {Object[]} free mobs worth tagging, nearest first */
function getCavalryCandidates() {
  return Object.values(parent.entities)
    .filter((mob) => isCavalryMob(mob) && !mob.target)
    .sort(
      (lhs, rhs) =>
        cavalryCentreGap(character, lhs) - cavalryCentreGap(character, rhs),
    );
}

/** @returns {Object[]} the cavalry mobs on us */
function getCavalryTagged() {
  return Object.values(parent.entities).filter(
    (mob) => isCavalryMob(mob) && mob.target === character.name,
  );
}

/**
 * @param {Object} mob
 * @returns {boolean} whether we outlast it in melee for CAVALRY_MIN_TANK_S
 */
function canHoldCavalryMob(mob) {
  return (
    totalMobDps([mob], character) * CAVALRY_MIN_TANK_S <=
    character.hp * CAVALRY_TANK_HP_SHARE
  );
}

/**
 * @param {number} reach - from getAttackWeaponReach
 * @returns {boolean} whether it covers CAVALRY_TAG_GAP
 */
function hasCavalryReach(reach) {
  return reach >= CAVALRY_TAG_GAP;
}

/** @returns {boolean} whether we can't move, attack or use skills */
function isCavalryDisabled() {
  return !!(character.s.stoned || character.s.stunned);
}

/** @returns {boolean} whether the pack could kill us through the next stone */
function isCavalryInDanger() {
  return (
    character.hp <
    Math.max(
      character.max_hp * CAVALRY_ABORT_HP_RATIO,
      avgDmgTaken(character) * CAVALRY_MIN_TANK_S,
    )
  );
}

function assertCavalryAlive() {
  if (character.rip) throw new Error("Merchant died mid-cavalry — aborting.");
}

/**
 * Walks to where the mob sits in reach, as far out as it allows.
 * @param {string} mobId
 * @param {number} reach - attack reach, as `distance()` measures it
 */
async function positionForCavalryTag(mobId, reach) {
  let mob = parent.entities[mobId];
  const standGap = Math.min(reach, CAVALRY_KITE_GAP);
  const minGap = Math.max(CAVALRY_TAG_GAP, standGap - CAVALRY_STEP / 4);

  while (mob && !mob.target) {
    assertCavalryAlive();

    const gap = cavalryCentreGap(character, mob);
    if (distance(character, mob) <= reach && gap >= minGap) return;

    const scale = standGap / Math.max(gap, 1);
    const standPoint = {
      x: mob.real_x + (character.real_x - mob.real_x) * scale,
      y: mob.real_y + (character.real_y - mob.real_y) * scale,
    };

    if (cavalryCentreGap(character, standPoint) < 10)
      throw new Error("Attack reach is short of the cavalry tag gap.");

    await untilDoneOrDead(
      move(standPoint.x, standPoint.y).catch(() => smart_move(standPoint)),
    );
    await sleep(CAVALRY_TICK);
    mob = parent.entities[mobId];
  }

  if (!mob) throw new Error("Oneeye disappeared before the tag.");
}

/**
 * Shoots the mob until it targets us.
 * @param {string} mobId
 * @param {number} reach - attack reach, as `distance()` measures it
 * @returns {Promise<Object>} the mob
 */
async function tagCavalryMob(mobId, reach) {
  const deadline = Date.now() + CAVALRY_TAG_WINDOW_MS;

  while (Date.now() < deadline) {
    assertCavalryAlive();

    const mob = parent.entities[mobId];
    if (!mob || !isCavalryMob(mob)) throw new Error("Oneeye lost before the tag.");
    if (mob.target === character.name) return mob;
    if (mob.target) throw new Error("Oneeye took another target.");

    if (!isCavalryDisabled()) {
      if (
        cavalryCentreGap(character, mob) < CAVALRY_TAG_GAP ||
        distance(character, mob) > reach
      )
        await positionForCavalryTag(mobId, reach);
      else if (!is_on_cooldown("attack"))
        await withTimeout(attack(mob), 300).catch(() => {});
    }

    await sleep(CAVALRY_TICK);
  }

  throw new Error("Oneeye never took the tag.");
}

/**
 * Steps away while a mob sits inside `gap`.
 * @param {{x: number, y: number}} anchor - stays within CAVALRY_ORBIT of it
 * @param {Object[]} mobs
 * @param {number} gap - centre gap to keep
 */
function stepAwayFromCavalry(anchor, mobs, gap) {
  if (isCavalryDisabled() || character.moving) return;
  if (mobs.every((mob) => cavalryCentreGap(character, mob) >= gap)) return;

  const step = getCavalryRetreatStep(anchor, mobs);
  if (step) move(step.x, step.y).catch(() => {});
}

/**
 * Backs off past CAVALRY_TAG_GAP.
 * @param {Object} mob
 */
async function clearCavalryCallGap(mob) {
  const anchor = { x: character.real_x, y: character.real_y };
  const deadline = Date.now() + CAVALRY_TAG_WINDOW_MS;

  while (cavalryCentreGap(character, mob) < CAVALRY_TAG_GAP) {
    assertCavalryAlive();
    if (Date.now() > deadline) throw new Error("Couldn't open a gap to call.");
    stepAwayFromCavalry(anchor, [mob], CAVALRY_TAG_GAP);
    await sleep(CAVALRY_TICK);
  }
}

/**
 * Spot one step away that keeps the mobs furthest off, within CAVALRY_ORBIT
 * of the call spot.
 * @param {{x: number, y: number}} callSpot
 * @param {Object[]} mobs
 * @returns {{x: number, y: number}|undefined}
 */
function getCavalryRetreatStep(callSpot, mobs) {
  let best;
  let bestGap = -Infinity;

  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * 2 * Math.PI;
    const spot = {
      x: character.real_x + Math.cos(angle) * CAVALRY_STEP,
      y: character.real_y + Math.sin(angle) * CAVALRY_STEP,
    };
    if (cavalryCentreGap(spot, callSpot) > CAVALRY_ORBIT) continue;
    if (!can_move_to(spot.x, spot.y)) continue;

    const gap = Math.min(...mobs.map((mob) => cavalryCentreGap(spot, mob)));
    if (gap > bestGap) {
      bestGap = gap;
      best = spot;
    }
  }

  return best;
}

/**
 * Kites the mob for the call's duration.
 * @param {{x: number, y: number}} callSpot
 */
async function holdCavalryFight(callSpot) {
  const until = Date.now() + CAVALRY.duration;

  while (Date.now() < until) {
    assertCavalryAlive();

    const tagged = getCavalryTagged();
    if (!tagged.length) return;
    if (isCavalryInDanger()) throw new Error("Too hurt to hold the oneeye.");

    stepAwayFromCavalry(callSpot, tagged, CAVALRY_KITE_GAP);
    await sleep(CAVALRY_TICK);
  }
}

/** One run, from the trip to level2w to the end of the call. */
async function runCavalryOneeye() {
  await ensureDartgun();
  const reach = getAttackWeaponReach();
  if (!hasCavalryReach(reach))
    throw new Error(`Reach ${Math.round(reach)} can't tag past veteran_range.`);
  assertCavalryAlive();

  await untilDoneOrDead(advanceSmartMove({ map: CAVALRY_MAP }));
  assertCavalryAlive();

  const target = getCavalryCandidates().find(canHoldCavalryMob);
  if (!target) throw new Error("No level 3+ oneeye we could hold.");

  await positionForCavalryTag(target.id, reach);
  const mob = await tagCavalryMob(target.id, reach);
  await clearCavalryCallGap(mob);

  const callSpot = { x: character.real_x, y: character.real_y };
  const reply = await callCavalry();
  log(`Cavalry on a level ${mob.level} oneeye: ${reply.message ?? "coming"}`);

  await holdCavalryFight(callSpot);
}

/** Scheduler, same shape as dragEnt: one run once the cooldown is up and a mob is surely ready. */
async function cavalryOneeyeLoop() {
  const knownReach = getAttackWeaponReach();
  if (
    !hasCavalryTracker() ||
    (knownReach && !hasCavalryReach(knownReach)) ||
    msUntilCavalryRun() > 0 ||
    isOnDuty() ||
    isAwaitingParcel() ||
    isAdvanceSmartMoving ||
    smart.moving ||
    character.rip ||
    shouldGoChilling() ||
    serverCurrentlyHasLiveEvent() ||
    isCaveRunOpen() ||
    isCavalryProbeUnsafe() ||
    !(await probeCavalryCooldown())
  )
    return scheduleCavalryLoop();

  const lock = takeDuty(DUTY.CAVALRY);
  if (!lock) return scheduleCavalryLoop();
  const keepAlive = setInterval(() => renewDuty(lock), DUTY_WATCHDOG_INTERVAL);

  try {
    await runCavalryOneeye();
  } catch (e) {
    console.warn(`Cavalry run failed: ${e?.message ?? e?.reason ?? e}`);
  } finally {
    clearInterval(keepAlive);
    releaseDuty(lock);
    scheduleCavalryLoop();
  }
}
