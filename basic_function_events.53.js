// basic_function part: live events, rogue and ent-field deploys, boss ranking, crabxx, anniversary, Witch's Cipher, trick-or-treat

const PARTICIPATABLE_EVENTS = [
  "horseman",
  "graveyard",
  "icegolem",
  "franky",
  "mrpumpkin",
  "mrgreen",
  "crabxx",
  "dragold",
  "wabbit",
  "snowman",
  "pinkgoo",
  "goobrawl",
  "abtesting",
];

function serverCurrentlyHasLiveEvent() {
  return PARTICIPATABLE_EVENTS.some(
    (eventName) => server.status[eventName]?.live,
  );
}

/**
 * Whether a cave run is still open somewhere in the party. The deadline is
 * published by cave_fighter_strat.15.js, which the merchant never loads.
 * @returns {boolean}
 */
function isCaveRunOpen() {
  return get("caveRun") > Date.now();
}

/** @returns {boolean} whether gathering for or inside a cave run */
function isCaveUnderway() {
  return isCaveRunOpen() || get(CAVE_GATHERING_LS_KEY) > Date.now();
}

const RSPEED_DURATION = G.conditions["rspeed"].duration;
const RSPEED_MARGIN = 0.75 * 60 * 1000; // 45 seconds

const setRogueSpeedLastDeployment = () => {
  const last = get("rogueLastDeployed");
  const lastDate = last ? new Date(last) : null;

  // If we recently deployed (still inside rspeed - margin), DO NOT overwrite
  if (lastDate && mssince(lastDate) < RSPEED_DURATION - RSPEED_MARGIN) {
    return; // Too early to overwrite
  }

  // Otherwise update the timestamp
  set("rogueLastDeployed", new Date());
};

const ENT_FIELD_MAX_FOR_ROGUE = 2;
const ENT_FIELD_STALE_MS = 15 * 1000;
const ENT_FIELD_REPORT_RANGE = 500;
const ENT_FIELD_AGGRO_RANGE = 300;
const ENT_FIELD_PARTNER_RANGE = 400;

/**
 * Publishes how many ents are engaged with the party at the farm spot, plus
 * whether a trusted partner is standing with us, for the merchant's lure gate
 * and the rogue swap. Called from the watchers' mainLoop so the count stays
 * live; any class can report, not just the mage.
 */
function publishEntFieldReport() {
  if (isMerchant()) return;

  const farmSpot = { x: mapX, y: mapY, map };
  if (
    character.map !== map ||
    distance(character, farmSpot) > ENT_FIELD_REPORT_RANGE
  )
    return;

  const partyNames = getAlliedNames();
  const entsTargetingPartyCount = Object.values(parent.entities).filter(
    (entity) =>
      entity &&
      entity.type === "monster" &&
      entity.mtype === "ent" &&
      entity.target &&
      partyNames.has(entity.target) &&
      distance(entity, farmSpot) < ENT_FIELD_AGGRO_RANGE,
  ).length;

  const trustedPartnerNearby = trustedPartners.some((name) => {
    const partner = get_player(name);
    return (
      partner &&
      !partner.rip &&
      distance(character, partner) < ENT_FIELD_PARTNER_RANGE
    );
  });

  set("entFieldReport", {
    reporter: character.name,
    entsTargetingPartyCount,
    trustedPartnerNearby,
    time: Date.now(),
  });
}

const shouldDeployRogue = () => {
  // Check if it's safe to deploy rogue in place of the priest while farming ents
  const entField = get("entFieldReport");
  if (
    !entField ||
    mssince(new Date(entField.time)) > ENT_FIELD_STALE_MS ||
    entField.entsTargetingPartyCount > ENT_FIELD_MAX_FOR_ROGUE
  ) {
    return false;
  }

  const last = get("rogueLastDeployed");
  const lastDate = last ? new Date(last) : null;

  // If never deployed before → SHOULD deploy
  if (!lastDate) return true;

  // Deploy if enough time has passed
  return (
    mssince(lastDate) > RSPEED_DURATION - RSPEED_MARGIN ||
    mssince(lastDate) < RSPEED_MARGIN
  );
};

/** Bosses useEventStrategy fights lowest hp fraction first */
const HP_RANKED_BOSSES = [
  "icegolem",
  "franky",
  "dragold",
  "mrpumpkin",
  "mrgreen",
];

/** @returns {string[]} the live ones of `names` in `status`, least hp fraction first */
function rankLiveBossesByHp(names = HP_RANKED_BOSSES, status = server.status) {
  const hpFraction = (name) => {
    const { hp, max_hp = G.monsters[name].hp } = status[name];
    return (hp ?? max_hp) / max_hp;
  };

  return names
    .filter((name) => status[name]?.live)
    .sort((lhs, rhs) => hpFraction(lhs) - hpFraction(rhs));
}

// Crabxx helper
const getCrabsForCrabxx = () => {
  const entities = Object.values(parent.entities);
  const crabxList = [];
  let crabxxInstance;

  for (const entity of entities) {
    if (!entity || entity.rip) continue;

    if (entity.mtype === "crabxx" && !crabxxInstance) {
      crabxxInstance = entity;
    }

    const incomingNumber = projectileManager?.getIncomingNumber(entity.id) ?? 0;

    const predictedHp =
      entity.name === character.name ? entity.hp : entity.hp + incomingNumber;
    entity.predictedHp = predictedHp;

    // A crabx the shots in the air already kill is gone
    if (entity.mtype === "crabx" && predictedHp > 0) {
      crabxList.push(entity);
    }
  }
  return { crabxxInstance, crabxList };
};

// Anniversary: stop short of the kiss range, so drift still lands it
const ANNIVERSARY_ARRIVAL_SLACK = 0.8;

// Close enough to the announced spot to call the host gone
const ANNIVERSARY_SEARCH_RADIUS = 200;

const ANNIVERSARY_RETRY_MS = 500;

/**
 * The live anniversary round, or undefined.
 * @returns {Object|undefined}
 */
function getAnniversaryEvent() {
  const state = server.status.anniversary;
  if (!state?.active || !state.live || !state.id) return undefined;

  return Date.now() < state.expires ? state : undefined;
}

/**
 * Whether our Anniversary Visit is still unspent for this round.
 * @returns {boolean}
 */
function canAnniversaryVisit() {
  const state = getAnniversaryEvent();
  const ticket = character.s.anniversary_visit;

  return !!(
    state &&
    ticket &&
    ticket.ms > 0 &&
    ticket.round === state.round &&
    ticket.realm === `${server.region} ${server.id}` &&
    Date.now() < ticket.expires
  );
}

/**
 * Whether there is a featured player we still owe a visit.
 * @returns {boolean}
 */
function hasAnniversaryVisitToMake() {
  const state = getAnniversaryEvent();

  return !!(
    state &&
    state.available !== false &&
    state.id !== character.name &&
    canAnniversaryVisit()
  );
}

/**
 * Chases the featured player until the kiss lands or the ticket runs out.
 * @returns {Promise<boolean>} whether the trip owned the caller's tick
 */
async function visitAnniversaryPlayer() {
  if (!hasAnniversaryVisitToMake()) return false;

  const kissRange = G.skills.ikissyou.range * ANNIVERSARY_ARRIVAL_SLACK;

  // The kiss clears the ticket, so the condition is the whole exit test
  while (hasAnniversaryVisitToMake() && !character.rip) {
    const state = getAnniversaryEvent();
    const host = get_entity(state.id);

    // Out of vision: the announced spot is all we have
    if (!host) {
      const spot = { map: state.map, x: state.x, y: state.y };

      if (distance(character, spot) < ANNIVERSARY_SEARCH_RADIUS)
        await sleep(ANNIVERSARY_RETRY_MS);
      else await advanceSmartMove(spot);

      continue;
    }

    if (distance(character, host) <= kissRange) {
      if (is_on_cooldown("ikissyou")) await sleep(ANNIVERSARY_RETRY_MS);
      else
        await withTimeout(
          use_skill("ikissyou", state.id).catch((e) => console.warn(e)),
          ANNIVERSARY_RETRY_MS,
        );

      continue;
    }

    // Re-read each pass — a pathfind plans against a spot they walk off
    if (can_move_to(host))
      await move(host.real_x, host.real_y).catch((e) => console.warn(e));
    else
      await advanceSmartMove({
        map: character.map,
        x: host.real_x,
        y: host.real_y,
      });
  }

  return true;
}

// Witch's Cipher

const WITCH_GATHER_SPOTS = {
  verdantspore: { mtype: "spider", map: "main" },
  frostscale: { mtype: "wolfie", map: "winterland" },
  embercoal: { mtype: "plantoid", map: "desertland" },
  gloomfeather: { mtype: "ghost", map: "halloween" },
};

const WITCH_GATHER_SLOT_MS = 5 * 60_000;

/** Per ingredient: enough for one mix */
const WITCH_MIX_STOCK = 5;

/** Per ingredient, kept for Cipher Draughts */
const WITCH_ELIXIR_RESERVE = 2;

const WITCH_INGREDIENTS = Object.keys(WITCH_GATHER_SPOTS);

const WITCH_SLOTS = G.events.witchcipher?.slots ?? 5;

const WITCH_STAGE_LEAD_MS = 4 * 60_000;

/** @returns {boolean} whether this realm's Witch's Cipher is gathering */
function isWitchGathering(cipher = server.status.witchcipher) {
  return !!cipher?.live && Date.now() < cipher.gather_end;
}

/** @returns {string} this realm's round, e.g. "USII:USII-2026-10-21-06-00-witchcipher" */
function getWitchRoundKey(cipher = server.status.witchcipher) {
  return `${getCurrentServer()}:${cipher?.id}`;
}

/** @returns {boolean} whether home still runs a Witch round this UTC day, assumed so when its lineup is out of reach */
function hasHomeWitchRoundToday() {
  const status = isAtHomeServer()
    ? server.status
    : typeof getHomeRealmStatus === "function"
      ? getHomeRealmStatus()
      : undefined;
  if (!status?.schedule?.events) return true;

  const dayEnd = getUtcDayEnd();
  return getLineup(status.schedule, ["witchcipher"]).some(
    ({ status, at }) => status === "live" || at < dayEnd,
  );
}

/** @returns {boolean} whether today's mixes belong here: the realm the account brewed on, else home, else wherever we are once home has no round left today */
function isWitchBrewRealm() {
  const day = character.witchcipher;
  if (day?.server) return false;
  if (day?.mixes > 0) return true;
  return isAtHomeServer() || !hasHomeWitchRoundToday();
}

/** @returns {boolean} whether today's mixes end with this round: we are abroad, or the lineup holds no later round before the UTC day ends */
function isLastWitchRoundOfDay(cipher) {
  if (!isAtHomeServer()) return true;

  const dayEnd = getUtcDayEnd(cipher.start);
  return !getLineup(server.status.schedule, ["witchcipher"]).some(
    ({ status, at }) => status === "scheduled" && at > cipher.end && at < dayEnd,
  );
}

/** @returns {boolean} whether the account can still brew in this realm's round, or get ready to */
function canBrewWitchCipher() {
  const cipher = server.status.witchcipher;
  if (!isWitchBrewRealm()) return false;
  if (!cipher?.live || Date.now() >= cipher.end) return false;
  if (Date.now() < cipher.gather_end - WITCH_STAGE_LEAD_MS) return false;
  if (!(character.witchcipher?.mixes_left > 0)) return false;
  if (get("witchBrewDone") === getWitchRoundKey(cipher)) return false;

  const stock = getWitchStock();
  const spare = WITCH_INGREDIENTS.reduce(
    (sum, kind) => sum + Math.max(0, stock[kind] - WITCH_ELIXIR_RESERVE),
    0,
  );
  return spare >= WITCH_SLOTS;
}

/** Candidates left at or below which an earlier round of the day calls the merchant over to strike */
const WITCH_APPROACH_POSSIBLE = 128;

/** @returns {boolean} whether brewing wants the merchant now: the day's last round, or an earlier one narrowing toward a strike */
function isWitchBrewDue() {
  if (!canBrewWitchCipher()) return false;

  const cipher = server.status.witchcipher;
  return (
    isLastWitchRoundOfDay(cipher) ||
    (cipher.possible ?? Infinity) <= WITCH_APPROACH_POSSIBLE
  );
}

/** @returns {Object<string, number>} ingredient counts in this bag */
function countBagWitchIngredients() {
  return Object.fromEntries(
    WITCH_INGREDIENTS.map((kind) => [kind, getTotalQuantityOf(kind)]),
  );
}

/** @returns {Object<string, number>} ingredient counts over bank and our bags */
function getWitchStock() {
  const stock = Object.fromEntries(WITCH_INGREDIENTS.map((kind) => [kind, 0]));
  const sources = [
    get("witchStock"),
    ...partyMems.map((name) => get(`witchBag:${name}`)),
  ];
  for (const source of sources)
    for (const kind of WITCH_INGREDIENTS) stock[kind] += source?.[kind] ?? 0;
  return stock;
}

/** @returns {string} the kind this slot goes to */
function pickWitchGatherKind(visited) {
  const stock = getWitchStock();
  const isStocked = WITCH_INGREDIENTS.every(
    (kind) => stock[kind] >= WITCH_MIX_STOCK + WITCH_ELIXIR_RESERVE,
  );
  const unvisited = WITCH_INGREDIENTS.filter(
    (kind) => !visited.includes(kind),
  );
  const kinds = isStocked || !unvisited.length ? WITCH_INGREDIENTS : unvisited;
  return [...kinds].sort((lhs, rhs) => stock[lhs] - stock[rhs])[0];
}

/** @returns {{kind: string, mtype: string, spot: Object}|undefined} this slot's gathering, while gathering */
function getWitchGatherPlan() {
  const cipher = server.status.witchcipher;
  if (!isWitchGathering(cipher)) return;

  const key = getWitchRoundKey(cipher);
  const slot = Math.floor((Date.now() - cipher.start) / WITCH_GATHER_SLOT_MS);
  let plan = get("witchGatherPlan");
  if (plan?.key !== key) plan = { key, slot: -1, visited: [] };

  if (plan.slot !== slot) {
    const kind = pickWitchGatherKind(plan.visited);
    plan = { key, slot, kind, visited: [...plan.visited, kind] };
    set("witchGatherPlan", plan);
  }

  const { mtype, map } = WITCH_GATHER_SPOTS[plan.kind];
  const spot = getMonsterSpawns(mtype).find((spawn) => spawn.map === map);
  return spot && { kind: plan.kind, mtype, spot };
}

// Trick or Treat

/** Realm hour the knocking starts each day */
const TRICK_OR_TREAT_START_HOUR = 3;

const DOOR_KNOCK_REACH = 70;

const DOOR_WALK_RETRY_MS = 120_000;

/** Doors knocked or refused this UTC day */
let settledDoors = { day: undefined, doors: new Set() };

/** Door index → when a failed walk to it may be tried again */
const doorWalkRetryAt = {};

const getUtcDay = () => new Date().toISOString().slice(0, 10);

function getSettledDoors() {
  const today = getUtcDay();
  if (settledDoors.day !== today)
    settledDoors = { day: today, doors: new Set() };
  return settledDoors.doors;
}

const getKnockLimitKey = () => `trickOrTreatLimit:${character.owner}`;

/** @returns {boolean} whether the account hit today's knock limit */
const isKnockLimitReached = () => get(getKnockLimitKey()) === getUtcDay();

function getRealmHour() {
  const offset = server.status.schedule?.time_offset ?? 0;
  return (new Date().getUTCHours() + offset + 24) % 24;
}

const getDoorFront = ([map, x, y]) =>
  strategicSmartMove.getStandablePointNear({ map, x, y }) ?? { map, x, y };

/** @returns {number|undefined} the nearest door left today */
function getNextTrickOrTreatDoor() {
  const status = character.trickortreat;
  const doors = G.events.trickortreat?.doors;
  if (
    !doors ||
    !server.status.event_flags?.halloween ||
    !(status?.doors_left > 0)
  )
    return;
  if (!isAtHomeServer() || getRealmHour() < TRICK_OR_TREAT_START_HOUR) return;
  if (isKnockLimitReached()) return;

  const settled = getSettledDoors();
  const travelCost = (front) =>
    front.map === character.map
      ? simple_distance(character, front)
      : Number.MAX_SAFE_INTEGER;

  return doors
    .map((door, index) => ({ index, front: getDoorFront(door) }))
    .filter(
      ({ index }) =>
        !status.doors.includes(index) &&
        !settled.has(index) &&
        !(doorWalkRetryAt[index] > Date.now()),
    )
    .sort((lhs, rhs) => travelCost(lhs.front) - travelCost(rhs.front))[0]
    ?.index;
}

/** @returns {Promise<boolean>} whether a walk or knock went ahead */
async function knockNextDoor() {
  const door = getNextTrickOrTreatDoor();
  if (door === undefined) return false;

  const [map, x, y] = G.events.trickortreat.doors[door];
  if (distance(character, { map, x, y }) > DOOR_KNOCK_REACH) {
    return advanceSmartMove(getDoorFront([map, x, y])).then(
      () => true,
      (e) => {
        console.warn(`[trickortreat] walk to door ${door} failed:`, e);
        doorWalkRetryAt[door] = Date.now() + DOOR_WALK_RETRY_MS;
        return false;
      },
    );
  }

  getSettledDoors().add(door);
  await knock(door)
    .then((result) => console.log(`[trickortreat] door ${door}:`, result))
    .catch((error) => {
      if (error?.reason === "trickortreat_limit")
        set(getKnockLimitKey(), getUtcDay());
      console.warn(`[trickortreat] door ${door}:`, error);
    });
  return true;
}
