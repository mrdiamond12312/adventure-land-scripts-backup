/**
 * A spawn midpoint, as returned by getMonsterSpawns
 * @typedef {{ map: string, x: number, y: number }} SpawnSpot
 */

/**
 * A mini-boss the scout looking for
 * @typedef {object} ScoutTarget
 * @property {SpawnSpot[]} [spotsToCheck] spawn to check for
 * @property {boolean} [goServerhopping=false] scout via realm socket and force a serverhopping - havent implemented
 * @property {boolean} [useTeleportation] allow town-scroll hops between spots
 */

/**
 * What the scout has learned about one mini-boss.
 * @typedef {object} ScoutReport
 * @property {number} [seenAt] Date.now() of the last sighting
 * @property {SpawnSpot} [seenSpot] where it was last seen
 * @property {number} [checkedAt] Date.now() of the last visit to a spot
 * @property {number} [respawnEta] Date.now() plus the longest surge timer
 * @property {string} [target] who it was last seen fighting
 */

/**
 * Mini-bosses the scout sweeps, keyed by monster id
 * @satisfies {Record<string, ScoutTarget>}
 */
const MINI_BOSSES_TO_SCOUT = {
  skeletor: {
    spotsToCheck: getMonsterSpawns("skeletor"),
    useTeleportation: true,
  },
  mvampire: {
    spotsToCheck: getMonsterSpawns("mvampire"),
    useTeleportation: false, // Moving on his bare foot to check for goldenbat
  },
  goldenbat: {
    spotsToCheck: undefined,
    useTeleportation: true,
  },
  phoenix: {
    spotsToCheck: undefined,
    useTeleportation: true,
  },
  fvampire: {
    spotsToCheck: getMonsterSpawns("fvampire"),
    useTeleportation: true,
  },
  stompy: {
    spotsToCheck: getMonsterSpawns("stompy"),
    useTeleportation: true,
  },
  cutebee: {
    spotsToCheck: [
      ...getMonsterSpawns("crab"),
      ...getMonsterSpawns("crabx"),
      ...getMonsterSpawns("hawk"),
    ],
    useTeleportation: false,
  },
  goldenbot: {
    spotsToCheck: getMonsterSpawns("sparkbot"),
    useTeleportation: true,
  },
};

const SCOUT_CONFIG = {
  MINI_BOSSES_TO_SCOUT,
  MINI_BOSSES_KEYS: /** @type {(keyof typeof MINI_BOSSES_TO_SCOUT)[]} */ (
    Object.keys(MINI_BOSSES_TO_SCOUT)
  ),
  NEXT_TICK: 15 * 60 * 1000,
  FAIL_TIMEOUT: 6 * 60 * 1000,
  REJECT_TIMEOUT: 15 * 1000,
};

/**
 * Update Scout info to localStorage, merging into whatever is already stored
 * @param {keyof typeof MINI_BOSSES_TO_SCOUT} mobId - the mob to update
 * @param {ScoutReport} mobData - the info of its wherabouts
 */
function updateScoutInfo(mobId, mobData) {
  updateStoreEntry(SCOUT_LS_KEY, mobId, mobData);
}

/**
 * Sweeping around for information, used within a scheduler/loop
 */
async function scoutSweep() {
  const mobsNearby = Object.values(parent.entities).filter(
    (entity) => entity.type === "monster",
  );
  for (const mob of mobsNearby) {
    if (!(mob.mtype in MINI_BOSSES_TO_SCOUT)) continue;

    updateScoutInfo(mob.mtype, {
      seenAt: Date.now(),
      seenSpot: { map: character.map, x: mob.real_x, y: mob.real_y },
      target: mob.target,
    });
  }
}

async function merchantScoutingLoop() {
  if (
    // The startup bank walk builds ITEMS_HIGHEST_LEVEL and fetches our gear;
    // a sweep taken before it lands would hold the duty right through it
    !hasVisitedBank ||
    onDuty ||
    isAdvanceSmartMoving ||
    smart.moving ||
    shouldGoChilling() ||
    serverCurrentlyHasLiveEvent()
  ) {
    setTimeout(merchantScoutingLoop, SCOUT_CONFIG.REJECT_TIMEOUT);
    return;
  }

  let nextDelay = SCOUT_CONFIG.NEXT_TICK;

  onDuty = true;
  // A full sweep outlasts DUTY_STALE_MS, so the watchdog needs telling
  const scoutSweepInterval = setInterval(() => {
    renewDuty();
    scoutSweep();
  }, 500);

  try {
    // Moving around spots to sweep to mini bosses
    // The priority is currently following the order defined in the config
    for (const miniBossKey of SCOUT_CONFIG.MINI_BOSSES_KEYS) {
      const miniBossConfig = MINI_BOSSES_TO_SCOUT[miniBossKey];
      if (!miniBossConfig.spotsToCheck) continue;
      for (const spotToCheck of miniBossConfig.spotsToCheck) {
        await advanceSmartMove(spotToCheck, {
          useTown: miniBossConfig.useTeleportation,
          speed: miniBossConfig.useTeleportation ? character.speed : 250, // prevent town
        });

        updateScoutInfo(miniBossKey, { checkedAt: Date.now() });

        // Trash sharing the spawn area respawns far faster, so the longest
        // timer is the mini-boss we came for
        const times = await useTemporalSurge();
        if (times && times.length) {
          updateScoutInfo(miniBossKey, {
            respawnEta: Date.now() + Math.max(...times),
          });
        }
      }
    }
  } catch (e) {
    console.warn(`Scout Routine is postponed`, e);
    nextDelay = SCOUT_CONFIG.FAIL_TIMEOUT;
  } finally {
    onDuty = false;
    clearInterval(scoutSweepInterval);
    setTimeout(merchantScoutingLoop, nextDelay);
  }
}
