// Hunting scouted special mobs, ahead of ordinary farming.

/** A sighting older than this is not worth the walk */
const SPECIAL_MOB_SIGHTING_TTL_MS = 5 * 60 * 1000;

/**
 * respawnEta is published straight from the surge response, which carries the
 * server's own remainder — this only covers the walk and the message round trip.
 */
const SPECIAL_MOB_RESPAWN_PADDING_MS = 30 * 1000;

/** Standing this close to a reported spot counts as having checked it */
const SPECIAL_MOB_ARRIVAL_SLACK = 200;

/**
 * The scout's reports, written by merchant_scout.29.js.
 * @returns {Object<string, {seenAt?: number, seenSpot?: {map: string, x: number, y: number}}>}
 */
function getScoutReports() {
  return readStore(SCOUT_LS_KEY);
}

/**
 * Whether someone outside our own crew already holds it — their kill, not ours.
 * One that turned on us is ours to finish regardless of who started it.
 * @param {string} [target]
 * @returns {boolean}
 */
function isTakenBySomeoneElse(target) {
  return !!target && !getAlliedNames().has(target);
}

/**
 * Nearest huntable mob already in sight, so a walk is never started for one we
 * could be hitting right now.
 * @returns {object|undefined}
 */
function getSpecialMobInVision() {
  return Object.values(parent.entities)
    .filter(
      (entity) =>
        entity.type === "monster" &&
        !entity.dead &&
        SPECIAL_MOB_IDS.includes(entity.mtype) &&
        !isTakenBySomeoneElse(entity.target),
    )
    .sort((lhs, rhs) => distance(character, lhs) - distance(character, rhs))[0];
}

/**
 * Freshest scouted sighting still worth walking to.
 * @returns {{mtype: string, map: string, x: number, y: number, seenAt: number}|undefined}
 */
function getSpecialMobSighting() {
  const reports = getScoutReports();
  let best;

  for (const mtype of SPECIAL_MOB_IDS) {
    const report = reports[mtype];

    if (!report?.seenAt || !report.seenSpot) continue;
    if (Date.now() - report.seenAt > SPECIAL_MOB_SIGHTING_TTL_MS) continue;
    if (isTakenBySomeoneElse(report.target)) continue;

    // A respawnEta only means anything while it is the newer of the two: seeing
    // it alive since the scout surged its corpse settles the question
    // Roamers have no timed respawn, so a stale eta must not hold them back
    const isDownUntil =
      G.monsters[mtype]?.respawn > 0 &&
      report.respawnEta &&
      report.seenAt <= (report.checkedAt ?? 0);
    if (
      isDownUntil &&
      Date.now() < report.respawnEta + SPECIAL_MOB_RESPAWN_PADDING_MS
    )
      continue;
    if (best && report.seenAt <= best.seenAt) continue;

    best = { mtype, seenAt: report.seenAt, ...report.seenSpot };
  }

  return best;
}

/**
 * Drops a sighting we walked to and found nothing at, so the next tick moves on
 * to the next report instead of pacing the same spot.
 * @param {string} mtype
 */
function forgetSpecialMobSighting(mtype) {
  updateStoreEntry(SCOUT_LS_KEY, mtype, {
    seenAt: undefined,
    seenSpot: undefined,
  });
}

/**
 * Hits a special mob in sight, otherwise walks to the freshest scouted one.
 * @returns {Promise<object|undefined>} the outcome, if it owns this tick
 */
async function useSpecialMobStrategy() {
  // Anything already in sight beats walking, including one found mid-trip
  const inVision = getSpecialMobInVision();
  if (inVision) return engage(inVision);

  if (smart.moving || isAdvanceSmartMoving) return travelling();

  const sighting = getSpecialMobSighting();
  if (!sighting) return undefined;

  // Standing on the spot with nothing in sight means the report is spent
  if (distance(character, sighting) <= SPECIAL_MOB_ARRIVAL_SLACK) {
    forgetSpecialMobSighting(sighting.mtype);
    return undefined;
  }

  log(`Hunting ${sighting.mtype}`);
  adaptStrategyToParty();
  advanceSmartMove(sighting);

  return travelling();
}
