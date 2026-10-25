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

async function hopToServer(serverRegion, serverIdentifier) {
  if (parent.caracAL) {
    send_cm(parent.caracAL.siblings, "loot-before-hopping");
    await midasLooting(true);
    await sleep(1000);

    Object.keys(caracALconfig.characters)
      .filter((id) => id !== character.name)
      .forEach((id) => parent.caracAL.shutdown(id));

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

setInterval(async () => {
  // An open instance is paid-for content; nothing outranks finishing it
  if (get("cryptInstance")) return;

  // The merchant is never inside, but its hop takes the party out with it
  if (get("caveRun") > Date.now()) return;

  const exemptTarget = getExemptHopTarget();

  // A live fatigue-exempt boss outranks a foreign Witch round; home's own round still holds
  const isWitchRoundHere = isWitchGathering() || canBrewWitchCipher();
  if (isWitchRoundHere && (isAtHomeServer() || !exemptTarget)) return;

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
