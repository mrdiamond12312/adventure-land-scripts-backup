// Cave of Many Dreams — the fighter's highest priority strategy.

/** The realm holding the daily */
const CAVE_HOME_REALM = "USII";

/** Dorr, at the vine-covered doorway */
const DORR_SPOT = { map: "main", x: 816, y: 1200 };

/** Everyone has to be this close to Dorr to go in */
const DORR_SLACK = 160;

/** The Dark Mage is immune, and the rogue only pays out if monsters finish him */
const CAVE_MOBS_TO_LEAVE = ["cave_darkmage", "cave_rogue"];

/** Levels land at spawn, so a ceiling is the only way to duck the wolf packs */
var caveMaxMobLevel = Infinity;

/** Options that put cave_wolf on the field — e10_0 and e12_2 call in six */
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

/** The rogue encounter's wait-and-see option, by its own id */
const CAVE_ROGUE_WAIT = "watch";

/** Long enough for the shop to answer once we are standing in it */
const CAVE_SHOP_WAIT_MS = 15 * 1000;

/** How long a refused walk waits */
const CAVE_WALK_RETRY_MS = 3 * 1000;

/** High enough that no leg of a path is worth a town warp */
const CAVE_PATHING_SPEED = 1_000_000;

/** Standing this close to an objective counts as being on it */
const CAVE_ARRIVAL_SLACK = 120;

/** Town junk at cave prices — the broom alone is 80% of the purse */
var CAVE_ITEMS_TO_SKIP = ["broom", "tshirt0", "tshirt1", "tshirt2"];

/** Long enough for chest gold to land before the shop is asked again */
const CAVE_BUY_RETRY_MS = 20 * 1000;

/** A shop that keeps saying no is out of stock, not out of our gold */
const CAVE_BUY_ATTEMPTS = 6;

/** Refusals that cost no attempt, because the next chest settles them */
const CAVE_BUY_RETRY_REASONS = ["gold_not_enough"];

/** How often the choice loop looks, off the tick */
const CAVE_CHOICE_INTERVAL_MS = 1000;

/** Long enough for a vote to land */
const CAVE_VOTE_RETRY_MS = 2 * 1000;

/** Chatter is free, but not every tick */
const CAVE_TALK_INTERVAL_MS = 10 * 1000;

/** What cave_talk reaches */
const CAVE_TALK_RANGE = 160;

/** How long a daily-visit answer is trusted */
const CAVE_VISIT_TTL_MS = 60 * 1000;

/** Long enough for an entry to land before it is asked for again */
const CAVE_ENTER_COOLDOWN_MS = 10 * 1000;

/** A merchant hop drags the whole party out, so a near window outranks a run */
const CAVE_EVENT_LEAD_MS = 30 * 60 * 1000;

/** Stands in for the run's own deadline */
const CAVE_RUN_MAX_MS = 24 * 60 * 1000;

/** Narrates each decision; leave off outside a debugging run */
var CAVE_DEBUG = true;

/** The last line printed per stage */
const lastCaveLogs = new Map();

/**
 * Prints a decision once per stage, until it changes.
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

/** @returns {object} a run's blank slate */
function freshCaveRun() {
  return {
    settled: [],
    attempts: {},
    choiceId: undefined,
    buyAt: 0,
    talkAt: 0,
    votedAt: 0,
    walkedAt: 0,
    shopAt: {},
    shopTalkAt: 0,
  };
}

/** Room and choice ids are only unique within the run that issued them */
let caveRun = freshCaveRun();

/** Outlives any one run: the daily answer, the entry handshake, the run edge */
const caveState = {
  visit: undefined,
  checkedAt: 0,
  enteredAt: 0,
  inside: false,
};

/**
 * Whether this client knows the cave at all.
 * @returns {boolean}
 */
function hasCaveApi() {
  return typeof cave_info === "function" && typeof cave_enter === "function";
}

/**
 * Whether a cave run currently holds this character.
 * @returns {boolean}
 */
function isInCave() {
  return Boolean(character.cave);
}

/**
 * Whether this realm is ours.
 * @returns {boolean}
 */
function isHomeRealm() {
  if (typeof server === "undefined") return false;

  return `${server.region}${server.id}` === CAVE_HOME_REALM;
}

/**
 * Whether the home realm's next daily/nightly window lands too soon to spend
 * the time on a run.
 * @returns {boolean}
 */
function isEventDueSoon() {
  if (typeof msUntilHomeScheduledEvent !== "function") return false;

  return msUntilHomeScheduledEvent() <= CAVE_EVENT_LEAD_MS;
}

/**
 * Whether a run of ours is still open here. `remaining_ms` only comes back on
 * the realm holding the run, so its presence is the realm check.
 * @param {object} [visit]
 * @returns {boolean}
 */
function canResumeCaveRun(visit) {
  return (visit?.resume?.remaining_ms ?? 0) > 0;
}

/**
 * The account's daily visit, re-asked at most once a minute.
 * @returns {Promise<object|undefined>}
 */
async function getCaveVisit() {
  if (Date.now() - caveState.checkedAt < CAVE_VISIT_TTL_MS)
    return caveState.visit;

  caveState.checkedAt = Date.now();
  caveState.visit = await cave_info().catch(() => undefined);

  return caveState.visit;
}

/**
 * Whether every party member is standing with us at Dorr.
 * @returns {boolean}
 */
function isPartyAtDorr() {
  return partyMems.every((name) => {
    if (name === character.name) return true;

    const member = get_entity(name);
    return member && distance(member, DORR_SPOT) <= DORR_SLACK;
  });
}

/**
 * Takes the party in, once, from whoever leads it, or walks a single character
 * back into a run that is still open.
 * @param {boolean} [resuming] a return to an open run, which needs no party
 * @returns {Promise<void>}
 */
async function enterCave(resuming) {
  // A fresh visit is spent once, by the leader, on the whole party at the door;
  // a return is each character's own, so whoever is outside makes their own call
  if (!resuming && character.name !== partyMems[0]) return;
  if (Date.now() - caveState.enteredAt < CAVE_ENTER_COOLDOWN_MS) return;

  // An outsider would be taken in on their own account's visit, but nobody can
  // join a run already under way, so only a fresh entry has to care
  const outsiders = parent.party_list.filter(
    (name) => !partyMems.includes(name),
  );
  if (!resuming && outsiders.length)
    return caveLog("entry held — outsiders", outsiders);

  // A fresh visit is spent on whoever is in the party, so it waits for all three
  if (!resuming && parent.party_list.length !== partyMems.length)
    return caveLog("entry held — party", parent.party_list);

  caveLog(resuming ? "resuming" : "entering", parent.party_list);
  caveState.enteredAt = Date.now();
  await cave_enter().catch((error) => console.warn("Cave refused us", error));

  // The visit is spent either way, so stop trusting the cached answer
  caveState.checkedAt = 0;
}

/**
 * Whether this one is worth swinging at.
 * @param {object} entity
 * @returns {boolean}
 */
function isCaveMobWorthHitting(entity) {
  return (
    entity.type === "monster" &&
    !entity.dead &&
    // The cave's people are monsters to the client
    !entity.cave?.citizen &&
    !CAVE_SIDES_TO_LEAVE.includes(entity.cave?.side) &&
    !CAVE_MOBS_TO_LEAVE.includes(entity.mtype) &&
    (entity.level ?? 0) <= caveMaxMobLevel
  );
}

/**
 * Raises Reflective Shield while the Dark Mage is in range to cast.
 * @returns {Promise<void>}
 */
async function raiseReflectionForDarkMage() {
  if (character.ctype !== "mage") return;
  if (is_on_cooldown("reflection")) return;
  if (character.mp < G.skills.reflection.mp) return;

  // Only his own reflected spell can kill him, so the lock is the cue
  const darkmage = get_nearest_monster({ type: "cave_darkmage" });
  if (!darkmage?.target || !getAlliedNames().has(darkmage.target)) return;

  // He picks mages first, but the shield belongs on whoever he took
  const victim =
    darkmage.target === character.name
      ? character
      : get_entity(darkmage.target);

  if (!victim || victim.s?.reflection) return;
  if (distance(character, victim) > G.skills.reflection.range) return;

  await use_skill("reflection", victim).catch(() => undefined);
}

/**
 * Whether a position sits inside a room.
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
 * The room holding a position, if the generated map has one there.
 * @param {object} position
 * @returns {object|undefined}
 */
function getCaveRoom(position) {
  return (parent.G.maps[character.map]?.rooms ?? []).find(
    (room) => room.bounds && isInCaveBounds(position, room.bounds),
  );
}

/**
 * Nearest cave mob worth hitting, whatever the party is already on first.
 * @returns {object|undefined}
 */
function getCaveTarget() {
  const partyTarget = getTarget();
  if (partyTarget && isCaveMobWorthHitting(partyTarget)) return partyTarget;

  // Camps sit a room apart, so vision alone would wake the neighbours
  const room = getCaveRoom(character);

  return Object.values(parent.entities)
    .filter(
      (entity) =>
        isCaveMobWorthHitting(entity) &&
        (!room || isInCaveBounds(entity, room.bounds)),
    )
    .sort((lhs, rhs) => distance(character, lhs) - distance(character, rhs))[0];
}

/**
 * The option this character votes for.
 * @param {object} choice
 * @returns {object|undefined}
 */
function pickCaveOption(choice) {
  const offered = (choice.options ?? []).filter(
    (option) => !option.unavailable,
  );

  // Walking away beats a wolf pack, so this one bends for nothing
  const allowed = offered.filter(
    (option) => !CAVE_OPTIONS_TO_REFUSE.includes(option.id),
  );
  if (!allowed.length) return undefined;

  // Amber outlives the run, so nothing in here is worth paying it with
  const affordable = allowed.filter((option) => !option.amber);

  // Last Word only drops if monsters finish him, and a saved rogue may turn
  if (choice.kind === "rogue") {
    const wait = affordable.find((option) => option.id === CAVE_ROGUE_WAIT);
    if (wait) return wait;
  }

  return (
    [...affordable].sort((lhs, rhs) => (lhs.cost ?? 0) - (rhs.cost ?? 0))[0] ??
    allowed[0]
  );
}

/**
 * Votes once per choice. A majority of the voters settles it, and the roll is
 * of accounts rather than characters.
 * @param {object} choice
 * @returns {Promise<void>}
 */
async function voteOnCaveChoice(choice) {
  if (!choice || choice.resolved || choice.id === caveRun.choiceId) return;
  if (Date.now() - caveRun.votedAt < CAVE_VOTE_RETRY_MS) return;

  const option = pickCaveOption(choice);
  if (!option) return;

  caveRun.votedAt = Date.now();

  await cave_reply(choice.id, option.id)
    .then(() => {
      caveRun.choiceId = choice.id;
    })
    .catch((error) =>
      caveLog("vote refused", {
        id: choice.id,
        option: option.id,
        why: error?.reason ?? error?.message ?? String(error),
      }),
    );
}

/**
 * Whether the shop's offer is on the skip list, which names plain items while
 * the shop prefixes its own.
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
 * Buys the shop's one item, since cave gold is worthless once the run ends.
 * @param {object} choice
 * @returns {Promise<void>}
 */
async function buyFromCaveShop(choice) {
  if (character.name !== partyMems[0]) return;

  const shop = choice?.shop;
  const room = shop?.room;
  if (room === undefined || caveRun.settled.includes(room)) return;
  if (shop.sold) {
    caveRun.settled.push(room);
    return caveLog("shop sold out", shop.name);
  }
  if (shop.nearby === false) return;
  if (isCaveItemSkipped(shop.name)) {
    caveRun.settled.push(room);
    return caveLog("shop skipped", shop.name);
  }
  if ((caveRun.attempts[room] ?? 0) >= CAVE_BUY_ATTEMPTS) return;
  if (Date.now() - caveRun.buyAt < CAVE_BUY_RETRY_MS) return;

  caveRun.buyAt = Date.now();
  caveRun.attempts[room] = (caveRun.attempts[room] ?? 0) + 1;

  caveLog("buying", { name: shop.name, price: shop.price });

  await cave_buy(room)
    .then(() => caveRun.settled.push(room))
    .catch((error) => {
      // A short purse fills again from the next chest, so it costs no attempt
      if (CAVE_BUY_RETRY_REASONS.includes(error?.reason)) {
        caveRun.attempts[room] -= 1;
        return;
      }

      console.warn("Cave shop refused us", error);
    });
}

/**
 * Chats up a traveler standing next to us, which costs the run nothing.
 * @returns {Promise<void>}
 */
async function talkToCaveTraveler() {
  if (Date.now() - caveRun.talkAt < CAVE_TALK_INTERVAL_MS) return;

  const traveler = Object.values(parent.entities).find(
    (entity) =>
      entity.cave?.citizen && distance(character, entity) < CAVE_TALK_RANGE,
  );
  if (!traveler) return;

  caveRun.talkAt = Date.now();
  await cave_talk(traveler.cave.room, traveler.id).catch(() => undefined);
}

/**
 * The closest of these.
 * @param {object[]} destinations
 * @returns {object|undefined}
 */
function getClosestCaveDestination(destinations) {
  return [...destinations].sort(
    (lhs, rhs) => distance(character, lhs) - distance(character, rhs),
  )[0];
}

/**
 * The next thing on this floor worth standing on, else the way down.
 * @returns {object|undefined}
 */
function getCaveDestination() {
  const cave = character.cave;
  const pending = (cave.objectives ?? []).filter(
    (objective) => !objective.done && objective.floor === cave.floor,
  );

  // Required ones gate the stairs, so the optional rooms wait
  const required = pending.filter((objective) => objective.required);
  if (required.length) return getClosestCaveDestination(required);

  // Cave gold dies with the run, and the purse only fills once the floor is run
  const shop = pending.find(
    (objective) =>
      objective.id.endsWith(":shop") && !caveRun.settled.includes(objective.id),
  );
  if (shop) return shop;

  // Depth outranks the optional farm rooms
  const down = (cave.doors ?? []).find((door) => door.down && !door.locked);

  return down ?? getClosestCaveDestination(pending);
}

/**
 * Takes the stairs, whose spawn only the generated map knows.
 * @param {object} door
 * @returns {Promise<void>}
 */
async function descendCaveFloor(door) {
  const spawn = parent.G.maps[character.map]?.doors?.[door.id]?.[5] ?? 0;
  await transport(door.to, spawn).catch(() => undefined);
}

/**
 * Opens the shop we are standing in, and settles one that never answers.
 * @param {object} objective
 */
async function openCaveShop(objective) {
  caveRun.shopAt[objective.id] ??= Date.now();

  if (Date.now() - caveRun.shopAt[objective.id] >= CAVE_SHOP_WAIT_MS) {
    caveRun.settled.push(objective.id);
    return caveLog("shop gave up", objective.id);
  }

  // The offer only exists once the room's own vote has begun
  if (character.cave?.choice?.shop?.room === objective.id) return;
  if (Date.now() - caveRun.shopTalkAt < CAVE_VOTE_RETRY_MS) return;

  caveRun.shopTalkAt = Date.now();

  await cave_talk(objective.id).catch((error) =>
    caveLog("shop would not open", {
      id: objective.id,
      why: error?.reason ?? error?.message ?? String(error),
    }),
  );
}

/**
 * Walks to that destination, and through it when it is the way down.
 * @returns {Promise<void>}
 */
async function walkToCaveDestination() {
  if (smart.moving || isAdvanceSmartMoving) return;

  const destination = getCaveDestination();
  if (!destination) return;

  if (distance(character, destination) > CAVE_ARRIVAL_SLACK) {
    // A refusal stops the character, so it must not repeat per tick
    if (Date.now() - caveRun.walkedAt < CAVE_WALK_RETRY_MS) return;

    // Same-map only: the next floor is not in G until we are standing in it
    const to = { map: character.map, x: destination.x, y: destination.y };

    caveRun.walkedAt = Date.now();

    // A port would land us in the mage's room, or on the mage's floor, and a
    // town warp would drop us on the floor's spawn
    await advanceSmartMove(to, {
      useScare: true,
      useTown: false,
      useMagiport: false,
      speed: CAVE_PATHING_SPEED,
    }).catch(async (error) => {
      caveLog("walk refused", {
        to: destination.name ?? destination.id,
        why: error?.message ?? String(error),
      });

      // Native pathing reads floors our graph cannot
      await smart_move(to).catch(() => undefined);
    });
    return;
  }

  if (destination.to) return descendCaveFloor(destination);

  if (destination.id?.endsWith(":shop")) await openCaveShop(destination);
}

/**
 * Fights a run out, otherwise gathers the party at Dorr and goes in.
 * @returns {Promise<object|undefined>} the outcome, if it owns this tick
 */
async function useCaveStrategy() {
  isPreparingCave = false;

  if (!hasCaveApi()) return undefined;

  const inCave = isInCave();

  if (inCave !== caveState.inside) {
    if (inCave) caveRun = freshCaveRun();
    else {
      // The run is over for everyone, not just whoever spent the visit
      caveState.checkedAt = 0;

      // Nothing further down the chain assigns one, so it cannot be left idle
      changeToNormalStrategies();
    }

    // The merchant cannot see character.cave, so leave it a deadline it can read
    set(
      "caveRun",
      inCave
        ? character.cave.expires ?? Date.now() + CAVE_RUN_MAX_MS
        : undefined,
    );

    caveState.inside = inCave;
  }

  if (inCave) {
    isPreparingCave = true;

    changeToPullStrategies();

    caveLog("inside", {
      floor: character.cave.floor,
      map: character.map,
      paused: Boolean(character.cave.paused),
      choice: character.cave.choice?.id,
    });

    // A forced vote stops the cave's own clock
    if (character.cave.paused) {
      caveLog("paused", {
        choice: character.cave.choice?.id,
        resolved: Boolean(character.cave.choice?.resolved),
        votes: character.cave.choice?.votes,
        in: Math.round((character.cave.choice?.deadline - Date.now()) / 1000),
      });

      // The tick stays ours, or the chain below walks us out
      return travelling();
    }

    raiseReflectionForDarkMage();
    talkToCaveTraveler();

    const target = getCaveTarget();
    if (target) return engage(target);

    walkToCaveDestination();

    return travelling();
  }

  // The daily resets on our own realm, and a hop would end the run
  if (!isHomeRealm())
    return caveLog("away from home realm", {
      here:
        typeof server === "undefined"
          ? undefined
          : `${server.region}${server.id}`,
    });

  const visit = await getCaveVisit();
  const resuming = canResumeCaveRun(visit);

  // A run already paid for outranks the window a fresh one would have to dodge
  if (!resuming) {
    if (isEventDueSoon())
      return caveLog("skipped — window in", {
        minutes: Math.round(msUntilHomeScheduledEvent() / 60000),
      });

    if (!visit?.available) return caveLog("no visit left", visit);
  }

  isPreparingCave = true;

  if (smart.moving || isAdvanceSmartMoving) return travelling();

  if (distance(character, DORR_SPOT) > DORR_SLACK) {
    caveLog(resuming ? "walking back to Dorr" : "walking to Dorr");
    // A pulled train at the door is a party that cannot go in
    changeToNoStrategy();
    advanceSmartMove(DORR_SPOT);
    return travelling();
  }

  // Standing at the door, waiting on the stragglers. Whoever is still inside a
  // run we are returning to cannot be at Dorr, so a return waits for nobody
  if (!resuming && !isPartyAtDorr()) {
    caveLog("at Dorr, waiting on the party");
    return travelling();
  }

  await enterCave(resuming);

  return travelling();
}

/**
 * Answers the room on its own clock. The tick cannot: it bails while smart
 * moving, and a pause refuses the move it is waiting on.
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
