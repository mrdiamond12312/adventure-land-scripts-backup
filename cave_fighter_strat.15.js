// Cave of Many Dreams — the fighter's highest priority strategy.

/** Dorr, at the vine-covered doorway */
const DORR_SPOT = { map: "main", x: 816, y: 1200 };

/** Everyone has to be this close to Dorr to go in */
const DORR_SLACK = 160;

/** The Dark Mage is immune, and the rogue only pays out if monsters finish him */
const CAVE_MOBS_TO_LEAVE = ["cave_darkmage", "cave_rogue"];

/** Levels land at spawn, so a ceiling is the only way to duck the wolf packs */
var caveMaxMobLevel = Infinity;

/** The two effects that mark one of the five shakedowns */
const CAVE_SHAKEDOWN_EFFECTS = ["bad_fight", "bad_double"];

/** Town junk at cave prices — the broom alone is 80% of the purse */
var CAVE_ITEMS_TO_SKIP = ["broom", "tshirt0", "tshirt1", "tshirt2"];

/** Long enough for chest gold to land before the shop is asked again */
const CAVE_BUY_RETRY_MS = 20 * 1000;

/** A shop that keeps saying no is out of stock, not out of our gold */
const CAVE_BUY_ATTEMPTS = 6;

/** Chatter is free, but not every tick */
const CAVE_TALK_INTERVAL_MS = 10 * 1000;

/** What cave_talk reaches */
const CAVE_TALK_RANGE = 160;

/** How long a daily-visit answer is trusted */
const CAVE_VISIT_TTL_MS = 60 * 1000;

/** Long enough for an entry to land before it is asked for again */
const CAVE_ENTER_COOLDOWN_MS = 10 * 1000;

/** @returns {object} a run's blank slate */
function freshCaveRun() {
  return { bought: [], attempts: {}, choiceId: undefined, buyAt: 0, talkAt: 0 };
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
 * Whether this realm is ours — a character that never hops is always home.
 * @returns {boolean}
 */
function isHomeRealm() {
  return typeof isAtHomeServer !== "function" || isAtHomeServer();
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
 * Takes the party in, once, from whoever leads it.
 * @returns {Promise<void>}
 */
async function enterCave() {
  if (character.name !== partyMems[0]) return;
  if (Date.now() - caveState.enteredAt < CAVE_ENTER_COOLDOWN_MS) return;

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
    !CAVE_MOBS_TO_LEAVE.includes(entity.mtype) &&
    (entity.level ?? 0) <= caveMaxMobLevel
  );
}

/**
 * Nearest cave mob worth hitting, whatever the party is already on first.
 * @returns {object|undefined}
 */
function getCaveTarget() {
  const partyTarget = getTarget();
  if (partyTarget && isCaveMobWorthHitting(partyTarget)) return partyTarget;

  return Object.values(parent.entities)
    .filter(isCaveMobWorthHitting)
    .sort((lhs, rhs) => distance(character, lhs) - distance(character, rhs))[0];
}

/**
 * Cheapest way out that spends no Amber, which outlives the run.
 * @param {object[]} options
 * @returns {object|undefined}
 */
function cheapestCaveOption(options) {
  return options
    .filter((option) => !option.amber)
    .sort((lhs, rhs) => (lhs.cost ?? 0) - (rhs.cost ?? 0))[0];
}

/**
 * The option this character votes for.
 * @param {object} choice
 * @returns {object|undefined}
 */
function pickCaveOption(choice) {
  const options = (choice.options ?? []).filter((option) => !option.unavailable);
  if (!options.length) return undefined;

  // Amber outlives the run, so nothing in here is worth paying it with
  const affordable = options.filter((option) => !option.amber);
  const leave = affordable.find((option) => option.effect === "leave");
  const offer = affordable.find((option) => option.offer);
  const fallback = leave ?? affordable[0] ?? options[0];

  // A shakedown sells its own way out
  if (options.some((option) => CAVE_SHAKEDOWN_EFFECTS.includes(option.effect)))
    return (
      cheapestCaveOption(affordable.filter((it) => it.effect === "pay")) ??
      fallback
    );

  // Last Word only drops if monsters finish him, and a saved rogue may turn
  if (choice.kind === "rogue")
    return affordable.find((option) => option.effect === "watch") ?? fallback;

  if (choice.group === "positive") return offer ?? fallback;
  if (choice.group === "bad") return cheapestCaveOption(affordable) ?? fallback;

  return leave ?? offer ?? fallback;
}

/**
 * Votes once per choice, since three identical votes settle it outright.
 * @param {object} choice
 * @returns {Promise<void>}
 */
async function voteOnCaveChoice(choice) {
  if (!choice || choice.resolved || choice.id === caveRun.choiceId) return;

  const option = pickCaveOption(choice);
  if (!option) return;

  caveRun.choiceId = choice.id;
  await cave_reply(choice.id, option.id).catch((error) =>
    console.warn("Cave vote refused", error),
  );
}

/**
 * Buys the shop's one item, since cave gold is worthless once the run ends.
 * @param {object} choice
 * @returns {Promise<void>}
 */
async function buyFromCaveShop(choice) {
  if (character.name !== partyMems[0]) return;

  const room = choice?.shop?.room;
  if (room === undefined || caveRun.bought.includes(room)) return;
  if (CAVE_ITEMS_TO_SKIP.includes(choice.shop.item)) return;
  if ((caveRun.attempts[room] ?? 0) >= CAVE_BUY_ATTEMPTS) return;
  if (Date.now() - caveRun.buyAt < CAVE_BUY_RETRY_MS) return;

  caveRun.buyAt = Date.now();
  caveRun.attempts[room] = (caveRun.attempts[room] ?? 0) + 1;

  // Only the sale is final — a short purse fills again from the next chest
  await cave_buy(room)
    .then(() => caveRun.bought.push(room))
    .catch((error) => console.warn("Cave shop refused us", error));
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
 * Fights a run out, otherwise gathers the party at Dorr and goes in.
 * @returns {Promise<object|undefined>} the outcome, if it owns this tick
 */
async function useCaveStrategy() {
  if (!hasCaveApi()) return undefined;

  const inCave = isInCave();
  if (inCave && !caveState.inside) caveRun = freshCaveRun();
  caveState.inside = inCave;

  if (inCave) {
    if (character.cave.choice) {
      await voteOnCaveChoice(character.cave.choice);
      await buyFromCaveShop(character.cave.choice);
    }

    // A forced vote stops the cave's own clock
    if (character.cave.paused) return travelling();

    talkToCaveTraveler();

    changeToNormalStrategies();
    return engage(getCaveTarget());
  }

  // The daily resets on our own realm, and a hop would end the run
  if (!isHomeRealm()) return undefined;

  const visit = await getCaveVisit();
  if (!visit?.available) return undefined;

  if (smart.moving || isAdvanceSmartMoving) return travelling();

  if (distance(character, DORR_SPOT) > DORR_SLACK) {
    changeToNormalStrategies();
    advanceSmartMove(DORR_SPOT);
    return travelling();
  }

  // Standing at the door, waiting on the stragglers
  if (!isPartyAtDorr()) return travelling();

  await enterCave();

  return travelling();
}
