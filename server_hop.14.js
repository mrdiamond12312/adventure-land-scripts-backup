const HOP_SERVERS = ["US", "ASIA", "EU"];

const ignoreServer = [];

const tankableBoss = [
  // "snowman" // Commented out so newbies has time to find out about this little guy
];

const bosses = {
  grinch: { type: "grinch", threshold: 0.7, hoppable: 1 },
  icegolem: { type: "icegolem", threshold: 0.9, hoppable: 1 },
  franky: { type: "franky", threshold: 0.75, hoppable: 1 },
  mrpumpkin: { type: "mrpumpkin", threshold: 0.3, hoppable: 0.9999 },
  mrgreen: { type: "mrgreen", threshold: 0.3, hoppable: 0.9999 },
  crabxx: { type: "crabxx", threshold: 0.95, hoppable: 1 },
  dragold: { type: "dragold", threshold: 0.85, hoppable: 1 },
  pinkgoo: { type: "pinkgoo", threshold: 0.65, hoppable: 1 },
  // wabbit: { type: "wabbit", threshold: 0.5, hoppable: 1 },
};
const waitForEvent = ["wabbit"];

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

/** @returns {boolean} whether we are willing to travel to this realm at all */
function isReachableRealm(candidate) {
  return (
    !ignoreServer.includes(realmOf(candidate)) &&
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

/**
 * Ordering key; the first entry that differs decides, all ascending.
 * Tankable first, then a home-table boss on our own realm, then the HP race,
 * and last a home-table boss abroad whose drops we would be forfeiting.
 * @returns {number[]}
 */
function hopPriority(candidate) {
  const dropRank = homeDropRank(candidate);

  return [
    tankableBoss.includes(candidate.type) ? 0 : 1,
    dropRank === 0 ? 0 : 1,
    candidate.hp / G.monsters[candidate.type].hp,
    dropRank,
  ];
}

function byHopPriority(lhs, rhs) {
  const left = hopPriority(lhs);
  const right = hopPriority(rhs);

  for (let i = 0; i < left.length; i++)
    if (left[i] !== right[i]) return left[i] - right[i];

  return 0;
}

/** @returns {string[]} every boss this script knows how to chase */
function trackedBossTypes() {
  return [...tankableBoss, ...Object.keys(bosses)];
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

/** @param {string} reason */
async function hopHome(reason) {
  console.warn(`Hopping home — ${reason}`);
  set("currentParty", undefined);
  await hopToServer(HOME_SERVER.serverRegion, HOME_SERVER.serverIdentifier);
}

setInterval(async () => {
  // An open instance is paid-for content; nothing outranks finishing it
  if (get("cryptInstance")) return;

  // Should we return home?
  // When there's gonna be a boss with home server drop table in 30 mins~!
  const settleReason = shouldReturnHomeToSettle();
  if (settleReason) return hopHome(settleReason);

  if (hasSoftenedBossHere()) return;
  if (hasEventWorthStayingFor()) return;

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

  console.warn(`Hopping to ${realmOf(target)}`);
  set("currentParty", undefined);
  await hopToServer(target.serverRegion, target.serverIdentifier);
}, 10000);
