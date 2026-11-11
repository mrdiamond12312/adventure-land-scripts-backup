// Cross-realm data and hop policy, consulted by server_hop.14.js

/** false restores the plain HP-race hopping */
var FATIGUE_AWARE_HOPPING = true;

/** Full realm-fatigue window */
const REALM_FATIGUE_MS = G.conditions.realmfatigue?.duration ?? 1800000;

/** Slack so the debuff has expired before the spawn */
const HOME_SETTLE_MARGIN_MS = 120000;

/** Head home once the next scheduled window is this close */
const HOME_RETURN_LEAD_MS = REALM_FATIGUE_MS + HOME_SETTLE_MARGIN_MS;

/** Overdue respawns past this are ignored */
const SPAWN_OVERDUE_GRACE_MS = 300000;

/** Share of kill time the fatigue may overlap */
const KILL_TIME_CREDIT = 0.25;

/** Kills kept for the average */
const KILL_TIME_SAMPLES = 5;

/** localStorage key for home-boss kill times */
const HOME_BOSS_KILLS_LS_KEY = "homeBossKills";

/** Retry cadence while get_servers() is still empty */
const REALM_INIT_RETRY_MS = 15000;

/** Past this a realm's cache is stale; server_info pulses every ~24s */
const REALM_STALE_MS = 90000;

/** @returns {boolean} whether this character holds the realm sockets: the first enabled caracAL character, or natively the merchant or a window no plan follows */
function shouldOwnRealmSockets() {
  if (!parent.caracAL) return isMerchant() || !isPartyPlanFollower();

  const hoppers = Object.keys(caracALconfig?.characters ?? {}).filter(
    (name) => caracALconfig.characters[name].enabled,
  );

  return !hoppers.length || character.name === hoppers[0];
}

// --- Realm data distributor ---

class ServerRealmData {
  constructor() {
    /** @type {Object<string, {region: string, name: string, S: object, at: number}>} */
    this.realms = {};
    this.sockets = {};
    this._init();
  }

  /** Opens one unauthenticated socket per realm: `welcome` once, then `server_info` every ~24s */
  _init() {
    if (!parent.io) {
      console.warn("No parent.io — realm data unavailable");
      return;
    }

    for (const entry of get_servers() ?? []) {
      const key = `${entry.region}${entry.name}`;
      if (this.sockets[key]) continue;

      try {
        this.sockets[key] = this._open(key, entry);
      } catch (e) {
        console.warn(`Realm socket ${key} failed:`, e);
      }
    }

    if (!Object.keys(this.sockets).length)
      setTimeout(() => this._init(), REALM_INIT_RETRY_MS);
  }

  /**
   * @param {string} key
   * @param {{region: string, name: string, address: string, path: string}} entry
   */
  _open(key, entry) {
    const socket = parent.io(`wss://${entry.address}`, {
      transports: ["websocket"],
      path: entry.path,
      forceNew: true,
      reconnection: true,
      reconnectionDelay: 10000,
      reconnectionDelayMax: 120000,
    });

    // The server spotlights observers onto live fights every ~13s; PvP is never hopped to
    const wantsEntities = entry.name !== "PVP";

    socket.on("welcome", (data) => {
      this._absorb(key, entry, data?.S);
      // Makes us an observer, so the server feeds us entities
      if (wantsEntities) socket.emit("loaded", {});
    });
    socket.on("server_info", (data) => this._absorb(key, entry, data));

    if (wantsEntities) {
      socket.on("new_map", (data) =>
        this._absorbEntities(key, entry, data?.entities),
      );
      socket.on("entities", (data) => this._absorbEntities(key, entry, data));
    }

    return socket;
  }

  /**
   * Records any watched mini-boss the observer sees.
   * @param {string} key e.g. "USII"
   * @param {{region: string, name: string}} entry
   * @param {{monsters?: object[], map?: string}} [data]
   */
  _absorbEntities(key, entry, data) {
    // Wire data, so `type` rather than the client's mtype
    const seen = (data?.monsters ?? []).filter((monster) =>
      SPECIAL_MOB_IDS.includes(monster.type),
    );
    if (!seen.length) return;

    for (const monster of seen) {
      updateStoreEntry(REALM_SIGHTINGS_LS_KEY, monster.type, {
        realm: key,
        serverRegion: entry.region,
        serverIdentifier: entry.name,
        map: data.map,
        x: monster.x,
        y: monster.y,
        // hp is only sent when it differs from G
        hp: monster.hp ?? G.monsters[monster.type]?.hp,
        target: monster.target,
        seenAt: Date.now(),
      });
    }
  }

  /** Replaces a realm's cached status */
  _absorb(key, entry, status) {
    if (!status) return;

    this.realms[key] = {
      region: entry.region,
      name: entry.name,
      S: status,
      at: Date.now(),
    };

    if (key === getHomeServer()) trackHomeBossKills(status);
  }

  /** Folds our own realm in from the live `server.status` */
  _syncLocalRealm() {
    this._absorb(
      getCurrentServer(),
      { region: server.region, name: server.id },
      server.status,
    );
  }

  /** @returns {boolean} whether this realm has gone quiet for a few pulses */
  isStale(key) {
    const realm = this.realms[key];
    return !realm || Date.now() - realm.at > REALM_STALE_MS;
  }

  /**
   * @param {string} key e.g. "USII"
   * @returns {object | undefined} that realm's status, undefined when stale
   */
  status(key) {
    this._syncLocalRealm();
    return this.isStale(key) ? undefined : this.realms[key].S;
  }

  /**
   * Live monsters across every fresh realm, each row tagged with its realm.
   * @param {{types?: string[], avoidServers?: string[], requireTarget?: boolean,
   *          maxHpFraction?: number}} [options]
   * @returns {{type: string, serverRegion: string, serverIdentifier: string}[]}
   */
  query({
    types = [],
    avoidServers = [],
    requireTarget = false,
    maxHpFraction = 1,
  } = {}) {
    this._syncLocalRealm();

    const wanted = new Set(types);
    const avoid = new Set(avoidServers);
    const found = [];

    for (const key of Object.keys(this.realms)) {
      if (avoid.has(key)) continue;

      const status = this.status(key);
      if (!status) continue;

      const { region, name } = this.realms[key];

      for (const [type, state] of Object.entries(status)) {
        if (type === "schedule" || !state?.live) continue;
        if (wanted.size && !wanted.has(type)) continue;
        if (requireTarget && !state.target) continue;

        const ceiling = G.monsters[type]?.hp;
        if (ceiling && state.hp > maxHpFraction * ceiling) continue;

        found.push({
          ...state,
          type,
          serverRegion: region,
          serverIdentifier: name,
        });
      }
    }

    return found;
  }

  destroy() {
    for (const socket of Object.values(this.sockets)) {
      try {
        socket.close();
      } catch (e) {}
    }
    this.sockets = {};
  }
}

/** @type {ServerRealmData | undefined} */
var realmDataCache = undefined;

/** @returns {ServerRealmData | undefined} the distributor, built on first use */
function getRealmData() {
  if (!realmDataCache && shouldOwnRealmSockets())
    realmDataCache = new ServerRealmData();
  return realmDataCache;
}

// --- Home realm reads ---

/** Excluded from home-drop checks */
const IGNORED_HOME_DROP_MONSTERS = ["grinch", "slenderman"];

/** @returns {Set<string>} monsters with a home-only drop table, read from G each call */
function homeDropMonsters() {
  return new Set(
    Object.keys(G.drops?.monsters_home_server ?? {}).filter(
      (name) => !IGNORED_HOME_DROP_MONSTERS.includes(name),
    ),
  );
}

/** @returns {boolean} whether the home contribution bonus and home drops are suppressed */
function isRealmFatigued() {
  return !!character.s.realmfatigue;
}

/** @returns {number} ms until home rewards return, 0 when not fatigued */
function realmFatigueMs() {
  return character.s.realmfatigue?.ms ?? 0;
}

/** @returns {object | undefined} the home realm's status, live when we stand on it */
function getHomeRealmStatus() {
  return getRealmData()?.status(getHomeServer());
}

/**
 * Time to a realm's next daily or nightly hour, on its own clock (UTC + time_offset).
 * @param {object} [schedule] the realm's server.status.schedule
 * @returns {number} ms, Infinity when unknown
 */
function msUntilNextScheduledEvent(schedule) {
  const hours = [
    ...(schedule?.dailies ?? []),
    ...(schedule?.nightlies ?? []),
  ].filter((hour) => Number.isFinite(hour));

  if (!hours.length) return Infinity;

  const DAY_MS = 86400000;
  const HOUR_MS = 3600000;
  const realmNow = Date.now() + (schedule.time_offset ?? 0) * HOUR_MS;
  const dayStart = Math.floor(realmNow / DAY_MS) * DAY_MS;

  let soonest = Infinity;
  for (const hour of hours) {
    for (const day of [0, 1]) {
      const at = dayStart + day * DAY_MS + hour * HOUR_MS;
      if (at > realmNow) soonest = Math.min(soonest, at - realmNow);
    }
  }

  return soonest;
}

/** Events whose cooperative monsters pay the home contribution bonus */
const HOME_BONUS_EVENTS = ["goobrawl"];

/** @returns {string[]} events that only pay in full to a party settled at home */
function getHomeSettleEvents() {
  return [...homeDropMonsters(), ...HOME_BONUS_EVENTS];
}

/**
 * Time to the next home-paying event in a realm's lineup.
 * @param {object} [schedule] the realm's server.status.schedule
 * @returns {number|undefined} ms, 0 while one is live, Infinity when none, undefined without a lineup
 */
function msUntilNextLineupEvent(schedule) {
  if (!Array.isArray(schedule?.events)) return;

  const now = Date.now();
  let soonest = Infinity;
  for (const { status, at } of getLineup(schedule, getHomeSettleEvents())) {
    if (status === "live") return 0;

    const until = at - now;
    if (until > -SPAWN_OVERDUE_GRACE_MS)
      soonest = Math.min(soonest, Math.max(0, until));
  }
  return soonest;
}

/** @returns {number} ms until home's next home-paying event, Infinity when unknown */
function msUntilHomeScheduledEvent() {
  const schedule = getHomeRealmStatus()?.schedule;
  return (
    msUntilNextLineupEvent(schedule) ?? msUntilNextScheduledEvent(schedule)
  );
}

/** @type {Object<string, {spawnAt?: number, lastLiveAt?: number}>} */
const homeBossWatch = {};

/** @param {object} status the home realm's S */
function trackHomeBossKills(status) {
  const now = Date.now();

  for (const name of homeDropMonsters()) {
    const state = status[name];
    const watch = (homeBossWatch[name] ??= {});

    if (state?.live) {
      watch.lastLiveAt = now;
      continue;
    }
    if (!state?.spawn) continue;

    const justDied = now - watch.lastLiveAt <= REALM_STALE_MS;
    if (justDied && watch.spawnAt) recordHomeBossKill(name, now - watch.spawnAt);

    watch.spawnAt = new Date(state.spawn).getTime();
    watch.lastLiveAt = undefined;
  }
}

/**
 * @param {string} name
 * @param {number} killMs
 */
function recordHomeBossKill(name, killMs) {
  const kills = readStore(HOME_BOSS_KILLS_LS_KEY)[name]?.kills ?? [];
  updateStoreEntry(HOME_BOSS_KILLS_LS_KEY, name, {
    kills: [...kills, killMs].slice(-KILL_TIME_SAMPLES),
  });
}

/** @returns {number} average spawn-to-death ms, 0 when unknown */
function homeBossKillMs(name) {
  const kills = readStore(HOME_BOSS_KILLS_LS_KEY)[name]?.kills ?? [];
  if (!kills.length) return 0;
  return kills.reduce((sum, ms) => sum + ms, 0) / kills.length;
}

/** @returns {number} ms until fatigue must clear for the next home boss */
function msUntilHomeBossSpawn() {
  const status = getHomeRealmStatus();
  if (!status) return Infinity;

  let soonest = Infinity;
  for (const name of homeDropMonsters()) {
    const state = status[name];
    if (!state || state.live || !state.spawn) continue;

    const until = new Date(state.spawn).getTime() - Date.now();
    if (!Number.isFinite(until) || until <= -SPAWN_OVERDUE_GRACE_MS) continue;

    const credit = KILL_TIME_CREDIT * homeBossKillMs(name);
    soonest = Math.min(soonest, Math.max(0, until + credit));
  }

  return soonest;
}

/** @returns {number} ms until the next home window: a daily/nightly or a home-table boss respawn */
function msUntilHomeWindow() {
  return Math.min(msUntilHomeScheduledEvent(), msUntilHomeBossSpawn());
}

/** @returns {string[]} home-table monsters live on the home realm */
function homeDropBossesLiveAtHome() {
  const status = getHomeRealmStatus();
  if (!status) return [];

  return [...homeDropMonsters()].filter((name) => status[name]?.live);
}

// --- Hop policy ---

/** @returns {false | string} why leaving home now would forfeit home rewards about to land */
function shouldHoldAtHome() {
  if (!FATIGUE_AWARE_HOPPING || !isAtHomeServer()) return false;

  const liveBosses = homeDropBossesLiveAtHome();
  if (liveBosses.length) return `home-table boss up: ${liveBosses.join(", ")}`;

  const untilEvent = msUntilHomeWindow();
  if (untilEvent <= HOME_RETURN_LEAD_MS)
    return `home window in ${Math.round(untilEvent / 60000)}m`;

  return false;
}

/** @returns {false | string} why to settle home now: a home window is close, yet far enough for fatigue to clear */
function shouldReturnHomeToSettle() {
  if (!FATIGUE_AWARE_HOPPING || isAtHomeServer()) return false;

  const untilEvent = msUntilHomeWindow();
  if (untilEvent > HOME_RETURN_LEAD_MS) return false;
  if (untilEvent < REALM_FATIGUE_MS) return false;

  return `settling for a window in ${Math.round(untilEvent / 60000)}m`;
}

/**
 * Ranks a sighting by what its home drop table is worth where it stands.
 * @param {HopSighting} candidate
 * @returns {number} 0 home-table boss at home, 1 no home table, 2 home table forfeited
 */
function homeDropRank(candidate) {
  if (!FATIGUE_AWARE_HOPPING) return 1;
  if (!homeDropMonsters().has(candidate.type)) return 1;

  const at = `${candidate.serverRegion}${candidate.serverIdentifier}`;
  return at === getHomeServer() ? 0 : 2;
}

// --- Realm reach, against server_hop.14.js's config ---

/** @returns {string} the realm a sighting sits on, e.g. "USII" */
function realmOf(candidate) {
  return `${candidate.serverRegion}${candidate.serverIdentifier}`;
}

/**
 * @param {HopRealm} candidate
 * @param {string} [type] the boss we would go for; its `ignoredRealms` replaces IGNORED_REALMS
 * @returns {boolean} whether we would travel to this realm for it
 */
function isReachableRealm(candidate, type) {
  const ignored = HOP_BOSSES[type]?.ignoredRealms ?? IGNORED_REALMS;
  return (
    !ignored.includes(realmOf(candidate)) &&
    candidate.serverIdentifier !== "PVP" &&
    HOP_REGIONS.includes(candidate.serverRegion)
  );
}

// --- The Witch's day and the early hop ---

/** Hop sickness an early hop waits out before its event */
const HOP_SICKNESS_MS = G.conditions.hopsickness?.duration ?? 720_000;

/** Overrun past an event's length before the party heads home */
const EVENT_STAY_SLACK_MS = 60_000;

/** How often witchDay is re-read */
const WITCH_DAY_REFRESH_MS = 5 * 60_000;

/** The account's day from witch_cipher_info(): mixes_left, and server once claimed */
let witchDay = { at: 0 };

/** Refreshes witchDay in the background; character.witchcipher only exists during a round here */
async function refreshWitchDay() {
  if (Date.now() - witchDay.at < WITCH_DAY_REFRESH_MS) return;
  witchDay.at = Date.now();

  const info = await witch_cipher_info().catch((e) => console.warn(e));
  if (info) witchDay = { ...info, at: Date.now() };
}

/** Records a brew's answer in witchDay at once, ahead of the next refresh */
function noteWitchDay({ mixes_left, server }) {
  witchDay = { ...witchDay, mixes_left, server, at: Date.now() };
}

/** Forgets witchDay, so the next read asks the server again */
function forgetWitchDay() {
  witchDay = { at: 0 };
}

/** Time for the hop and a strike before a foreign round closes */
const WITCH_HOP_BUDGET_MS = 75_000;

/** A brewable round live or starting within this keeps the ingredients in the bag */
const WITCH_PACK_LEAD_MS = 30 * 60_000;

/** @returns {(WitchRealm & {cipher: object})[]} live rounds on realms the account may still brew on, this one included */
function getLiveWitchRounds() {
  const now = Date.now();
  return getWitchRealmStatuses().flatMap((entry) => {
    const cipher = entry.status.witchcipher;
    if (!cipher?.live || now >= cipher.end || !canWitchDayBrewOn(entry.key))
      return [];
    return [{ ...entry, cipher }];
  });
}

/** @returns {{realm: HopRealm, reason: string}|undefined} another realm brewing wants the merchant on: a stalled narrow board, else the day's last round about to close */
function getWitchHopTarget() {
  if (isWitchBrewDue()) return;

  const now = Date.now();
  const rounds = getLiveWitchRounds().filter(
    ({ key, cipher }) =>
      key !== getCurrentServer() && cipher.end - now >= WITCH_HOP_BUDGET_MS,
  );

  const strike = rounds
    .filter(({ key, cipher }) => isWitchBoardWorthStriking(key, cipher))
    .sort((lhs, rhs) => lhs.cipher.possible - rhs.cipher.possible)[0];
  if (strike)
    return {
      realm: strike.realm,
      reason: `a board at ${strike.cipher.possible} on ${strike.key}`,
    };

  const flush = rounds.find(
    ({ cipher }) =>
      now >= cipher.end - WITCH_FLUSH_LEAD_MS - WITCH_HOP_BUDGET_MS &&
      isLastWitchRoundOfDay(cipher),
  );
  if (flush) return { realm: flush.realm, reason: "the day's last round is closing" };
}

/** @returns {boolean} whether a brewable round is live, or starts within WITCH_PACK_LEAD_MS, on a realm we would brew on */
function isWitchBrewAhead() {
  const now = Date.now();
  return getWitchRealmStatuses().some(({ key, status }) => {
    if (!canWitchDayBrewOn(key)) return false;

    const live = status.witchcipher;
    if (live?.live && now < live.end) return true;
    return getLineup(status.schedule, ["witchcipher"]).some(
      ({ status: state, at }) =>
        state === "scheduled" && at > now && at - now <= WITCH_PACK_LEAD_MS,
    );
  });
}

/** @returns {number} ms the party spends on a foreign event once it starts; the Witch's for gathering only, since the merchant brews alone */
function getForeignEventStayMs(event) {
  const { duration = 0, gathering = duration } = G.events[event] ?? {};
  const isGatherOnly = event === "witchcipher";
  return (isGatherOnly ? gathering : duration) * 1000 + EVENT_STAY_SLACK_MS;
}

/**
 * @param {number} by
 * @param {{events: string[], clashingBosses: string[]}} config the earlyHop rule's
 * @returns {boolean} whether, by `by`, home runs one of `events`, or an exempt or clashing boss is live or due where we would chase it
 */
function hasClashingEventBy(by, { events, clashingBosses }) {
  const realmData = getRealmData();
  const isDue = (status, name) =>
    !!status?.[name]?.live ||
    getLineup(status?.schedule, [name]).some(({ at }) => at <= by);

  const homeStatus = getHomeRealmStatus();
  if (events.some((name) => isDue(homeStatus, name))) return true;

  const bosses = [...FATIGUE_EXEMPT_BOSSES, ...clashingBosses];
  return Object.entries(realmData?.realms ?? {}).some(
    ([key, { region, name }]) => {
      const realm = { serverRegion: region, serverIdentifier: name };
      const status = realmData.status(key);
      return bosses.some(
        (boss) => isReachableRealm(realm, boss) && isDue(status, boss),
      );
    },
  );
}

/**
 * @param {{events: string[], leadMs: number, clashingBosses: string[]}} config the earlyHop rule's
 * @returns {HopSighting|undefined} the soonest foreign event that sheds hop sickness and is back before home's next window
 */
function getEarlyHopTarget(config) {
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
      config.events,
    )) {
      const until = at - now;
      if (status !== "scheduled") continue;
      if (until < HOP_SICKNESS_MS || until > config.leadMs) continue;

      const stayMs = getForeignEventStayMs(event);
      if (until + stayMs + HOME_RETURN_LEAD_MS > untilHomeWindow) continue;
      if (hasClashingEventBy(at + stayMs, config)) continue;

      targets.push({ ...realm, type: event, at });
    }
  }
  return targets.sort((lhs, rhs) => lhs.at - rhs.at)[0];
}

/**
 * @param {{events: string[], leadMs: number}} config the earlyHop rule's
 * @returns {boolean} whether an early-hop event here is running or about to start
 */
function hasEarlyHopEventHere({ events, leadMs }) {
  const now = Date.now();
  return getLineup(server.status.schedule, events).some(
    ({ status, at }) =>
      status === "live" ||
      (status === "scheduled" && at - now <= leadMs && at > now),
  );
}

// --- Rare-mob snipes, from the observers' spotlight ---

/**
 * Whether a trip of `stayMs`, plus the 30-min realm fatigue after it, still ends before home's next window.
 * @param {number} stayMs
 * @returns {boolean}
 */
function fitsBeforeHomeWindow(stayMs) {
  if (!FATIGUE_AWARE_HOPPING) return true;
  return stayMs + HOME_RETURN_LEAD_MS <= msUntilHomeWindow();
}

/**
 * Whether the fighters already walked to this sighting's realm and spot and found it gone, wherever we stand now.
 * @param {HopSighting & {seenAt: number}} sighting
 * @returns {boolean}
 */
function isSnipeSpent(sighting) {
  const report = readStore(SCOUT_LS_KEY)[sighting.type];
  return (
    report?.realm === realmOf(sighting) &&
    (report.checkedAt ?? 0) >= sighting.seenAt
  );
}

/**
 * The fighters' own report of `type` on our realm, shaped like an observer sighting.
 * @param {string} type
 * @returns {(HopSighting & {map: string, x: number, y: number, seenAt: number})|undefined}
 */
function getFighterSnipeSighting(type) {
  const report = readStore(SCOUT_LS_KEY)[type];
  if (report?.realm !== getCurrentServer() || !report.seenSpot) return;

  return {
    ...report.seenSpot,
    type,
    serverRegion: server.region,
    serverIdentifier: server.id,
    seenAt: report.seenAt,
    target: report.target,
  };
}

/**
 * The freshest sighting worth a hop, from the observers or the fighters on our realm, held by anyone or not; one on our realm first.
 * @param {{mobs: string[], maxAgeMs: number, stayMs: Object<string, number>}} config the snipe rule's
 * @returns {(HopSighting & {map: string, x: number, y: number, seenAt: number})|undefined}
 */
function getSnipeTarget(config) {
  const sightings = readStore(REALM_SIGHTINGS_LS_KEY);
  const now = Date.now();
  const isAffordable = (sighting) =>
    isOnCurrentRealm(sighting) ||
    fitsBeforeHomeWindow(config.stayMs[sighting.type] ?? 0);
  const freshest = (type) =>
    [
      sightings[type] && { ...sightings[type], type },
      getFighterSnipeSighting(type),
    ]
      .filter((sighting) => sighting?.seenAt)
      .sort((lhs, rhs) => rhs.seenAt - lhs.seenAt)[0];

  return config.mobs
    .map(freshest)
    .filter(
      (sighting) =>
        sighting?.serverRegion &&
        sighting.map &&
        now - sighting.seenAt <= config.maxAgeMs,
    )
    .filter(
      (sighting) =>
        isReachableRealm(sighting, sighting.type) &&
        isAffordable(sighting) &&
        !isSnipeSpent(sighting),
    )
    .sort(
      (lhs, rhs) =>
        isOnCurrentRealm(rhs) - isOnCurrentRealm(lhs) ||
        rhs.seenAt - lhs.seenAt,
    )[0];
}

/**
 * Hands a sighting on our realm to the fighters' special-mob hunt; never revives one they found gone.
 * @param {HopSighting & {map: string, x: number, y: number, seenAt: number}} sighting
 */
function shareSnipeSighting(sighting) {
  const report = readStore(SCOUT_LS_KEY)[sighting.type];
  const known = Math.max(report?.seenAt ?? 0, report?.checkedAt ?? 0);
  if (sighting.seenAt <= known) return;

  updateStoreEntry(SCOUT_LS_KEY, sighting.type, {
    seenAt: sighting.seenAt,
    seenSpot: { map: sighting.map, x: sighting.x, y: sighting.y },
    target: sighting.target,
    realm: realmOf(sighting),
  });
}

/** How often the next home window is published */
const HOME_WINDOW_PUBLISH_MS = 15000;

/** Shares msUntilHomeWindow with the fighters */
function publishHomeWindow() {
  if (!getRealmData()) return;

  const untilWindow = msUntilHomeWindow();

  set(HOME_WINDOW_LS_KEY, {
    at: Number.isFinite(untilWindow) ? Date.now() + untilWindow : null,
    checkedAt: Date.now(),
  });
}

setInterval(publishHomeWindow, HOME_WINDOW_PUBLISH_MS);

// Assigned rather than declared so basic_merchant.5.js's own handler still wins
if (!isMerchant()) {
  on_destroy = function () {
    realmDataCache?.destroy();
    clear_drawings();
    clear_buttons();
  };
}

getRealmData();
