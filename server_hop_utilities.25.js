// Realm identity, cross-realm data and hop policy, consulted by server_hop.14.js

/** The realm this character told Bean to call home — Bean's choice is not readable from CODE */
const HOME_SERVER = {
  serverRegion: "US",
  serverIdentifier: "II",
};

/** @returns {string} the realm we are on right now, e.g. "USII" */
function getCurrentServer() {
  return `${server.region}${server.id}`;
}

/** @returns {string} the configured home realm, e.g. "USII" */
function getHomeServer() {
  return `${HOME_SERVER.serverRegion}${HOME_SERVER.serverIdentifier}`;
}

/** @returns {boolean} whether we are standing on the configured home realm */
function isAtHomeServer() {
  return getCurrentServer() === getHomeServer();
}

/** Master switch — false restores the plain HP-race hopping */
var FATIGUE_AWARE_HOPPING = true;

/** Full realm-fatigue window, from the deployed condition definition */
const REALM_FATIGUE_MS = G.conditions.realmfatigue?.duration ?? 1800000;

/** Extra slack so the debuff has expired before the spawn, not exactly at it */
const HOME_SETTLE_MARGIN_MS = 120000;

/** Head home once the next scheduled window is this close */
const HOME_RETURN_LEAD_MS = REALM_FATIGUE_MS + HOME_SETTLE_MARGIN_MS;

/** Stop hopping out this long before a scheduled window, even while home */
const HOME_HOLD_LEAD_MS = HOME_RETURN_LEAD_MS + 300000;

/** Retry cadence while get_servers() has nothing to connect to yet */
const REALM_INIT_RETRY_MS = 15000;

/** server_info pulses about every 24s; past this a realm's cache is not trusted */
const REALM_STALE_MS = 90000;

/**
 * One character holds the sockets. Every CODE frame is separate, so without
 * this each of ours would open its own set against all eight realms.
 * The owner is the first character caracALconfig enables, which is exactly the
 * set basic_function.7.js loads this file for — so an owner always exists and
 * always runs the hop loop. Under native CODE each character is on its own.
 * @returns {boolean}
 */
function shouldOwnRealmSockets() {
  if (!parent.caracAL) return true;

  const hoppers = Object.keys(caracALconfig?.characters ?? {}).filter(
    (name) => caracALconfig.characters[name].enabled,
  );

  return !hoppers.length || character.name === hoppers[0];
}

// ---------------------------------------------------------------------------
// Realm data distributor
// ---------------------------------------------------------------------------

class ServerRealmData {
  constructor() {
    /** @type {Object<string, {region: string, name: string, S: object, at: number}>} */
    this.realms = {};
    this.sockets = {};
    this._init();
  }

  /**
   * Keeps one unauthenticated socket per realm and caches what they push.
   * A realm answers `welcome` once on connect and then `server_info` roughly
   * every 24 seconds; both carry the same shape as `server.status`.
   */
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

    // get_servers() can still be empty this early in the session
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

    socket.on("welcome", (data) => this._absorb(key, entry, data?.S));
    socket.on("server_info", (data) => this._absorb(key, entry, data));

    return socket;
  }

  /** Replaces a realm's cached status; server_info always carries the whole object. */
  _absorb(key, entry, status) {
    if (!status) return;

    this.realms[key] = {
      region: entry.region,
      name: entry.name,
      S: status,
      at: Date.now(),
    };
  }

  /**
   * Folds our own realm in from `server.status`. We are connected to it, so it
   * is live rather than up to a pulse old like every socket-fed copy.
   */
  _syncLocalRealm() {
    this._absorb(
      getCurrentServer(),
      { region: server.region, name: server.id },
      server.status,
    );
  }

  /** @returns {boolean} whether this realm has gone quiet for longer than a few pulses */
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
   * Live special monsters across every realm we still trust.
   * Rows carry the realm alongside the status fields, ready for the hop loop.
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
var REALM_DATA = undefined;

/** @returns {ServerRealmData | undefined} the distributor, built on first use */
function getRealmData() {
  if (!REALM_DATA && shouldOwnRealmSockets())
    REALM_DATA = new ServerRealmData();
  return REALM_DATA;
}

// ---------------------------------------------------------------------------
// Home realm reads
// ---------------------------------------------------------------------------

/**
 * Monsters whose extra drop table only rolls while you are on your home realm.
 * Read from G every call so a patch that adds one is picked up without an edit.
 * @returns {Set<string>}
 */
function homeDropMonsters() {
  return new Set(Object.keys(G.drops?.monsters_home_server ?? {}));
}

/** @returns {boolean} whether the home contribution bonus and home drops are suppressed */
function isRealmFatigued() {
  return !!character.s.realmfatigue;
}

/** @returns {number} ms until home rewards return, 0 when not fatigued */
function realmFatigueMs() {
  return character.s.realmfatigue?.ms ?? 0;
}

/**
 * The home realm's status, live when we are standing on it — the distributor
 * folds `server.status` in for whichever realm we are connected to.
 * @returns {object | undefined}
 */
function getHomeRealmStatus() {
  return getRealmData()?.status(getHomeServer());
}

/**
 * Time to the next daily or nightly window on a realm. `dailies`/`nightlies`
 * are hours on that realm's own clock, which is UTC shifted by time_offset.
 * @param {object} [schedule] the realm's server.status.schedule
 * @returns {number} ms until the next window, Infinity when unknown
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

/** @returns {number} ms until the home realm's next daily/nightly, Infinity when unknown */
function msUntilHomeScheduledEvent() {
  return msUntilNextScheduledEvent(getHomeRealmStatus()?.schedule);
}

/** @returns {string[]} home-table monsters currently live or announced on the home realm */
function homeDropBossesLiveAtHome() {
  const status = getHomeRealmStatus();
  if (!status) return [];

  return [...homeDropMonsters()].filter(
    (name) => status[name]?.live || status[name]?.spawn,
  );
}

// ---------------------------------------------------------------------------
// Hop policy
// ---------------------------------------------------------------------------

/**
 * Whether leaving the home realm right now would throw away home rewards we
 * are about to be able to collect.
 * @returns {false | string} the reason to stay, or false
 */
function shouldHoldAtHome() {
  if (!FATIGUE_AWARE_HOPPING || !isAtHomeServer()) return false;

  const liveBosses = homeDropBossesLiveAtHome();
  if (liveBosses.length) return `home-table boss up: ${liveBosses.join(", ")}`;

  const untilEvent = msUntilHomeScheduledEvent();
  if (untilEvent <= HOME_HOLD_LEAD_MS)
    return `scheduled window in ${Math.round(untilEvent / 60000)}m`;

  return false;
}

/**
 * Whether to abandon the hop race and go settle at home, because a scheduled
 * window is far enough out that the fatigue can still expire before it lands.
 * Below REALM_FATIGUE_MS it is already too late, so we keep hopping instead.
 * @returns {false | string} the reason to go home, or false
 */
function shouldReturnHomeToSettle() {
  if (!FATIGUE_AWARE_HOPPING || isAtHomeServer()) return false;

  const untilEvent = msUntilHomeScheduledEvent();
  if (untilEvent > HOME_RETURN_LEAD_MS) return false;
  if (untilEvent < REALM_FATIGUE_MS) return false;

  return `settling for a window in ${Math.round(untilEvent / 60000)}m`;
}

/**
 * Ranks a hop candidate by what its home drop table is worth where it stands.
 * Lower sorts earlier.
 * @param {{type: string, serverRegion: string, serverIdentifier: string}} candidate
 * @returns {number} 0 home-table boss at home, 1 no home table, 2 home table forfeited
 */
function homeDropRank(candidate) {
  if (!FATIGUE_AWARE_HOPPING) return 1;
  if (!homeDropMonsters().has(candidate.type)) return 1;

  const at = `${candidate.serverRegion}${candidate.serverIdentifier}`;
  return at === getHomeServer() ? 0 : 2;
}

// Assigned rather than declared so basic_merchant.5.js's own handler still wins
if (!isMerchant()) {
  on_destroy = function () {
    REALM_DATA?.destroy();
    clear_drawings();
    clear_buttons();
  };
}

getRealmData();
