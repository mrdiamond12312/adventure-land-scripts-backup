// Luring: the mecha gnome, and the ent train dragged to the party's farm spot.

var isLuringMobs = false;
var isDraggingMobs = false;

async function lureMechaGnome() {
  let nextDelay = 1000;

  if (
    isLuringMobs ||
    onDuty ||
    isAdvanceSmartMoving ||
    smart.moving ||
    shouldGoChilling() ||
    serverCurrentlyHasLiveEvent() ||
    !isMyMageOnline() ||
    (!(
      parent.party_list &&
      trustedPartners.some((name) => parent.party_list.includes(name))
    ) &&
      !isMyPriestOnline())
  ) {
    return setTimeout(lureMechaGnome, nextDelay);
  }

  try {
    // Global flags to prevent other tasks from interrupting
    onDuty = true;
    isLuringMobs = true; // Prevent scareAwayMobs

    // The flag can't reach smartMove's own scare interval, and `{ map }` with no
    // x/y walks to spawns[0] — i.e. the last leg is *inside* cyberland, where a
    // gnome aggroing us gets shed seconds before the mage magiports
    await advanceSmartMove({ map: "cyberland" }, { useScare: false });
    await sleep(character.ping);

    const gnomesNearby = Object.values(parent.entities).filter(
      (entity) =>
        entity && entity.type === "monster" && entity.mtype === "mechagnome",
    );

    if (gnomesNearby.length < 3) {
      nextDelay = 45_000;
      throw new Error("Gnome not fully spawned");
    } else nextDelay = 110_000;

    const mageResponse = await waitUntil(() => {
      const mageInfo = get("mageLocation");
      if (!mageInfo) return false;
      return (
        mageInfo.mp >= G.skills["magiport"].mp + 100 &&
        Date.now() - mageInfo.time < 15_000 &&
        distance(mageInfo, { map: map, x: mapX, y: mapY }) < 300
      );
    }, 10_000);

    if (!mageResponse) {
      nextDelay = 15_000;
      throw new Error("Mage did not have mana / not online");
    }

    parent.socket.emit("eval", { command: "mooooooh" });
    await advanceSmartMove(get("mageLocation"), { useScare: false });

    await waitUntil(
      () =>
        trustedPartners.some((name) => get_player(name)) ||
        !!get_player(HEALER),
      3_000,
    );

    await waitUntil(() => {
      const partnerNearby =
        trustedPartners.some((name) => get_player(name)) || get_player(HEALER);

      if (!partnerNearby) return true;

      for (const id in parent.entities) {
        const entity = parent.entities[id];
        if (
          entity &&
          entity.mtype === "mechagnome" &&
          entity.target === character.name
        ) {
          return false;
        }
      }

      return true;
    }, 10_000);
  } catch (e) {
    console.error(e);
  } finally {
    isLuringMobs = false;
    onDuty = false;
    setTimeout(lureMechaGnome, nextDelay);
  }
}

//// Ent luring — runs as its own scheduler, same shape as lureMechaGnome above.
// Ents are very tanky and effectively never die while being dragged, so there's
// no dead/alive branching here — the lure either completes or gets aborted on error.
const ENT_LURE_MAP = "desertland";
const ENT_AIM_POINT = { x: -75, y: -1897 };
const ENT_FIRST_ANCHOR = { x: 136, y: -1836 };
const ENT_SCARE_BUFFER = 1.5;
const ENT_TICK = 10;
const ENT_DEATH_POLL = 100;
const MAX_ENT = 3; // party can engage up to this many ents at once near spawn
const MAX_CONCURRENT_ENT = 2; // ents dragged at once in a single run
const SOLO_MAX_ENT = 1; // both caps, while no trusted partner tanks with us
// px around the avg distance of the dragged ents; 999 = effectively off, drop
// it back to ~10 if a staggered pack outruns the scare cooldown
const ENT_PICKUP_TOLERANCE = 999;

function getEntLureDestination() {
  return { x: mapX, y: mapY, map: ENT_LURE_MAP };
}

function getEntWaypoints() {
  return [
    ENT_FIRST_ANCHOR,
    { x: 196, y: -1641 },
    { x: 199, y: -1125 },
    { x: 85, y: -1035 },
    { x: -187, y: -620 },
    { x: -496, y: -620 },
    { x: -829, y: -266 },
    getEntLureDestination(),
  ];
}

/**
 * Whether a trusted partner is standing at the farm spot with the reporter — a
 * partner in the party list but somewhere else isn't tanking anything for us.
 * A stale report reads as no partner, so the caps fall back to the solo ones.
 * @returns {boolean}
 */
function isTrustedPartnerAtSpawn() {
  const report = get("entFieldReport");
  if (!report || Date.now() - report.time >= ENT_FIELD_STALE_MS) return false;

  return !!report.trustedPartnerNearby;
}

/** @returns {number} ents the party may hold at the farm spot */
function getMaxEntAtSpawn() {
  return isTrustedPartnerAtSpawn() ? MAX_ENT : SOLO_MAX_ENT;
}

/** @returns {number} ents one run may drag at once */
function getMaxConcurrentEnt() {
  return isTrustedPartnerAtSpawn() ? MAX_CONCURRENT_ENT : SOLO_MAX_ENT;
}

// Whoever is standing at the farm spot reports how many ents are already
// engaged with the party there (publishEntFieldReport in basic_function.7.js) —
// avoids luring past the current cap of concurrent ents at home.
function hasMaxEntsEngagedAtSpawn() {
  const report = get("entFieldReport");

  // No fresh report means nobody is watching the field: assume it is full
  // rather than luring blind.
  if (!report || Date.now() - report.time >= ENT_FIELD_STALE_MS) return true;

  return report.entsTargetingPartyCount >= getMaxEntAtSpawn();
}

async function ensureDartgun() {
  if (findMaxLevelItem(ATTACK_WEAPON) === -1) {
    await retrieveBankItem(ATTACK_WEAPON);
  }
  if (!getBestQuiver()) await retrieveBankItem(ATTACK_OFFHAND);

  await withTimeout(
    equipBatch(calculateMerchantEquipments()),
    Math.max(300, character.ping),
  );
}

/**
 * Furthest untargeted ent from ENT_FIRST_ANCHOR.
 * @returns {object|undefined}
 */
function getFurthestEntFromFirstAnchor() {
  let furthest;
  let furthestDistance = -1;

  for (const id in parent.entities) {
    const entity = parent.entities[id];
    if (!entity || entity.type !== "monster" || entity.mtype !== "ent")
      continue;
    if (entity.target && entity.target !== character.name) continue;

    const d = distance(ENT_FIRST_ANCHOR, entity);
    if (d > furthestDistance) {
      furthestDistance = d;
      furthest = entity;
    }
  }

  return furthest;
}

/**
 * Aborts the run when it can no longer make progress. Every ent-lure loop polls
 * this so none of them can spin forever holding the duty locks — a dead
 * merchant never reaches its stand point and never gets an ent to target it.
 */
function assertEntLureAlive() {
  if (character.rip) throw new Error("Merchant died mid-lure — aborting.");
  if (!isMyPriestOnline())
    throw new Error("Priest went offline mid-lure — aborting.");
}

/**
 * Settles as soon as `promise` does or the merchant dies — no time limit, a
 * single move can take anywhere from seconds to minutes. For travel calls that
 * have no internal death check and would otherwise never settle once we're a
 * corpse, which would stop the caller's guards from ever running again.
 * @param {Promise} promise
 */
function untilDoneOrDead(promise) {
  let done = false;
  const tracked = promise.then(
    (value) => {
      done = true;
      return value;
    },
    (e) => {
      done = true;
      throw e;
    },
  );
  tracked.catch(() => {}); // may be abandoned below; keep the rejection handled

  return Promise.race([
    tracked,
    new Promise((resolve) => {
      const poll = () =>
        done || character.rip ? resolve() : setTimeout(poll, ENT_DEATH_POLL);
      poll();
    }),
  ]);
}

async function positionAtEntAimPoint(entId, dartgunRange) {
  let ent = parent.entities[entId];

  // Re-derive the stand point every tick (not just once) since the ent can drift
  // before we're in position, and keep retrying until we're actually there.
  while (ent) {
    assertEntLureAlive();

    const dx = ENT_AIM_POINT.x - ent.x;
    const dy = ENT_AIM_POINT.y - ent.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) break;

    const standPoint = {
      x: ent.x + (dx / len) * dartgunRange,
      y: ent.y + (dy / len) * dartgunRange,
    };

    if (distance(character, standPoint) < 20) break;

    await untilDoneOrDead(
      move(standPoint.x, standPoint.y).catch(() => smart_move(standPoint)),
    );
    await sleep(ENT_TICK);
    ent = parent.entities[entId];
  }

  if (!ent)
    throw new Error("Ent disappeared before positioning — lure aborted.");
}

async function aggroEnt(entId, dartgunRange) {
  let ent = parent.entities[entId];
  while (ent && ent.target !== character.name) {
    assertEntLureAlive();

    const d = distance(character, ent);
    if (!is_on_cooldown("attack") && d <= dartgunRange) {
      await withTimeout(
        attack(ent).catch(() => {}),
        300,
      );
    } else if (d > dartgunRange) {
      await untilDoneOrDead(
        move(
          character.x + (ent.x - character.x) * 0.2,
          character.y + (ent.y - character.y) * 0.2,
        ).catch(() => {}),
      );
    }
    await sleep(ENT_TICK);
    ent = parent.entities[entId];
  }

  if (!ent) throw new Error("Ent disappeared before aggro — lure aborted.");
}

/**
 * @param {number} d distance to the ent
 * @returns {boolean} whether the ent sits in the band where a shot re-aggros it
 */
function isInEntAggroBand(d) {
  return (
    d <= character.range + character.xrange * 0.85 &&
    d > character.range * 0.875
  );
}

/**
 * Untargeted ent in the aggro band, level with the ones already dragged, and
 * behind us relative to the leg we are walking — an ent nearer the waypoint
 * than we are sits on the path we are about to take.
 * @param {string[]} entIds ids already in the drag
 * @param {number} avgDistance mean distance from us to the dragged ents
 * @param {{x: number, y: number}} waypoint the leg currently being walked
 * @returns {object|undefined} the candidate furthest from the waypoint
 */
function getEntToPickUp(entIds, avgDistance, waypoint) {
  const ourDistanceToWaypoint = distance(character, waypoint);
  const candidates = [];

  for (const id in parent.entities) {
    const entity = parent.entities[id];
    if (!entity || entity.type !== "monster" || entity.mtype !== "ent")
      continue;
    if (entity.target || entIds.includes(entity.id)) continue;

    const d = distance(character, entity);
    if (!isInEntAggroBand(d)) continue;
    if (Math.abs(d - avgDistance) > ENT_PICKUP_TOLERANCE) continue;
    if (distance(entity, waypoint) < ourDistanceToWaypoint) continue;

    candidates.push(entity);
  }

  return candidates.sort(
    (lhs, rhs) => distance(rhs, waypoint) - distance(lhs, waypoint),
  )[0];
}

async function walkEntsToSpawn(entIds) {
  let arrived = false;
  let aborted = false;
  let currentWaypoint = getEntWaypoints()[0];

  // Runs concurrently with the step loop below; checks `aborted` before each leg
  // so it stops issuing move() calls once the lure ends instead of continuing to
  // walk stale waypoints in the background.
  const walkPromise = (async () => {
    for (const { x: nextX, y: nextY } of getEntWaypoints()) {
      if (aborted) return;
      currentWaypoint = { x: nextX, y: nextY };
      await move(nextX, nextY).catch((e) => {
        console.warn("move failed", nextX, nextY, e);
        throw e;
      });
    }
    arrived = true;
  })().catch(() => {});

  let handoffDeadline;

  try {
    await new Promise((resolve, reject) => {
      // The reschedule is the last statement, so anything that throws above it
      // would leave this promise unsettled — reject instead of hanging.
      const step = async () => {
        try {
          const ents = entIds
            .map((id) => parent.entities[id])
            .filter((ent) => !!ent);
          if (!ents.length) return resolve();

          // Someone else holds every ent — the drag is over wherever we are, no
          // reason to keep walking the rest of the path
          const handedOff = ents.every(
            (ent) => ent.target && ent.target !== character.name,
          );
          if (handedOff) return resolve();

          if (arrived) {
            // At the end of dragging path, hold the aggro if no one pick up the aggro yet
            // for up to 10 seconds
            handoffDeadline ??= Date.now() + 10_000;
            if (Date.now() > handoffDeadline) return resolve();
          }
          assertEntLureAlive();

          const distances = ents.map((ent) => distance(character, ent));
          if (
            distances.some(
              (d) => d < G.monsters.ent.range * ENT_SCARE_BUFFER,
            ) &&
            !ms_to_next_skill("scare")
          ) {
            await scareAwayMobs();
          }

          if (!is_on_cooldown("attack")) {
            const avgDistance =
              distances.reduce((sum, d) => sum + d, 0) / distances.length;

            // Slipped aggro first, then top the train up to the current cap.
            const target =
              ents.find(
                (ent, i) => !ent.target && isInEntAggroBand(distances[i]),
              ) ||
              (ents.length < getMaxConcurrentEnt() &&
                getEntToPickUp(entIds, avgDistance, currentWaypoint));

            if (target) {
              await withTimeout(attack(target), 300).catch(() => {});
              if (!entIds.includes(target.id)) entIds.push(target.id);
            }
          }
        } catch (e) {
          return reject(e);
        }

        setTimeout(step, ENT_TICK);
      };
      step();
    });
  } finally {
    // `aborted` is only read between legs, so halt the one in flight too —
    // otherwise the merchant keeps walking to the next waypoint after the drag
    // has already ended
    aborted = true;
    stop("move");
  }
}

/** One lure run, from gearing up to handing the train over at the farm spot. */
async function runEntLure() {
  await ensureDartgun();
  const dartgunRange = getAttackWeaponReach();
  assertEntLureAlive();

  // await advanceSmartMove({ ...ENT_FIRST_ANCHOR, map: ENT_LURE_MAP });
  await untilDoneOrDead(advanceSmartMove("ent"));
  assertEntLureAlive();

  const ent = getFurthestEntFromFirstAnchor();
  if (!ent) throw new Error("No Ent found!");

  await positionAtEntAimPoint(ent.id, dartgunRange);
  await aggroEnt(ent.id, dartgunRange);
  await walkEntsToSpawn([ent.id]);
}

async function dragEnt() {
  let nextDelay = 10_000;

  try {
    if (
      map !== ENT_LURE_MAP ||
      isLuringMobs ||
      onDuty ||
      isAdvanceSmartMoving ||
      smart.moving ||
      shouldGoChilling() ||
      serverCurrentlyHasLiveEvent() ||
      !isMyPriestOnline() ||
      hasMaxEntsEngagedAtSpawn()
    ) {
      return;
    }

    onDuty = true;
    isLuringMobs = true;
    isDraggingMobs = true;
    // Tell the rest of the party we're actively dragging this in — see
    // getMonstersOnDeclares() in basic_function.7.js, which skips declaring it
    // as a farm target while it's still being walked in from elsewhere.
    set("luringMobType", "ent");

    await runEntLure();

    nextDelay = 15_000; // lured successfully, give it a while before going again
  } catch (e) {
    console.warn(`Ent lure failed: ${e.message}`);
    nextDelay = 15_000;
  } finally {
    isDraggingMobs = false;
    isLuringMobs = false;
    onDuty = false;
    set("luringMobType", undefined);
    setTimeout(dragEnt, nextDelay);
  }
}
