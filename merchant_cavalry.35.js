// Cavalry: tag level 3+ oneeyes from range, then call the cavalry down on them.

/** Server cavalry rules: range, min_level, max_targets, duration, veteran_range, newcomer_level */
const CAVALRY = G.items.tracker.cavalry;
const CAVALRY_MOB = "oneeye";
const CAVALRY_MAP = "level2w";
/** Centre gap a mob keeps from the merchant while tagging, past veteran_range */
const CAVALRY_TAG_GAP = CAVALRY.veteran_range + 60;
/** Centre gap past veteran_range we keep other high-level players to */
const CAVALRY_GUARD_MARGIN = 20;
/** Furthest a tagged mob may be from us at call time, inside the call range */
const CAVALRY_CALL_REACH = CAVALRY.range - 40;
/** How far we retreat from the call spot, so the pack stays within its range */
const CAVALRY_ORBIT = 100;
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

/** @returns {number} ms until the account may call the cavalry again, 0 when ready or unknown */
function cavalryCooldownMs() {
  return Math.max(0, (get(CAVALRY_LS_KEY) ?? 0) - Date.now());
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
 * Most mobs we could outlast in melee for CAVALRY_MIN_TANK_S, up to the
 * server's target cap.
 * @param {Object[]} candidates - nearest first
 * @returns {number} 0 when not even one
 */
function getCavalryPackSize(candidates) {
  let size = 0;
  const cap = Math.min(CAVALRY.max_targets, candidates.length);

  for (let n = 1; n <= cap; n++) {
    const dps = totalMobDps(candidates.slice(0, n), character);
    if (dps * CAVALRY_MIN_TANK_S > character.hp * CAVALRY_TANK_HP_SHARE) break;
    size = n;
  }

  return size;
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
 * Walks to where the mob sits in reach, CAVALRY_TAG_GAP out.
 * @param {string} mobId
 * @param {number} reach - attack reach, as `distance()` measures it
 */
async function positionForCavalryTag(mobId, reach) {
  let mob = parent.entities[mobId];

  while (mob && !mob.target) {
    assertCavalryAlive();

    const gap = cavalryCentreGap(character, mob);
    if (distance(character, mob) <= reach && gap >= CAVALRY_TAG_GAP) return;

    const standGap = CAVALRY_TAG_GAP + CAVALRY_STEP / 4;
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
 * Tags mobs from range until the pack is full, the first one closes in, or
 * nothing else is in reach.
 * @param {number} packSize
 * @param {number} reach - attack reach, as `distance()` measures it
 * @returns {Promise<Object[]>} the tagged mobs
 */
async function tagCavalryPack(packSize, reach) {
  const deadline = Date.now() + CAVALRY_TAG_WINDOW_MS;
  const shotAt = new Set();

  while (Date.now() < deadline) {
    assertCavalryAlive();

    const tagged = getCavalryTagged();
    if (tagged.length >= packSize) return tagged;
    if (tagged.some((mob) => cavalryCentreGap(character, mob) < CAVALRY_TAG_GAP))
      return tagged;

    if (!isCavalryDisabled() && !is_on_cooldown("attack")) {
      const next = getCavalryCandidates().find(
        (mob) =>
          !shotAt.has(mob.id) &&
          distance(character, mob) <= reach &&
          cavalryCentreGap(character, mob) >= CAVALRY_TAG_GAP &&
          cavalryCentreGap(character, mob) <= CAVALRY_CALL_REACH,
      );

      if (next) {
        shotAt.add(next.id);
        await withTimeout(attack(next), 300).catch(() => {});
      } else if (tagged.length) return tagged;
    }

    await sleep(CAVALRY_TICK);
  }

  return getCavalryTagged();
}

/**
 * Spot one step away that keeps the pack furthest off, within CAVALRY_ORBIT
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
 * Backs off between stones while the cavalry works, for the call's duration.
 * @param {{x: number, y: number}} callSpot
 */
async function holdCavalryFight(callSpot) {
  const until = Date.now() + CAVALRY.duration;

  while (Date.now() < until) {
    assertCavalryAlive();

    const tagged = getCavalryTagged();
    if (!tagged.length) return;
    if (isCavalryInDanger()) throw new Error("Too hurt to hold the pack.");

    if (!isCavalryDisabled() && !character.moving) {
      const step = getCavalryRetreatStep(callSpot, tagged);
      if (step) move(step.x, step.y).catch(() => {});
    }

    await sleep(CAVALRY_TICK);
  }
}

/** One run, from the trip to level2w to the end of the call. */
async function runCavalryOneeye() {
  await ensureDartgun();
  const reach = getAttackWeaponReach();
  assertCavalryAlive();

  await untilDoneOrDead(advanceSmartMove({ map: CAVALRY_MAP }));
  assertCavalryAlive();

  const candidates = getCavalryCandidates();
  const packSize = getCavalryPackSize(candidates);
  if (!packSize) throw new Error("No level 3+ oneeye we could hold.");

  await positionForCavalryTag(candidates[0].id, reach);
  const tagged = await tagCavalryPack(packSize, reach);
  if (!tagged.length) throw new Error("No oneeye took the tag.");

  const callSpot = { x: character.real_x, y: character.real_y };
  const reply = await callCavalry();
  log(`Cavalry on ${tagged.length} oneeye: ${reply.message ?? "coming"}`);

  await holdCavalryFight(callSpot);
}

/** Scheduler, same shape as dragEnt: one run whenever the account cooldown is up. */
async function cavalryOneeyeLoop() {
  if (
    !hasCavalryTracker() ||
    cavalryCooldownMs() > 0 ||
    isOnDuty() ||
    isAwaitingParcel() ||
    isAdvanceSmartMoving ||
    smart.moving ||
    character.rip ||
    shouldGoChilling() ||
    serverCurrentlyHasLiveEvent() ||
    isCaveRunOpen() ||
    isCavalryProbeUnsafe()
  ) {
    setTimeout(
      cavalryOneeyeLoop,
      Math.max(CAVALRY_IDLE_MS, Math.min(cavalryCooldownMs(), CAVALRY_RECHECK_MS)),
    );
    return;
  }

  if (!(await probeCavalryCooldown())) {
    setTimeout(cavalryOneeyeLoop, Math.max(CAVALRY_IDLE_MS, cavalryCooldownMs()));
    return;
  }

  const lock = takeDuty(DUTY.CAVALRY);
  if (!lock) return setTimeout(cavalryOneeyeLoop, CAVALRY_IDLE_MS);
  const keepAlive = setInterval(() => renewDuty(lock), DUTY_WATCHDOG_INTERVAL);

  try {
    await runCavalryOneeye();
  } catch (e) {
    console.warn(`Cavalry run failed: ${e?.message ?? e?.reason ?? e}`);
  } finally {
    clearInterval(keepAlive);
    releaseDuty(lock);
    setTimeout(
      cavalryOneeyeLoop,
      Math.max(CAVALRY_RECHECK_MS, cavalryCooldownMs()),
    );
  }
}
