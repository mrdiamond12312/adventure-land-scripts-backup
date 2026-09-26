// Cave of Many Dreams fighter strategy

// Entry

/** Where Dorr stands */
const DORR_SPOT = { map: "main", x: 816, y: 1200 };

/** How close to Dorr everyone must stand to enter */
const DORR_SLACK = 160;

/** How long a daily-visit answer is trusted */
const CAVE_VISIT_TTL_MS = 60 * 1000;

/** How long an entry request waits before it is sent again */
const CAVE_ENTER_COOLDOWN_MS = 10 * 1000;

/** How close a scheduled event may be before a run is skipped */
const CAVE_EVENT_LEAD_MS = 30 * 60 * 1000;

/** Run length to assume when the state carries no deadline */
const CAVE_RUN_MAX_MS = 24 * 60 * 1000;

// Dark Mage

/** Dies only to his own reflected spell */
const CAVE_DARKMAGE = "cave_darkmage";

/** How far the Dark Mage looks for a target */
const CAVE_DARKMAGE_REACH = 650;

/** Where the mage waits for its shield, just outside his reach */
const CAVE_DARKMAGE_STANDOFF = 680;

/** How close the shielded mage walks in */
const CAVE_DARKMAGE_STRIKE = 200;

/** How far everyone else keeps from him */
const CAVE_DARKMAGE_CLEARANCE = 750;

/** Storage key for where he was last seen */
const CAVE_DARKMAGE_KEY = "caveDarkMage";

/** How often a hunt step is re-issued */
const CAVE_HUNT_STEP_MS = 500;

// Voting

/** Options that put cave_wolf on the field */
const CAVE_OPTIONS_TO_REFUSE = [
  "e10_0",
  "e12_2",
  "e03_1",
  "e08_2",
  "e08_4",
  "e10_1",
  "e10_3",
  "e18_4",
  "e21_2",
];

/** Rogue option that leaves him to the wolves */
const CAVE_ROGUE_WAIT = "watch";

/** Last Word */
const CAVE_ROGUE_PRIZE = "cave_backstabber";

/** Rogue options when he is not holding Last Word, best first */
const CAVE_ROGUE_RESCUES = ["lure", "save", "cover"];

/** How often the choice loop runs */
const CAVE_CHOICE_INTERVAL_MS = 1000;

/** How long a vote or shop talk waits before it is sent again */
const CAVE_REQUEST_RETRY_MS = 2 * 1000;

// Shop

/** Shop items not worth cave gold */
const CAVE_ITEMS_TO_SKIP = ["broom", "tshirt0", "tshirt1", "tshirt2"];

/** How long a shop gets to open once we are in it */
const CAVE_SHOP_WAIT_MS = 15 * 1000;

/** How long a refused purchase waits */
const CAVE_BUY_RETRY_MS = 20 * 1000;

/** Refusals before a shop is given up */
const CAVE_BUY_ATTEMPTS = 6;

// Movement

/** How close counts as standing on an objective */
const CAVE_ARRIVAL_SLACK = 120;

/** How close the stairs must be to take them */
const CAVE_DOOR_SLACK = 40;

/** How far an escort may trail before the walk stops for her */
const CAVE_ESCORT_LEASH = 200;

/** How close a following escort must come before the walk resumes */
const CAVE_ESCORT_CLOSE = 80;

/** How long a refused walk or descent waits */
const CAVE_MOVE_RETRY_MS = 3 * 1000;

/** Pathing speed that rules out town warps */
const CAVE_PATHING_SPEED = 1_000_000;

// Leaving

/** The deepest floor */
const CAVE_LAST_FLOOR = 2;

/** How long a refused exit waits */
const CAVE_EXIT_RETRY_MS = 5 * 1000;

/** Logs each decision */
const CAVE_DEBUG = true;

// Logging

/** The last line printed per stage */
const lastCaveLogs = new Map();

/**
 * Logs a line once per stage until it changes.
 * @param {string} stage
 * @param {object} [detail]
 */
function caveLog(stage, detail) {
  if (!CAVE_DEBUG) return;

  const line =
    detail === undefined ? stage : `${stage} ${JSON.stringify(detail)}`;
  if (lastCaveLogs.get(stage) === line) return;

  lastCaveLogs.set(stage, line);
  console.warn(`[cave] ${line}`);
}

/**
 * The reason from a refusal or an error.
 * @param {object|Error} error
 * @returns {string}
 */
function caveWhy(error) {
  return error?.reason ?? error?.message ?? String(error);
}

// Run state

/** @returns {object} empty per-run state */
function freshCaveRun() {
  return {
    attempts: {},
    choiceId: undefined,
    buyAt: 0,
    votedAt: 0,
    walkedAt: 0,
    descendedAt: 0,
    shopAt: {},
    shopTalkAt: 0,
    exitedAt: 0,
    huntedAt: 0,
    shieldAt: 0,
  };
}

/** Storage key for the party's settled shops */
const CAVE_SHOPS_KEY = "caveShops";

/** Per-run state */
let caveRun = freshCaveRun();

/** State kept across runs */
const caveState = {
  visit: undefined,
  checkedAt: 0,
  enteredAt: 0,
  inside: false,
};

// Entry

/** @returns {boolean} whether the cave API exists */
function hasCaveApi() {
  return typeof cave_info === "function" && typeof cave_enter === "function";
}

/** @returns {boolean} whether we are in a run */
function isInCave() {
  return Boolean(character.cave);
}

/** @returns {boolean} whether we are on the home realm */
function isHomeRealm() {
  if (typeof server === "undefined") return false;

  return isAtHomeServer();
}

/** @returns {boolean} whether a scheduled event starts too soon for a run */
function isEventDueSoon() {
  if (typeof msUntilHomeScheduledEvent !== "function") return false;

  return msUntilHomeScheduledEvent() <= CAVE_EVENT_LEAD_MS;
}

/**
 * Whether we have an open run on this realm.
 * @param {object} [visit]
 * @returns {boolean}
 */
function canResumeCaveRun(visit) {
  return (visit?.resume?.remaining_ms ?? 0) > 0;
}

/**
 * The daily visit, cached for a minute.
 * @returns {Promise<object|undefined>}
 */
async function getCaveVisit() {
  if (Date.now() - caveState.checkedAt < CAVE_VISIT_TTL_MS)
    return caveState.visit;

  caveState.checkedAt = Date.now();
  caveState.visit = await cave_info().catch(() => undefined);

  return caveState.visit;
}

/** @returns {boolean} whether the whole party is at Dorr */
function isPartyAtDorr() {
  return partyMems.every((name) => {
    if (name === character.name) return true;

    const member = get_entity(name);
    return member && distance(member, DORR_SPOT) <= DORR_SLACK;
  });
}

/**
 * Enters with the party, or rejoins an open run alone.
 * @param {boolean} [resuming]
 * @returns {Promise<void>}
 */
async function enterCave(resuming) {
  // Only the leader starts a fresh run
  if (!resuming && character.name !== partyMems[0]) return;
  if (Date.now() - caveState.enteredAt < CAVE_ENTER_COOLDOWN_MS) return;

  const outsiders = parent.party_list.filter(
    (name) => !partyMems.includes(name),
  );
  if (!resuming && outsiders.length)
    return caveLog("entry held: outsiders", outsiders);

  if (!resuming && parent.party_list.length !== partyMems.length)
    return caveLog("entry held: party", parent.party_list);

  caveLog(resuming ? "resuming" : "entering", parent.party_list);
  caveState.enteredAt = Date.now();
  await cave_enter().catch((error) => console.warn("Cave refused us", error));

  // Re-check the visit
  caveState.checkedAt = 0;
}

// Targeting

/** @returns {string|undefined} the room of a live rogue we voted to watch */
function getWatchedCaveRoom() {
  const choice = character.cave?.choice;
  if (!choice?.resolved || choice.kind !== "rogue") return undefined;
  if (choice.result !== CAVE_ROGUE_WAIT) return undefined;

  const rogue = Object.values(parent.entities).find(
    (entity) =>
      entity.mtype === "cave_rogue" &&
      !entity.dead &&
      entity.cave?.side === "victim",
  );

  return rogue?.cave?.room;
}

/**
 * Whether we should attack it.
 * @param {object} entity
 * @param {string} [watched]
 * @returns {boolean}
 */
function isCaveMobWorthHitting(entity, watched) {
  return (
    entity.type === "monster" &&
    !entity.dead &&
    !entity.cave?.citizen &&
    !CAVE_SIDES_TO_LEAVE.includes(entity.cave?.side) &&
    entity.mtype !== CAVE_DARKMAGE &&
    !(
      watched !== undefined &&
      entity.cave?.room === watched &&
      entity.cave?.side === "predator"
    )
  );
}

/**
 * Whether a position is inside the bounds.
 * @param {object} position
 * @param {number[]} bounds
 * @returns {boolean}
 */
function isInCaveBounds(position, bounds) {
  return (
    position.x >= bounds[0] &&
    position.x <= bounds[2] &&
    position.y >= bounds[1] &&
    position.y <= bounds[3]
  );
}

/**
 * The room containing a position.
 * @param {object} position
 * @returns {object|undefined}
 */
function getCaveRoom(position) {
  return (parent.G.maps[character.map]?.rooms ?? []).find(
    (room) => room.bounds && isInCaveBounds(position, room.bounds),
  );
}

/** @returns {object|undefined} the party target, else the nearest mob in our room */
function getCaveTarget() {
  // Stay inside our room
  const room = getCaveRoom(character);
  const watched = getWatchedCaveRoom();

  const isHere = (entity) =>
    isCaveMobWorthHitting(entity, watched) &&
    (!room || isInCaveBounds(entity, room.bounds));

  const partyTarget = getTarget();
  if (partyTarget && isHere(partyTarget)) return partyTarget;

  return Object.values(parent.entities)
    .filter(isHere)
    .sort((lhs, rhs) => distance(character, lhs) - distance(character, rhs))[0];
}

/** @returns {object|undefined} the nearest awake mob in range */
function getCaveTargetInReach() {
  const watched = getWatchedCaveRoom();

  return Object.values(parent.entities)
    .filter(
      (entity) =>
        isCaveMobWorthHitting(entity, watched) &&
        distance(character, entity) <= character.range &&
        isCaveMobAwake(entity),
    )
    .sort((lhs, rhs) => distance(character, lhs) - distance(character, rhs))[0];
}

// Dark Mage

/** @returns {boolean} whether our mage is still in the run */
function isCaveMageInRun() {
  return (character.cave.roster ?? []).some(
    (member) => member.name === MAGE && !member.left && !member.disconnected,
  );
}

/**
 * The Dark Mage in view, else his last seen spot.
 * @returns {object|undefined}
 */
function getCaveDarkMage() {
  const seen = get_nearest_monster({ type: CAVE_DARKMAGE });
  if (seen && !isCaveFriendly(seen)) {
    set(CAVE_DARKMAGE_KEY, {
      run: character.cave.run,
      map: character.map,
      x: seen.x,
      y: seen.y,
    });
    return seen;
  }

  const reported = get(CAVE_DARKMAGE_KEY);
  if (reported?.run !== character.cave.run) return undefined;
  if (reported.map !== character.map) return undefined;

  // At his spot and not seen: dead
  if (distance(character, reported) < CAVE_DARKMAGE_STRIKE) {
    set(CAVE_DARKMAGE_KEY, undefined);
    return caveLog("dark mage gone");
  }

  return reported;
}

/**
 * Walks to this distance from the Dark Mage.
 * @param {object} darkmage
 * @param {number} range
 */
function stepToDarkMageRange(darkmage, range) {
  if (Date.now() - caveRun.huntedAt < CAVE_HUNT_STEP_MS) return;
  if (smart.moving || isAdvanceSmartMoving) return;

  const { x, y } = getDarkMageRangePoint(darkmage, range);

  caveRun.huntedAt = Date.now();
  Promise.resolve(xmove(x, y)).catch(() => undefined);
}

/**
 * The point at this distance from the Dark Mage, on our side.
 * @param {object} darkmage
 * @param {number} range
 * @returns {{x: number, y: number}}
 */
function getDarkMageRangePoint(darkmage, range) {
  const away = distance(character, darkmage) || 1;

  return {
    x: darkmage.x + ((character.x - darkmage.x) / away) * range,
    y: darkmage.y + ((character.y - darkmage.y) / away) * range,
  };
}

/**
 * Blinks to this distance from the Dark Mage.
 * @param {object} darkmage
 * @param {number} range
 * @returns {Promise<boolean>} whether a blink was sent
 */
async function blinkToDarkMageRange(darkmage, range) {
  if (Date.now() - caveRun.huntedAt < CAVE_HUNT_STEP_MS) return false;
  if (smart.moving || isAdvanceSmartMoving) return false;
  if (is_on_cooldown("blink")) return false;
  if (character.mp < G.skills.blink.mp + G.skills.reflection.mp) return false;

  const { x, y } = getDarkMageRangePoint(darkmage, range);

  caveRun.huntedAt = Date.now();
  await use_skill("blink", [x, y]).catch((error) =>
    caveLog("blink refused", caveWhy(error)),
  );

  return true;
}

/**
 * Mage tanks his cast under Reflective Shield; the rest keep away.
 * @param {object} darkmage
 * @returns {Promise<object>}
 */
async function huntCaveDarkMage(darkmage) {
  const away = distance(character, darkmage);

  if (character.name !== MAGE) {
    if (away < CAVE_DARKMAGE_CLEARANCE)
      stepToDarkMageRange(darkmage, CAVE_DARKMAGE_CLEARANCE);
    return travelling();
  }

  const shielded =
    Date.now() - caveRun.shieldAt < G.conditions.reflection.duration;
  const ready =
    !is_on_cooldown("reflection") && character.mp >= G.skills.reflection.mp;

  if (shielded) {
    caveLog("dark mage", { step: "charging", away: Math.round(away) });
    if (away > CAVE_DARKMAGE_STRIKE)
      stepToDarkMageRange(darkmage, CAVE_DARKMAGE_STRIKE);
    return travelling();
  }

  if (!ready) {
    caveLog("dark mage", { step: "cooling", away: Math.round(away) });
    if (away < CAVE_DARKMAGE_CLEARANCE)
      stepToDarkMageRange(darkmage, CAVE_DARKMAGE_CLEARANCE);
    return travelling();
  }

  if (away > CAVE_DARKMAGE_STANDOFF + CAVE_ARRIVAL_SLACK) {
    caveLog("dark mage", { step: "closing", away: Math.round(away) });
    // Blink only before the shield
    if (!(await blinkToDarkMageRange(darkmage, CAVE_DARKMAGE_STANDOFF)))
      stepToDarkMageRange(darkmage, CAVE_DARKMAGE_STANDOFF);
    return travelling();
  }

  caveLog("dark mage", { step: "shielding", away: Math.round(away) });
  await use_skill("reflection", character)
    .then(() => {
      caveRun.shieldAt = Date.now();
    })
    .catch((error) => caveLog("shield refused", caveWhy(error)));

  return travelling();
}

// Voting

/**
 * Whether the cornered rogue is holding Last Word.
 * @param {object} choice
 * @returns {boolean}
 */
function isCaveRogueCarryingPrize(choice) {
  const blades = (choice.scene ?? []).map((actor) => ({
    name: actor.name,
    holding: Object.values(
      actor.slots ?? parent.entities[actor.id]?.slots ?? {},
    )
      .filter(Boolean)
      .map((slot) => slot.name),
  }));

  const carrying = blades.some((actor) =>
    actor.holding.includes(CAVE_ROGUE_PRIZE),
  );

  caveLog("rogue blades", { blades, carrying });

  return carrying;
}

/**
 * The option to vote for.
 * @param {object} choice
 * @returns {object|undefined}
 */
function pickCaveOption(choice) {
  const offered = (choice.options ?? []).filter(
    (option) => !option.unavailable,
  );

  const allowed = offered.filter(
    (option) => !CAVE_OPTIONS_TO_REFUSE.includes(option.id),
  );
  if (!allowed.length) return undefined;

  // Never spend Amber
  const affordable = allowed.filter((option) => !option.amber);

  if (choice.kind === "rogue") {
    const wanted = isCaveRogueCarryingPrize(choice)
      ? [CAVE_ROGUE_WAIT]
      : CAVE_ROGUE_RESCUES;

    const rogue = wanted
      .map((id) => affordable.find((option) => option.id === id))
      .find(Boolean);
    if (rogue) return rogue;
  }

  return (
    [...affordable].sort((lhs, rhs) => (lhs.cost ?? 0) - (rhs.cost ?? 0))[0] ??
    allowed[0]
  );
}

/**
 * Votes once per choice.
 * @param {object} choice
 * @returns {Promise<void>}
 */
async function voteOnCaveChoice(choice) {
  if (!choice || choice.resolved || choice.id === caveRun.choiceId) return;
  if (Date.now() - caveRun.votedAt < CAVE_REQUEST_RETRY_MS) return;

  const option = pickCaveOption(choice);
  if (!option) return;

  caveRun.votedAt = Date.now();

  await cave_reply(choice.id, option.id)
    .then(() => {
      caveRun.choiceId = choice.id;
    })
    .catch((error) => {
      if (error?.reason === "vote_closed") {
        caveRun.choiceId = choice.id;
        return;
      }

      caveLog("vote refused", {
        id: choice.id,
        option: option.id,
        why: caveWhy(error),
      });
    });
}

// Shop

/**
 * Whether this objective is a shop.
 * @param {object} objective
 * @returns {boolean}
 */
function isCaveShopObjective(objective) {
  return Boolean(objective?.id?.endsWith(":shop"));
}

/**
 * Shop rooms already handled this run.
 * @returns {string[]}
 */
function getSettledCaveShops() {
  const stored = get(CAVE_SHOPS_KEY);

  return stored?.run === character.cave?.run ? (stored.rooms ?? []) : [];
}

/**
 * Marks a shop room as handled.
 * @param {string} room
 */
function settleCaveShop(room) {
  const rooms = getSettledCaveShops();
  if (rooms.includes(room)) return;

  set(CAVE_SHOPS_KEY, { run: character.cave?.run, rooms: [...rooms, room] });
}

/**
 * Whether the shop item is on the skip list.
 * @param {string} [name]
 * @returns {boolean}
 */
function isCaveItemSkipped(name) {
  if (!name) return false;

  return (
    CAVE_ITEMS_TO_SKIP.includes(name) ||
    CAVE_ITEMS_TO_SKIP.includes(name.replace(/^cave_/, ""))
  );
}

/**
 * Buys the shop item.
 * @param {object} choice
 * @returns {Promise<void>}
 */
async function buyFromCaveShop(choice) {
  const shop = choice?.shop;
  const room = shop?.room;
  if (room === undefined || getSettledCaveShops().includes(room)) return;
  if (shop.sold) {
    settleCaveShop(room);
    return caveLog("shop sold out", shop.name);
  }
  if (isCaveItemSkipped(shop.name)) {
    settleCaveShop(room);
    return caveLog("shop skipped", shop.name);
  }
  if (shop.nearby === false) return;
  if ((caveRun.attempts[room] ?? 0) >= CAVE_BUY_ATTEMPTS) return;
  if (Date.now() - caveRun.buyAt < CAVE_BUY_RETRY_MS) return;

  caveRun.buyAt = Date.now();
  caveRun.attempts[room] = (caveRun.attempts[room] ?? 0) + 1;

  caveLog("buying", { name: shop.name, price: shop.price });

  await cave_buy(room)
    .then(() => settleCaveShop(room))
    .catch((error) => {
      // Not an attempt
      if (error?.reason === "gold_not_enough") {
        caveRun.attempts[room] -= 1;
        return;
      }

      console.warn("Cave shop refused us", error);
    });
}

/**
 * Opens the shop we are standing in.
 * @param {object} objective
 */
async function openCaveShop(objective) {
  caveRun.shopAt[objective.id] ??= Date.now();

  if (Date.now() - caveRun.shopAt[objective.id] >= CAVE_SHOP_WAIT_MS) {
    settleCaveShop(objective.id);
    return caveLog("shop gave up", objective.id);
  }

  if (character.cave?.choice?.shop?.room === objective.id) return;
  if (Date.now() - caveRun.shopTalkAt < CAVE_REQUEST_RETRY_MS) return;

  caveRun.shopTalkAt = Date.now();

  await cave_talk(objective.id).catch((error) =>
    caveLog("shop would not open", {
      id: objective.id,
      why: caveWhy(error),
    }),
  );
}

// Objectives

/**
 * This floor's unfinished objectives.
 * @returns {object[]}
 */
function getPendingCaveObjectives() {
  const cave = character.cave;
  const settled = getSettledCaveShops();

  return (cave.objectives ?? []).filter(
    (objective) =>
      !objective.done &&
      objective.floor === cave.floor &&
      !(isCaveShopObjective(objective) && settled.includes(objective.id)),
  );
}

/**
 * The ally we are escorting to the stairs.
 * @param {object[]} pending
 * @returns {object|undefined}
 */
function getCaveEscort(pending) {
  const rooms = new Set(pending.map((objective) => objective.id));
  const entities = Object.values(parent.entities);

  return entities.find(
    (ally) =>
      ally.cave?.side === "ally" &&
      !ally.dead &&
      rooms.has(ally.cave.room) &&
      !entities.some(
        (other) =>
          other !== ally &&
          other.cave?.room === ally.cave.room &&
          !other.dead &&
          !isCaveFriendly(other),
      ),
  );
}

/**
 * The closest one.
 * @param {object[]} destinations
 * @returns {object|undefined}
 */
function getClosestCaveDestination(destinations) {
  return [...destinations].sort(
    (lhs, rhs) => distance(character, lhs) - distance(character, rhs),
  )[0];
}

/**
 * The nearest unfinished required objective.
 * @param {object[]} pending
 * @returns {object|undefined}
 */
function getNextRequiredCaveObjective(pending) {
  const required = pending.filter((objective) => objective.required);

  return required.length ? getClosestCaveDestination(required) : undefined;
}

/**
 * Whether we are away from that objective.
 * @param {object} [objective]
 * @returns {boolean}
 */
function isAwayFromCaveObjective(objective) {
  if (!objective) return false;

  return distance(character, objective) > CAVE_ARRIVAL_SLACK;
}

/**
 * Where to walk next.
 * @param {object[]} pending
 * @returns {object|undefined}
 */
function getCaveDestination(pending) {
  const cave = character.cave;

  const required = pending.filter((objective) => objective.required);

  // Escort to the stairs
  const escort = getCaveEscort(pending);
  const stairs = (cave.doors ?? []).find((door) => door.down);
  if (escort && stairs) {
    const gap = distance(character, escort);

    // Fetch a stuck escort
    if (gap > CAVE_ESCORT_LEASH && !escort.moving)
      return { id: "escort", x: escort.x, y: escort.y };

    if (gap > CAVE_ESCORT_CLOSE && escort.moving)
      return caveLog("escort waiting", { gap: Math.round(gap) });

    return { id: "escort", x: stairs.x, y: stairs.y, escort: escort.id };
  }

  if (required.length) return getClosestCaveDestination(required);

  const shop = pending.find((objective) => isCaveShopObjective(objective));
  if (shop) return shop;

  const down = (cave.doors ?? []).find((door) => door.down && !door.locked);

  return down ?? getClosestCaveDestination(pending);
}

// Movement

/**
 * The floor number of this run's map.
 * @param {string} [map]
 * @returns {number|undefined}
 */
function getCaveFloorOf(map) {
  const prefix = `zone_${character.cave.run}_`;
  if (!map?.startsWith(prefix)) return undefined;

  const floor = Number(map.slice(prefix.length));

  return Number.isInteger(floor) ? floor : undefined;
}

/**
 * Party members on a shallower floor.
 * @returns {string[]}
 */
function getCaveStragglers() {
  const party = get_party() ?? {};
  const here = character.cave.floor;

  return (character.cave.roster ?? [])
    .filter(
      (member) =>
        !member.left &&
        !member.disconnected &&
        member.name !== character.name &&
        (getCaveFloorOf(party[member.name]?.map) ?? here) < here,
    )
    .map((member) => member.name);
}

/**
 * Takes the stairs.
 * @param {object} door
 * @returns {Promise<void>}
 */
async function descendCaveFloor(door) {
  if (Date.now() - caveRun.descendedAt < CAVE_MOVE_RETRY_MS) return;

  caveRun.descendedAt = Date.now();

  const spawn = parent.G.maps[character.map]?.doors?.[door.id]?.[5] ?? 0;

  await transport(door.to, spawn).catch((error) =>
    caveLog("stairs refused", {
      to: door.to,
      door: door.id,
      spawn,
      away: Math.round(distance(character, door)),
      why: caveWhy(error),
    }),
  );
}

/**
 * Walks to the destination, and takes it if it is the stairs.
 * @param {object[]} pending
 * @param {object} [destination]
 * @returns {Promise<void>}
 */
async function walkToCaveDestination(
  pending,
  destination = getCaveDestination(pending),
) {
  if (smart.moving || isAdvanceSmartMoving) return;
  if (!destination) return;

  const slack = destination.to ? CAVE_DOOR_SLACK : CAVE_ARRIVAL_SLACK;

  if (distance(character, destination) > slack) {
    if (Date.now() - caveRun.walkedAt < CAVE_MOVE_RETRY_MS) return;

    const to = { map: character.map, x: destination.x, y: destination.y };

    caveRun.walkedAt = Date.now();

    // Stop if the escort falls behind
    const stopWatcher = destination.escort
      ? () => {
          const escort = parent.entities[destination.escort];
          return !escort || distance(character, escort) > CAVE_ESCORT_LEASH;
        }
      : undefined;

    // No town, magiport or blink in a run
    await advanceSmartMove(to, {
      useScare: true,
      useTown: false,
      useMagiport: false,
      useBlink: false,
      speed: CAVE_PATHING_SPEED,
      stopWatcher,
    }).catch(async (error) => {
      caveLog("walk refused", {
        to: destination.name ?? destination.id,
        why: caveWhy(error),
      });

      // Native fallback
      const watcher =
        stopWatcher &&
        setInterval(() => {
          if (stopWatcher()) stop("move");
        }, 250);

      await smart_move(to)
        .catch(() => undefined)
        .finally(() => clearInterval(watcher));
    });
    return;
  }

  if (destination.to) {
    const stragglers = getCaveStragglers();
    if (stragglers.length) return caveLog("stairs held: party", stragglers);

    return descendCaveFloor(destination);
  }

  if (isCaveShopObjective(destination)) await openCaveShop(destination);
}

// Leaving

/**
 * Whether the required rooms are done and the stairs are open.
 * @param {object[]} pending
 * @returns {boolean}
 */
function isCaveFloorDone(pending) {
  const cave = character.cave;

  if (pending.some((objective) => objective.required)) return false;

  return (cave.doors ?? []).some((door) => door.down && !door.locked);
}

/**
 * Whether it is time to leave.
 * @param {object[]} pending
 * @returns {boolean}
 */
function isCaveRunFinished(pending) {
  const cave = character.cave;

  if ((cave.floor ?? 0) < CAVE_LAST_FLOOR) return false;
  if ((cave.doors ?? []).some((door) => door.down && !door.locked))
    return false;
  if (pending.some((objective) => objective.required)) return false;

  // Farms may be stuck
  if (isCaveAmberCapped())
    return !pending.some((objective) => objective.kind !== "farm");

  return pending.length === 0;
}

/** @returns {boolean} whether the run has spawned all the Amber it can */
function isCaveAmberCapped() {
  const limits = character.cave.limits;

  return Boolean(limits) && limits.amber_spawned >= limits.amber;
}

/** @returns {object|undefined} the nearest unopened cave chest on this floor */
function getNearestCaveChest() {
  const chests = Object.values(parent.chests).filter(
    (chest) => chest.map === character.map,
  );

  return getClosestCaveDestination(chests);
}

/**
 * Exits the run.
 * @returns {Promise<void>}
 */
async function leaveCave() {
  if (Date.now() - caveRun.exitedAt < CAVE_EXIT_RETRY_MS) return;

  caveRun.exitedAt = Date.now();

  if (typeof cave_exit !== "function") return caveLog("no exit to take");

  caveLog("leaving", { floor: character.cave.floor });

  await cave_exit().catch((error) => caveLog("exit refused", caveWhy(error)));
}

// Tick

/**
 * Handles entering or leaving a run.
 * @param {boolean} inCave
 */
function noteCaveRunEdge(inCave) {
  if (inCave === caveState.inside) return;

  if (inCave) caveRun = freshCaveRun();
  else {
    caveState.checkedAt = 0;

    changeToNormalStrategies();
  }

  // Deadline for the merchant
  set(
    "caveRun",
    inCave ? character.cave.expires ?? Date.now() + CAVE_RUN_MAX_MS : undefined,
  );

  caveState.inside = inCave;
}

/**
 * Runs one tick inside the cave.
 * @returns {Promise<object>}
 */
async function fightCaveRun() {
  changeToPullStrategies();

  caveLog("inside", {
    floor: character.cave.floor,
    map: character.map,
    paused: Boolean(character.cave.paused),
    choice: character.cave.choice?.id,
  });

  if (character.cave.paused) {
    caveLog("paused", {
      choice: character.cave.choice?.id,
      resolved: Boolean(character.cave.choice?.resolved),
      votes: character.cave.choice?.votes,
      in: Math.round((character.cave.choice?.deadline - Date.now()) / 1000),
    });

    // Moves are refused while paused
    const held = getCaveTarget();

    return held ? engage(held) : travelling();
  }

  const darkmage = isCaveMageInRun() ? getCaveDarkMage() : undefined;
  if (darkmage) return huntCaveDarkMage(darkmage);

  const pending = getPendingCaveObjectives();

  // Only hit what is in reach while walking
  const holding =
    isCaveFloorDone(pending) ||
    isAwayFromCaveObjective(getNextRequiredCaveObjective(pending));

  const target = holding ? getCaveTargetInReach() : getCaveTarget();
  if (target && !holding) return engage(target);

  if (isCaveRunFinished(pending)) {
    const chest = getNearestCaveChest();
    if (chest) {
      caveLog("collecting chests", { chest: chest.id });
      walkToCaveDestination(pending, { id: "chest", x: chest.x, y: chest.y });
      return travelling();
    }

    await leaveCave();
    return travelling();
  }

  walkToCaveDestination(pending);

  return target ? engage(target) : travelling();
}

/**
 * Gathers the party at Dorr and enters.
 * @returns {Promise<object|undefined>} the outcome, if it owns this tick
 */
async function approachCave() {
  if (!isHomeRealm())
    return caveLog("away from home realm", {
      here:
        typeof server === "undefined"
          ? undefined
          : `${server.region}${server.id}`,
    });

  const visit = await getCaveVisit();
  const resuming = canResumeCaveRun(visit);

  if (!resuming) {
    if (isEventDueSoon())
      return caveLog("skipped: event soon", {
        minutes: Math.round(msUntilHomeScheduledEvent() / 60000),
      });

    if (!visit?.available) return caveLog("no visit left", visit);
  }

  isPreparingCave = true;

  if (smart.moving || isAdvanceSmartMoving) return travelling();

  if (distance(character, DORR_SPOT) > DORR_SLACK) {
    caveLog(resuming ? "walking back to Dorr" : "walking to Dorr");
    changeToNormalStrategies();
    await advanceSmartMove(DORR_SPOT);
    return travelling();
  }

  if (!resuming && !isPartyAtDorr()) {
    caveLog("at Dorr, waiting on the party");
    return travelling();
  }

  await enterCave(resuming);

  return travelling();
}

/**
 * Cave strategy entry point.
 * @returns {Promise<object|undefined>} the outcome, if it owns this tick
 */
async function useCaveStrategy() {
  isPreparingCave = false;

  if (!hasCaveApi()) return undefined;

  const inCave = isInCave();

  noteCaveRunEdge(inCave);

  if (!inCave) return approachCave();

  isPreparingCave = true;

  return fightCaveRun();
}

// Choice loop

/**
 * Votes and buys, independent of the tick.
 * @returns {Promise<void>}
 */
async function caveChoiceLoop() {
  try {
    const choice = character.cave?.choice;
    if (choice) {
      await voteOnCaveChoice(choice);
      await buyFromCaveShop(choice);
    }
  } catch (error) {
    console.error(error);
  } finally {
    setTimeout(caveChoiceLoop, CAVE_CHOICE_INTERVAL_MS);
  }
}

caveChoiceLoop();
