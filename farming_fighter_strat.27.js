// Farming the configured spot — the fighter's fallback strategy.

// Entry scripts farm their own spot / their own mobs by assigning these
var ownMap, ownMapX, ownMapY, ownTargets;

const FARM_SPOT_SLACK = 500;

// How long the field has to stay quiet before the walk home is worth it
const FARM_REGROUP_IDLE_MS = 5000;

let lastEngagementAt = Date.now();

/** @returns {{map: string, x: number, y: number}} the spot this character farms */
function getFarmSpot() {
  return {
    map: ownMap ?? map,
    x: ownMapX ?? mapX,
    y: ownMapY ?? mapY,
  };
}

/**
 * First mob of this character's own shortlist that is in sight.
 * @returns {object|undefined}
 */
function getOwnTarget() {
  for (const mtype of ownTargets ?? []) {
    const instance = get_nearest_monster({ type: mtype });
    if (instance) return instance;
  }

  return undefined;
}

/**
 * Whatever the party is already on, then this character's own shortlist.
 * @returns {object|undefined}
 */
function getFarmTarget() {
  return getTarget() ?? getOwnTarget();
}

/**
 * Whether this is one of the mobs we came out to farm.
 * @param {object} target
 * @returns {boolean}
 */
function isFarmMob(target) {
  return (
    mobsToFarm.includes(target.mtype) ||
    (ownTargets ?? []).includes(target.mtype)
  );
}

/**
 * Whether anything in vision still holds one of us.
 * @returns {boolean}
 */
function isPartyEngaged() {
  const allies = getAlliedNames();

  return Object.values(parent.entities).some(
    (entity) =>
      entity.type === "monster" && entity.target && allies.has(entity.target),
  );
}

/**
 * Pulls only while a healthy tanker and a healer are up to hold what we pull.
 */
function adaptStrategyToParty() {
  const thirdPartyHealerId = parent.party_list.find((id) => {
    const player = get_player(id);
    return !partyMems.includes(id) && player?.ctype === "priest";
  });
  const partyHealer =
    get_entity(HEALER) ||
    (thirdPartyHealerId && get_player(thirdPartyHealerId)) ||
    undefined;
  const partyTanker = get_entity(TANKER);

  if (
    partyTanker &&
    partyTanker.hp > partyTanker.max_hp * 0.35 &&
    partyHealer &&
    !partyHealer.rip &&
    character.ping < 600 &&
    (get_targeted_monster()?.level < 5 || get_target()?.attack < 500)
  )
    changeToPullStrategies();
  else changeToNormalStrategies();
}

/**
 * Fights what stands on the farming spot, and heads back as soon as nothing off
 * it is worth farming — followers only regroup after drifting off the spot.
 * @returns {Promise<object|undefined>} the farming outcome, if it owns this tick
 */
async function useFarmingStrategy() {
  adaptStrategyToParty();

  const farmSpot = getFarmSpot();
  const hasDrifted = distance(character, farmSpot) > FARM_SPOT_SLACK;
  const target = getFarmTarget();

  // Off the spot only what we came for holds us — a dead event leaves a field
  // full of mobs that would otherwise be farmed in place of the spot
  if (target && (!hasDrifted || isFarmMob(target))) {
    lastEngagementAt = Date.now();
    return engage(target);
  }

  if (smart.moving || isAdvanceSmartMoving) return travelling();

  // On the spot a mob that just died leaves an empty tick, and the walk it
  // would start cannot be taken back
  if (!hasDrifted) {
    if (isPartyEngaged()) lastEngagementAt = Date.now();
    if (Date.now() - lastEngagementAt < FARM_REGROUP_IDLE_MS)
      return travelling();
  }

  const isPartyLeaderOrAlone =
    partyMems[0] === character.name || !get_entity(partyMems[0]);

  if (!isPartyLeaderOrAlone && !hasDrifted) return undefined;

  log("Moving to farming location");
  changeToNormalStrategies();
  advanceSmartMove(farmSpot);

  return travelling();
}
