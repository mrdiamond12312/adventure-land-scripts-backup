const HOP_SERVERS = ["US", "ASIA", "EU"];

const ignoreServer = ["ASIAI", "ASIAII"];

const tankableBoss = [
  // "snowman" // Commented out so newbies has time to find out about this little guy
];

const bosses = {
  grinch: { type: "grinch", threshold: 0.7, hoppable: 1 },
  icegolem: { type: "icegolem", threshold: 0.9, hoppable: 1 },
  franky: { type: "franky", threshold: 0.75, hoppable: 1 },
  // mrpumpkin: { type: "mrpumpkin", threshold: 0.3, hoppable: 0.9999 },
  // mrgreen: { type: "mrgreen", threshold: 0.3, hoppable: 0.9999 },
  crabxx: { type: "crabxx", threshold: 0.95, hoppable: 1 },
  dragold: { type: "dragold", threshold: 0.85, hoppable: 1 },
  pinkgoo: { type: "pinkgoo", threshold: 0.65, hoppable: 1 },
  // wabbit: { type: "wabbit", threshold: 0.5, hoppable: 1 },
  horseman: { type: "horseman", hoppable: 1, fatigueExempt: true },
};
const waitForEvent = ["wabbit"];

/** Bosses chased on any realm, ignoreServer included */
const fatigueExemptBosses = Object.keys(bosses).filter(
  (name) => bosses[name].fatigueExempt,
);

/** Shuts every other configured character down; deployCharacters brings the roster back on our realm */
function shutdownOtherCharacters() {
  Object.keys(caracALconfig.characters)
    .filter((id) => id !== character.name)
    .forEach((id) => parent.caracAL.shutdown(id));
}

async function hopToServer(serverRegion, serverIdentifier) {
  if (parent.caracAL) {
    send_cm(parent.caracAL.siblings, "loot-before-hopping");
    await midasLooting(true);
    await sleep(1000);

    set(PARTY_AWAY_LS_KEY, undefined);
    shutdownOtherCharacters();

    parent.caracAL.deploy(null, `SR_${serverRegion}${serverIdentifier}`);
  } else {
    send_cm(partyMems, "loot-before-hopping");
    await midasLooting(true);
    await sleep(1000);

    change_server(serverRegion, serverIdentifier);
  }
}

/** @returns {string} the realm a sighting sits on, e.g. "USII" */
function realmOf(candidate) {
  return `${candidate.serverRegion}${candidate.serverIdentifier}`;
}

/**
 * @param {boolean} [isExempt] - a fatigue-exempt boss also goes to ignoreServer realms
 * @returns {boolean} whether we are willing to travel to this realm at all
 */
function isReachableRealm(candidate, isExempt = false) {
  return (
    (isExempt || !ignoreServer.includes(realmOf(candidate))) &&
    candidate.serverIdentifier !== "PVP" &&
    HOP_SERVERS.includes(candidate.serverRegion)
  );
}

/**
 * A tracked boss earns the trip once it is softened enough and someone is
 * holding it, or straight away when its `hoppable` is 1.
 * @returns {boolean}
 */
function isWorthHopping(candidate) {
  if (tankableBoss.includes(candidate.type)) return true;

  const boss = bosses[candidate.type];
  if (!boss) return false;
  if (boss.hoppable === 1) return true;

  const ceiling = boss.hoppable * G.monsters[candidate.type].hp;
  return candidate.hp < ceiling && Boolean(candidate.target);
}

/** @returns {boolean} whether this sighting is somewhere we would actually go */
function isHopCandidate(candidate) {
  return isReachableRealm(candidate) && isWorthHopping(candidate);
}

/** @returns {number[]} ascending sort key */
function hopPriority(candidate) {
  return [
    tankableBoss.includes(candidate.type) ? 0 : 1,
    homeDropRank(candidate),
    candidate.hp / G.monsters[candidate.type].hp,
  ];
}

function byHopPriority(lhs, rhs) {
  const left = hopPriority(lhs);
  const right = hopPriority(rhs);

  for (let i = 0; i < left.length; i++)
    if (left[i] !== right[i]) return left[i] - right[i];

  return 0;
}

/** @returns {string[]} every boss the HP race chases; fatigue-exempt ones have their own hop */
function trackedBossTypes() {
  return [
    ...tankableBoss,
    ...Object.keys(bosses).filter((name) => !bosses[name].fatigueExempt),
  ];
}

/** @returns {boolean} whether a boss here is already softened enough to stay for */
function hasSoftenedBossHere() {
  return Object.keys(bosses).some((boss) => {
    const state = server.status[boss];
    if (!state) return false;

    const engaged =
      state.target || bosses[boss].hoppable === 1 || boss === "pinkgoo";

    return (
      engaged && state.hp < (bosses[boss].threshold ?? 0.93) * state.max_hp
    );
  });
}

/** @returns {boolean} whether something here outranks anything another realm offers */
function hasEventWorthStayingFor() {
  const brawling =
    (server.status.goobrawl ||
      server.status.abtesting ||
      canAnniversaryVisit()) &&
    !character.s.hopsickness;

  const liveHere = [...tankableBoss, ...waitForEvent].some(
    (name) => server.status[name]?.live,
  );

  return Boolean(brawling || liveHere);
}

/** @returns {Object|undefined} the live fatigue-exempt boss with the least hp left */
function getExemptHopTarget() {
  const hpFraction = ({ type, hp, max_hp = G.monsters[type].hp }) =>
    (hp ?? max_hp) / max_hp;

  return getRealmData()
    ?.query({ types: fatigueExemptBosses })
    .filter((candidate) => isReachableRealm(candidate, true))
    .sort((lhs, rhs) => hpFraction(lhs) - hpFraction(rhs))[0];
}

/** Foreign events worth landing early for, so hop sickness wears off before they start */
const EARLY_HOP_EVENTS = ["witchcipher"];

/** How long before a foreign event we land on its realm */
const EARLY_HOP_LEAD_MS = 14 * 60_000;

const HOP_SICKNESS_MS = G.conditions.hopsickness?.duration ?? 720_000;

/** Overrun past an event's own length before the party is free to head home */
const EVENT_STAY_SLACK_MS = 60_000;

const WITCH_DAY_REFRESH_MS = 5 * 60_000;

/** The account's Witch day from witch_cipher_info(): mixes_left, and server once it has a claim */
let witchDay = { at: 0 };

/** Refreshes witchDay in the background; character.witchcipher only exists during a round here */
async function refreshWitchDay() {
  if (Date.now() - witchDay.at < WITCH_DAY_REFRESH_MS) return;
  witchDay.at = Date.now();

  const info = await witch_cipher_info().catch((e) => console.warn(e));
  if (info) witchDay = { ...info, at: Date.now() };
}

/** @returns {boolean} whether the party would brew at `realm`'s Witch round rather than leave after gathering */
function canBrewWitchAt(realm) {
  refreshWitchDay();
  return (
    witchDay.mixes_left > 0 &&
    (!witchDay.server || witchDay.server === realm) &&
    !hasHomeWitchRoundToday()
  );
}

/** Hop time budgeted ahead of home's brewing stage */
const WITCH_RETURN_HOP_MS = 60_000;

/** Least time abroad worth skipping home's gathering for */
const WITCH_SKIP_MIN_STAY_MS = 5 * 60_000;

/** @returns {number} when the party hops home for this round's brewing, now when the round's timing is unknown */
function getWitchReturnAt(cipher) {
  const gatherEnd =
    cipher.gather_end ??
    cipher.start + (G.events.witchcipher?.gathering ?? 0) * 1000;
  if (!Number.isFinite(gatherEnd)) return Date.now();
  return gatherEnd - WITCH_STAGE_LEAD_MS - WITCH_RETURN_HOP_MS;
}

/** @returns {boolean} whether the merchant's own stock already covers the day's remaining mixes */
function hasWitchStockForDay() {
  const needed = (character.witchcipher?.mixes_left ?? 0) * WITCH_SLOTS;
  const stock = get("witchStock") ?? {};
  return WITCH_INGREDIENTS.every(
    (kind) => stock[kind] - WITCH_ELIXIR_RESERVE >= needed,
  );
}

/** @returns {boolean} whether home's gathering can be skipped for a fatigue-exempt boss, back in time to brew */
function canSkipHomeWitchGathering() {
  const cipher = server.status.witchcipher;
  return (
    isAtHomeServer() &&
    isWitchGathering(cipher) &&
    getWitchReturnAt(cipher) - Date.now() >= WITCH_SKIP_MIN_STAY_MS &&
    hasWitchStockForDay()
  );
}

/** @returns {boolean} whether we are abroad while home's brewing is about to open, with mixes left for it */
function isHomeWitchBrewDue() {
  if (isAtHomeServer()) return false;

  const cipher = getHomeRealmStatus()?.witchcipher;
  if (!cipher?.live || Date.now() >= cipher.end) return false;
  if (Date.now() < getWitchReturnAt(cipher)) return false;

  refreshWitchDay();
  return (
    witchDay.mixes_left > 0 &&
    (!witchDay.server || witchDay.server === getHomeServer())
  );
}

/** @returns {number} ms the party spends on a foreign event once it starts */
function getForeignEventStayMs(event, realm) {
  const { duration = 0, gathering = duration } = G.events[event] ?? {};
  const isGatherOnly = event === "witchcipher" && !canBrewWitchAt(realm);
  return (isGatherOnly ? gathering : duration) * 1000 + EVENT_STAY_SLACK_MS;
}

/** @returns {boolean} whether, by `by`, home runs an early-hop event of its own, or a fatigue-exempt boss is due on any realm we would chase it to */
function hasClashingEventBy(by) {
  const realmData = getRealmData();
  const isDue = (schedule, events) =>
    getLineup(schedule, events).some(({ at }) => at <= by);

  if (isDue(getHomeRealmStatus()?.schedule, EARLY_HOP_EVENTS)) return true;
  return Object.entries(realmData?.realms ?? {}).some(
    ([key, { region, name }]) =>
      isReachableRealm({ serverRegion: region, serverIdentifier: name }, true) &&
      isDue(realmData.status(key)?.schedule, fatigueExemptBosses),
  );
}

/** @returns {Object|undefined} the foreign event to land early for: far enough out to shed hop sickness, back home before the next scheduled home window */
function getEarlyHopTarget() {
  const realmData = getRealmData();
  if (!realmData) return;

  const now = Date.now();
  const untilHomeWindow = msUntilHomeScheduledEvent();
  const targets = [];
  for (const key of Object.keys(realmData.realms)) {
    if (key === getHomeServer()) continue;

    const { region, name } = realmData.realms[key];
    const realm = { serverRegion: region, serverIdentifier: name };
    if (!isReachableRealm(realm)) continue;

    for (const { event, status, at } of getLineup(
      realmData.status(key)?.schedule,
      EARLY_HOP_EVENTS,
    )) {
      const until = at - now;
      if (status !== "scheduled") continue;
      if (until < HOP_SICKNESS_MS || until > EARLY_HOP_LEAD_MS) continue;

      const stayMs = getForeignEventStayMs(event, key);
      if (until + stayMs + HOME_RETURN_LEAD_MS > untilHomeWindow) continue;
      if (hasClashingEventBy(at + stayMs)) continue;

      targets.push({ ...realm, type: event, at });
    }
  }
  return targets.sort((lhs, rhs) => lhs.at - rhs.at)[0];
}

/** @returns {boolean} whether an early-hop event here is about to start or running */
function hasEarlyHopEventHere() {
  const now = Date.now();
  return getLineup(server.status.schedule, EARLY_HOP_EVENTS).some(
    ({ status, at }) =>
      status === "live" ||
      (status === "scheduled" && at - now <= EARLY_HOP_LEAD_MS && at > now),
  );
}

async function hopToCandidate(target) {
  console.warn(`Hopping to ${realmOf(target)}`);
  set("currentParty", undefined);
  await hopToServer(target.serverRegion, target.serverIdentifier);
}

/** @param {string} reason */
async function hopHome(reason) {
  console.warn(`Hopping home — ${reason}`);
  set("currentParty", undefined);
  await hopToServer(HOME_SERVER.serverRegion, HOME_SERVER.serverIdentifier);
}

/** @returns {boolean} whether this character can change realm without taking the fighters along */
function canHopAlone() {
  return !!parent.caracAL && character.ctype === "merchant";
}

/** Moves only this character to `realm`; the fighters stay where they are */
async function hopAlone(realm, reason) {
  console.warn(`Hopping to ${realm} alone — ${reason}`);
  await midasLooting(true);
  parent.caracAL.deploy(null, `SR_${realm}`);
}

/** @returns {string[]} the roster `type`'s preset fields on `realm`, leaving our role globals as they were */
function getRealmRoster(type, realm) {
  const roles = { RANGER, HEALER };
  const members = getPresetMembers(
    DYNAMIC_PARTY_PRESETS[type] ?? DYNAMIC_PARTY_PRESETS.default,
    realm,
  );
  ({ RANGER, HEALER } = roles);
  return members;
}

/** Deploys `target`'s roster for its realm onto it without moving this character */
async function sendPartyTo(target) {
  const realm = realmOf(target);
  const members = getRealmRoster(target.type, realm);
  console.warn(`Sending ${members.join(", ")} to ${realm}`);

  send_cm(parent.caracAL.siblings, "loot-before-hopping");
  await sleep(1000);
  set(PARTY_AWAY_LS_KEY, realm);

  Object.keys(caracALconfig.characters)
    .filter((id) => id !== character.name && !members.includes(id))
    .forEach((id) => parent.caracAL.shutdown(id));

  // The server confirms one login at a time per account
  for (const id of members) {
    parent.caracAL.deploy(id, `SR_${realm}`, caracALconfig.characters[id].script);
    await sleep(1000);
  }
}

/** Brings the fighters left abroad back to our realm */
async function recallParty(reason) {
  console.warn(`Recalling the party — ${reason}`);
  send_cm(parent.caracAL.siblings, "loot-before-hopping");
  await sleep(1000);
  set(PARTY_AWAY_LS_KEY, undefined);
  shutdownOtherCharacters();
}

setInterval(async () => {
  // An open instance is paid-for content; nothing outranks finishing it
  if (get("cryptInstance")) return;

  // The merchant is never inside, but its hop takes the party out with it
  if (get("caveRun") > Date.now()) return;

  if (isHomeWitchBrewDue()) {
    const reason = "home's Witch brewing is about to open";
    if (!canHopAlone()) return hopHome(reason);

    set(PARTY_AWAY_LS_KEY, getCurrentServer());
    return hopAlone(getHomeServer(), reason);
  }

  const exemptTarget = getExemptHopTarget();
  const isWitchRoundHere = isWitchGathering() || canBrewWitchCipher();

  // Fighters left abroad follow the exempt boss, even while we brew, and come back once none is left
  const partyRealm = get(PARTY_AWAY_LS_KEY);
  if (partyRealm) {
    const targetRealm = exemptTarget && realmOf(exemptTarget);
    if (!targetRealm || targetRealm === getCurrentServer())
      return recallParty(`nothing left to chase on ${partyRealm}`);

    if (isWitchRoundHere) {
      if (targetRealm !== partyRealm) return sendPartyTo(exemptTarget);
      return;
    }
    if (targetRealm === partyRealm) {
      set(PARTY_AWAY_LS_KEY, undefined);
      return hopAlone(partyRealm, "rejoining the party");
    }
  }

  // A live fatigue-exempt boss outranks a foreign Witch round, and home's gathering once stock covers the brew
  const mayLeaveWitchRound =
    exemptTarget && (!isAtHomeServer() || canSkipHomeWitchGathering());
  if (isWitchRoundHere && !mayLeaveWitchRound) return;

  if (exemptTarget) {
    if (realmOf(exemptTarget) === getCurrentServer()) return;
    return hopToCandidate(exemptTarget);
  }
  if (fatigueExemptBosses.some((name) => server.status[name]?.live)) return;

  const cipher = server.status.witchcipher;
  if (!isAtHomeServer() && cipher?.live && Date.now() < cipher.end)
    return hopHome("the Witch's gathering is over");

  // The early hop already budgeted every scheduled home window
  if (!isAtHomeServer() && hasEarlyHopEventHere()) return;

  // Should we return home?
  // When there's gonna be a boss with home server drop table in 30 mins~!
  const settleReason = shouldReturnHomeToSettle();
  if (settleReason) return hopHome(settleReason);

  if (hasSoftenedBossHere()) return;
  if (hasEventWorthStayingFor()) return;

  const earlyTarget = getEarlyHopTarget();
  if (earlyTarget) return hopToCandidate(earlyTarget);

  const holdReason = shouldHoldAtHome();
  if (holdReason) {
    console.warn(`Staying home — ${holdReason}`);
    return;
  }

  const realmData = getRealmData();
  if (!realmData) return;

  const candidates = realmData
    .query({ types: trackedBossTypes() })
    .filter(isHopCandidate)
    .sort(byHopPriority);

  if (!candidates.length) {
    if (!isAtHomeServer()) await hopHome("nothing left to chase");
    return;
  }

  console.warn(
    candidates.map(
      (candidate) => `${realmOf(candidate)} ${candidate.type} ${candidate.hp}`,
    ),
  );

  const target = candidates[0];
  if (realmOf(target) === getCurrentServer()) return;

  await hopToCandidate(target);
}, 10000);
