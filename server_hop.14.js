/** Regions the hop loop travels to; PvP realms are always skipped */
const HOP_REGIONS = ["US", "ASIA", "EU"];

/** Realms we never hop to, e.g. "ASIAI", unless a HOP_BOSSES entry gives its own `ignoredRealms` */
const IGNORED_REALMS = [];

/** Bosses hopped to at first sighting, ranked first, and stayed for while live here */
const TANKABLE_BOSSES = [
  // "snowman" // Commented out so newbies has time to find out about this little guy
];

/**
 * One boss the hop loop chases.
 * @typedef {Object} HopBoss
 * @property {string} type - monster id
 * @property {number} hoppable - 1 hops at first sighting; below 1, only once someone holds it under that share of max hp
 * @property {number} [threshold] - a held one here below this share of max hp keeps us on the realm (0.93 when unset)
 * @property {boolean} [fatigueExempt] - hopped to ahead of the race and the home-window checks
 * @property {string[]} [ignoredRealms] - replaces IGNORED_REALMS for this boss; [] chases it everywhere
 */

/** @type {Object<string, HopBoss>} the bosses the hop loop chases, by monster id */
const HOP_BOSSES = {
  grinch: { type: "grinch", threshold: 0.7, hoppable: 1 },
  icegolem: { type: "icegolem", threshold: 0.9, hoppable: 1 },
  franky: { type: "franky", threshold: 0.75, hoppable: 1 },
  // mrpumpkin: { type: "mrpumpkin", threshold: 0.3, hoppable: 0.9999 },
  // mrgreen: { type: "mrgreen", threshold: 0.3, hoppable: 0.9999 },
  crabxx: { type: "crabxx", threshold: 0.95, hoppable: 1 },
  dragold: { type: "dragold", threshold: 0.85, hoppable: 1 },
  pinkgoo: { type: "pinkgoo", threshold: 0.65, hoppable: 1 },
  // wabbit: { type: "wabbit", threshold: 0.5, hoppable: 1 },
  horseman: {
    type: "horseman",
    hoppable: 1,
    fatigueExempt: true,
    ignoredRealms: [],
  },
};

/** Bosses hopped to ahead of the race and the home-window checks */
const FATIGUE_EXEMPT_BOSSES = Object.keys(HOP_BOSSES).filter(
  (name) => HOP_BOSSES[name].fatigueExempt,
);

/**
 * A realm to stand on or hop to; HOME_SERVER has this shape.
 * @typedef {Object} HopRealm
 * @property {string} serverRegion - e.g. "EU"
 * @property {string} serverIdentifier - e.g. "II"
 */

/**
 * A live boss on some realm, from ServerRealmData.query.
 * @typedef {HopRealm & {type: string, hp?: number, max_hp?: number, target?: string}} HopSighting
 */

/**
 * What every rule sees, built once per tick.
 * @typedef {Object} HopContext
 * @property {ServerRealmData} [realmData] - undefined until the realm sockets exist
 * @property {HopSighting[]} candidates - the boss race's sightings, best first
 * @property {boolean} isIdle - no boss in the race is worth chasing
 * @property {HopSighting} [exemptTarget] - the live fatigue-exempt boss to chase
 * @property {boolean} isHome
 * @property {boolean} isWitchRoundHere - a Witch round here is gathering, or brewing wants us here
 */

/**
 * A rule's verdict, made by stayPut / hopTo / hopAloneTo / pointPartyAt.
 * @typedef {Object} HopDecision
 * @property {"stay"|"hop"|"hopAlone"|"point"} action
 * @property {HopRealm} [target]
 * @property {string} reason
 */

/**
 * One step of the hop loop's priority list.
 * @typedef {Object} HopRule
 * @property {string} name
 * @property {boolean} enabled - false skips the rule
 * @property {boolean} [onlyWhenIdle] - skipped while the boss race has a candidate
 * @property {Object} [config] - the rule's own settings, handed to `decide`
 * @property {(ctx: HopContext, config: Object) => HopDecision|undefined} decide - nothing passes to the next rule
 */

/** @type {HopRule[]} the hop loop's priorities, top first; the first rule to decide wins the tick */
const HOP_RULES = [
  /** A cave run holds every move; an open crypt waits for the party to come home */
  {
    name: "instance",
    enabled: true,
    decide: () => {
      if (get("caveRun") > Date.now()) return stayPut("cave run under way");
    },
  },
  /** The merchant alone goes where the day's mixes are worth most: a stalled narrow board, else the day's last round; the fighters stay */
  {
    name: "witchAlone",
    enabled: true,
    decide: () => {
      if (!canHopAlone()) return;
      const target = getWitchHopTarget();
      if (target) return hopAloneTo(target.realm, target.reason);
    },
  },
  /** While the merchant brews alone, keeps the fighters on their boss and rejoins them after */
  {
    name: "splitParty",
    enabled: true,
    decide: ({ exemptTarget, candidates, isWitchRoundHere }) =>
      steerSplitParty(exemptTarget ?? candidates[0], isWitchRoundHere),
  },
  /** Chases a live fatigue-exempt boss (Horseman), or stays with one here */
  {
    name: "exemptBoss",
    enabled: true,
    decide: ({ exemptTarget }) => {
      if (exemptTarget)
        return isOnCurrentRealm(exemptTarget)
          ? stayPut(`${exemptTarget.type} here`)
          : hopTo(exemptTarget, exemptTarget.type);
      if (FATIGUE_EXEMPT_BOSSES.some((name) => server.status[name]?.live))
        return stayPut("fatigue-exempt boss live here");
    },
  },
  /** The Witch, once no boss is worth chasing: a round here, or a foreign one about to start */
  {
    name: "witch",
    enabled: true,
    onlyWhenIdle: true,
    decide: ({ isHome, isWitchRoundHere }) => {
      if (isWitchRoundHere) return stayPut("Witch round here");
      if (isHome) return;

      const cipher = server.status.witchcipher;
      if (cipher?.live && Date.now() < cipher.end)
        return hopTo(HOME_SERVER, "the Witch's gathering is over");
      // The early hop already budgeted every scheduled home window
      if (hasEarlyHopEventHere(getHopRule("earlyHop").config))
        return stayPut("waiting for the Witch round here");
    },
  },
  /** Goes home early enough for realm fatigue to clear before a home window */
  {
    name: "settleHome",
    enabled: true,
    decide: () => {
      const reason = shouldReturnHomeToSettle();
      if (reason) return hopTo(HOME_SERVER, reason);
    },
  },
  /** Stays with a boss here that is already worn down */
  {
    name: "softenedBoss",
    enabled: true,
    decide: () => {
      if (hasSoftenedBossHere()) return stayPut("softened boss here");
    },
  },
  /** Stays for a brawl, a tankable boss, or a `waitFor` event live here */
  {
    name: "eventHere",
    enabled: true,
    config: {
      /** Events worth staying on this realm for while they are live here */
      waitFor: ["wabbit"],
    },
    decide: (ctx, config) => {
      if (hasEventWorthStayingFor(config)) return stayPut("event here");
    },
  },
  /** Lands on a foreign event early enough to shed hop sickness, once no boss is worth chasing */
  {
    name: "earlyHop",
    enabled: true,
    onlyWhenIdle: true,
    config: {
      /** Foreign events worth landing early for */
      events: ["witchcipher"],
      /** How long before the event we land */
      leadMs: 14 * 60_000,
      /** Cancel the trip when one is live, or starts any time from now until we would be back, on any realm we would chase it to */
      clashingBosses: ["crabxx"],
    },
    decide: (ctx, config) => {
      const target = getEarlyHopTarget(config);
      if (target) return hopTo(target, `landing early for ${target.type}`);
    },
  },
  /** Stays home for a live home-table boss or a home window coming up */
  {
    name: "holdHome",
    enabled: true,
    decide: () => {
      const reason = shouldHoldAtHome();
      if (reason) return stayPut(reason);
    },
  },
  /** Hops to a rare mob the observers spotted on any realm, held by anyone or not */
  {
    name: "snipe",
    enabled: true,
    config: {
      /** Rare mobs worth a hop; each must be in SPECIAL_MOB_IDS for the observers to record it */
      mobs: ["cutebee", "goldenbat", "mimic"],
      /** Sightings older than this are skipped; the spotlight moves on every ~13s */
      maxAgeMs: 2 * 60_000,
      /** Expected time abroad per mob; the trip plus 30 min of realm fatigue must end before home's next window */
      stayMs: {
        cutebee: 5 * 60_000,
        goldenbat: 8 * 60_000,
        mimic: 20 * 60_000,
      },
    },
    decide: (ctx, config) => {
      const target = getSnipeTarget(config);
      if (!target) return;

      if (!isOnCurrentRealm(target))
        return hopTo(target, `sniping ${target.type}`);
      shareSnipeSighting(target);
      return stayPut(`sniping ${target.type} here`);
    },
  },
  /** Chases the race's best sighting: tankable first, then home drops, then least hp left */
  {
    name: "bossRace",
    enabled: true,
    decide: ({ realmData, candidates: [target] }) => {
      if (!realmData) return stayPut("realm data not ready");
      if (!target) return;

      const hpLeft = Math.round((100 * target.hp) / G.monsters[target.type].hp);
      const reason = `${target.type} at ${hpLeft}%`;
      return isOnCurrentRealm(target) ? stayPut(reason) : hopTo(target, reason);
    },
  },
  /** Nothing left anywhere: back home */
  {
    name: "goHome",
    enabled: true,
    decide: ({ isHome }) => {
      if (!isHome) return hopTo(HOME_SERVER, "nothing left to chase");
    },
  },
];

/**
 * The hop rule called `name`, for its config or `enabled` switch.
 * @param {string} name
 * @returns {HopRule}
 */
function getHopRule(name) {
  return HOP_RULES.find((rule) => rule.name === name);
}

/** Set once a hop is under way */
let isLeaving = false;

/**
 * Moves the whole party: loots, points the plan at the realm, then leaves.
 * @param {string} serverRegion - e.g. "EU"
 * @param {string} serverIdentifier - e.g. "II"
 */
async function hopToServer(serverRegion, serverIdentifier) {
  isLeaving = true;
  if (parent.caracAL) {
    send_cm(parent.caracAL.siblings, "loot-before-hopping");
    await midasLooting(true);
    await sleep(1000);

    setPartyRealm(serverRegion, serverIdentifier);
    markDeployed(character.name);
    parent.caracAL.deploy(null, `SR_${serverRegion}${serverIdentifier}`);
  } else {
    send_cm(partyMems, "loot-before-hopping");
    await midasLooting(true);
    await sleep(1000);

    setPartyRealm(serverRegion, serverIdentifier);
    change_server(serverRegion, serverIdentifier);
  }
}

/**
 * Moves only this character; the fighters keep the plan's realm.
 * @param {string} serverRegion - e.g. "EU"
 * @param {string} serverIdentifier - e.g. "II"
 */
async function hopAlone(serverRegion, serverIdentifier) {
  isLeaving = true;
  await midasLooting(true);

  if (parent.caracAL) {
    markDeployed(character.name);
    parent.caracAL.deploy(null, `SR_${serverRegion}${serverIdentifier}`);
  } else change_server(serverRegion, serverIdentifier);
}

/** @returns {boolean} whether this character can change realm without taking the fighters along */
function canHopAlone() {
  if (!isMerchant()) return false;
  if (parent.caracAL) return true;

  const runners = get_active_characters();
  return partyMems.every((id) => !runners[id]);
}

/** Keeps our fresh plan's realm, else points the fighters at ours */
function refreshPartyPlan() {
  const plan = getPartyPlan();
  if (plan?.by === character.name) setPartyRealm(plan.region, plan.id);
  else setPartyRealm(server.region, server.id);
}

/**
 * Whether a tracked boss earns the trip: at once when its `hoppable` is 1, else once someone holds it under that share of max hp.
 * @param {HopSighting} candidate
 * @returns {boolean}
 */
function isWorthHopping(candidate) {
  if (TANKABLE_BOSSES.includes(candidate.type)) return true;

  const boss = HOP_BOSSES[candidate.type];
  if (!boss) return false;
  if (boss.hoppable === 1) return true;

  const ceiling = boss.hoppable * G.monsters[candidate.type].hp;
  return candidate.hp < ceiling && Boolean(candidate.target);
}

/**
 * Whether this sighting is somewhere we would actually go.
 * @param {HopSighting} candidate
 * @returns {boolean}
 */
function isHopCandidate(candidate) {
  return (
    isReachableRealm(candidate, candidate.type) && isWorthHopping(candidate)
  );
}

/**
 * The race's ascending sort key: tankable first, then home drops, then least hp left.
 * @param {HopSighting} candidate
 * @returns {number[]}
 */
function hopPriority(candidate) {
  return [
    TANKABLE_BOSSES.includes(candidate.type) ? 0 : 1,
    homeDropRank(candidate),
    candidate.hp / G.monsters[candidate.type].hp,
  ];
}

/**
 * Sort comparator over hopPriority.
 * @param {HopSighting} lhs
 * @param {HopSighting} rhs
 * @returns {number}
 */
function byHopPriority(lhs, rhs) {
  const left = hopPriority(lhs);
  const right = hopPriority(rhs);

  for (let i = 0; i < left.length; i++)
    if (left[i] !== right[i]) return left[i] - right[i];

  return 0;
}

/** @returns {string[]} every boss the race chases; fatigue-exempt ones have their own rule */
function trackedBossTypes() {
  return [
    ...TANKABLE_BOSSES,
    ...Object.keys(HOP_BOSSES).filter(
      (name) => !HOP_BOSSES[name].fatigueExempt,
    ),
  ];
}

/** @returns {boolean} whether a boss here is already softened enough to stay for */
function hasSoftenedBossHere() {
  return Object.keys(HOP_BOSSES).some((boss) => {
    const state = server.status[boss];
    if (!state) return false;

    const engaged =
      state.target || HOP_BOSSES[boss].hoppable === 1 || boss === "pinkgoo";

    return (
      engaged && state.hp < (HOP_BOSSES[boss].threshold ?? 0.93) * state.max_hp
    );
  });
}

/**
 * Whether something here outranks anything another realm offers.
 * @param {{waitFor: string[]}} config - the eventHere rule's
 * @returns {boolean}
 */
function hasEventWorthStayingFor({ waitFor }) {
  const brawling =
    (server.status.goobrawl ||
      server.status.abtesting ||
      canAnniversaryVisit()) &&
    !character.s.hopsickness;

  const liveHere = [...TANKABLE_BOSSES, ...waitFor].some(
    (name) => server.status[name]?.live,
  );

  return Boolean(brawling || liveHere);
}

/** @returns {HopSighting|undefined} the live fatigue-exempt boss, home first, then least hp left */
function getExemptHopTarget() {
  const awayFromHome = (candidate) =>
    realmOf(candidate) === getHomeServer() ? 0 : 1;
  const hpFraction = ({ type, hp, max_hp = G.monsters[type].hp }) =>
    (hp ?? max_hp) / max_hp;

  return getRealmData()
    ?.query({ types: FATIGUE_EXEMPT_BOSSES })
    .filter((candidate) => isReachableRealm(candidate, candidate.type))
    .sort(
      (lhs, rhs) =>
        awayFromHome(lhs) - awayFromHome(rhs) ||
        hpFraction(lhs) - hpFraction(rhs),
    )[0];
}

/** @returns {HopSighting[]} the race's sightings, best first */
function getRaceCandidates() {
  return (getRealmData()?.query({ types: trackedBossTypes() }) ?? [])
    .filter(isHopCandidate)
    .sort(byHopPriority);
}

/**
 * Steers the fighters while the party is split: onto the boss they chase, home while the merchant brews abroad, else back together.
 * @param {HopSighting} [target] - the exempt boss, else the race's best sighting
 * @param {boolean} isWitchRoundHere
 * @returns {HopDecision|undefined} nothing when the party is not split
 */
function steerSplitParty(target, isWitchRoundHere) {
  const plan = getPartyPlan();
  if (!plan || plan.realm === getCurrentServer()) return;

  const here = { serverRegion: server.region, serverIdentifier: server.id };
  const planRealm = { serverRegion: plan.region, serverIdentifier: plan.id };
  if (target && isOnCurrentRealm(target))
    return pointPartyAt(here, "nothing left for the fighters elsewhere");

  if (!target) {
    if (!isWitchRoundHere)
      return isAtHomeServer()
        ? pointPartyAt(here, "nothing left for the fighters elsewhere")
        : hopAloneTo(planRealm, "rejoining the party");

    const rest = isAtHomeServer() ? here : HOME_SERVER;
    return realmOf(rest) === plan.realm
      ? stayPut("brewing while the fighters hold home")
      : pointPartyAt(rest, "fighters home while brewing here");
  }
  if (isWitchRoundHere) {
    return realmOf(target) === plan.realm
      ? stayPut(`brewing while the fighters chase ${target.type}`)
      : pointPartyAt(target, `fighters onto ${target.type}`);
  }
  if (realmOf(target) !== plan.realm) return;

  return hopAloneTo(planRealm, "rejoining the party");
}

/**
 * Whether a sighting or realm is the one we stand on.
 * @param {HopRealm} target
 * @returns {boolean}
 */
function isOnCurrentRealm(target) {
  return realmOf(target) === getCurrentServer();
}

/**
 * Stays where we are.
 * @param {string} reason
 * @returns {HopDecision}
 */
function stayPut(reason) {
  return { action: "stay", reason };
}

/**
 * Hops the whole party to `target`'s realm.
 * @param {HopRealm} target
 * @param {string} reason
 * @returns {HopDecision}
 */
function hopTo(target, reason) {
  return { action: "hop", target, reason };
}

/**
 * Hops only this character to `target`'s realm.
 * @param {HopRealm} target
 * @param {string} reason
 * @returns {HopDecision}
 */
function hopAloneTo(target, reason) {
  return { action: "hopAlone", target, reason };
}

/**
 * Points the fighters at `target`'s realm while this character stays.
 * @param {HopRealm} target
 * @param {string} reason
 * @returns {HopDecision}
 */
function pointPartyAt(target, reason) {
  return { action: "point", target, reason };
}

/** @returns {{rule: HopRule, decision: HopDecision}|undefined} the first enabled rule that decides this tick */
function pickHopDecision() {
  const candidates = getRaceCandidates();
  const ctx = {
    realmData: getRealmData(),
    candidates,
    isIdle: !candidates.length,
    exemptTarget: getExemptHopTarget(),
    isHome: isAtHomeServer(),
    isWitchRoundHere: isWitchGathering() || isWitchBrewDue(),
  };

  for (const rule of HOP_RULES) {
    if (!rule.enabled || (rule.onlyWhenIdle && !ctx.isIdle)) continue;

    const decision = rule.decide(ctx, rule.config ?? {});
    if (decision) return { rule, decision };
  }
}

/** The last rule, action and realm logged, so a repeat stays quiet even as its reason ticks */
let lastHopLog;

/**
 * Logs a decision once, until the rule, action or realm changes.
 * @param {HopRule} rule
 * @param {HopDecision} decision
 */
function logHopDecision(rule, { action, target, reason }) {
  const where = target ? ` → ${realmOf(target)}` : "";
  const key = `${rule.name}: ${action}${where}`;
  if (key === lastHopLog) return;

  lastHopLog = key;
  console.warn(`[hop] ${key} — ${reason}`);
}

/** Carries out the tick's winning decision */
async function planHop() {
  const picked = pickHopDecision();
  if (!picked) return;

  const { rule, decision } = picked;
  const { action, target } = decision;

  // caracAL lands an unknown realm on its first server, EU I
  if (target && !(target.serverRegion && target.serverIdentifier)) {
    console.warn(`[hop] ${rule.name}: refused ${action} to an unnamed realm`, target);
    return;
  }
  logHopDecision(rule, decision);

  if (action === "point")
    return setPartyRealm(target.serverRegion, target.serverIdentifier);
  if (action === "hopAlone")
    return hopAlone(target.serverRegion, target.serverIdentifier);
  if (action === "hop") {
    set("currentParty", undefined);
    return hopToServer(target.serverRegion, target.serverIdentifier);
  }
}

setInterval(async () => {
  if (isLeaving || !shouldOwnRealmSockets()) return;
  try {
    await planHop();
  } finally {
    refreshPartyPlan();
  }
}, 10000);
