// Hunting scouted special mobs, ahead of ordinary farming.

/**
 * Mobs worth breaking off the farming spot for. Mirrors MINI_BOSSES_TO_SCOUT in
 * merchant_scout.29.js, which is what fills the reports read below — the two
 * live in separate load graphs, so they are kept in step by hand.
 */
const SPECIAL_MOBS_TO_HUNT = [
  "skeletor",
  "mvampire",
  "fvampire",
  "stompy",
  "goldenbat",
  "phoenix",
];

/** A sighting older than this is not worth the walk */
const SPECIAL_MOB_SIGHTING_TTL_MS = 5 * 60 * 1000;

/** Standing this close to a reported spot counts as having checked it */
const SPECIAL_MOB_ARRIVAL_SLACK = 200;

/**
 * The scout's reports, written by merchant_scout.29.js.
 * @returns {Object<string, {seenAt?: number, seenSpot?: {map: string, x: number, y: number}}>}
 */
function getScoutReports() {
  return get(SCOUT_LS_KEY) ?? {};
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
        SPECIAL_MOBS_TO_HUNT.includes(entity.mtype),
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

  for (const mtype of SPECIAL_MOBS_TO_HUNT) {
    const report = reports[mtype];

    if (!report?.seenAt || !report.seenSpot) continue;
    if (Date.now() - report.seenAt > SPECIAL_MOB_SIGHTING_TTL_MS) continue;
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
  const reports = getScoutReports();
  if (!reports[mtype]) return;

  delete reports[mtype].seenAt;
  delete reports[mtype].seenSpot;
  set(SCOUT_LS_KEY, reports);
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
  changeToNormalStrategies();
  advanceSmartMove(sighting);

  return travelling();
}
