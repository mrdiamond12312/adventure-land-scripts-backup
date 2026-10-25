// Where the party belongs and who is on it, shared by every character

/** {realm, region, id, members, ranger, healer, by, at}, written by the hop owner */
const PARTY_PLAN_LS_KEY = "partyPlan";

/** Native: the merchant runs in a window of his own, and fighter windows never start him */
var SEPARATE_MERCHANT_WINDOW = false;

const PARTY_PLAN_STALE_MS = 2 * 60_000;

/** Per character: {realm, window, ctype, at} */
const REALM_BEAT_LS_PREFIX = "realmBeat:";

const REALM_BEAT_STALE_MS = 30_000;

/** Per character, whoever deploys it */
const DEPLOY_COOLDOWN_MS = 60_000;

/** @returns {{realm: string, region: string, id: string, members: string[], ranger: string, healer: string, by: string, at: number}|undefined} the fresh party plan */
function getPartyPlan() {
  const plan = get(PARTY_PLAN_LS_KEY);
  return plan && Date.now() - plan.at < PARTY_PLAN_STALE_MS ? plan : undefined;
}

/** @returns {boolean} whether another character decides where the party goes */
function isPartyPlanFollower() {
  const plan = getPartyPlan();
  return !!plan && plan.by !== character.name;
}

/**
 * Points the fighters at a realm, with the roster it calls for.
 * @param {string} region e.g. "EU"
 * @param {string} id e.g. "II"
 */
function setPartyRealm(region, id) {
  const realm = `${region}${id}`;
  set(PARTY_PLAN_LS_KEY, {
    realm,
    region,
    id,
    ...getRealmRoster(realm),
    by: character.name,
    at: Date.now(),
  });
}

/**
 * @param {string} name
 * @returns {{realm: string, window: string, ctype: string, at: number}|undefined} that character's fresh heartbeat
 */
function getRealmBeat(name) {
  const beat = get(`${REALM_BEAT_LS_PREFIX}${name}`);
  return beat && Date.now() - beat.at < REALM_BEAT_STALE_MS ? beat : undefined;
}

/**
 * @param {string} name
 * @returns {boolean} whether that character runs in another native window than ours
 */
function isInAnotherWindow(name) {
  const beat = getRealmBeat(name);
  return !!beat && beat.window !== (character.controller || character.name);
}

/**
 * @param {string} realm e.g. "EUII"
 * @returns {{members: string[], ranger: string, healer: string}} our own pick on our realm, else the pick on that realm's socket status, our role globals untouched
 */
function getRealmRoster(realm) {
  const status =
    realm !== getCurrentServer() && typeof getRealmData === "function"
      ? getRealmData()?.status(realm)
      : undefined;
  if (!status) return { members: partyMems, ranger: RANGER, healer: HEALER };

  const roles = { RANGER, HEALER };
  const members = pickPartyMembers(status, realm) ?? partyMems;
  const roster = { members, ranger: RANGER, healer: HEALER };
  ({ RANGER, HEALER } = roles);
  return roster;
}

/**
 * @param {string} id
 * @returns {boolean} whether that character was deployed, or moved itself, within the cooldown
 */
function isRecentlyDeployed(id) {
  return Date.now() - (get(`deployedAt:${id}`) ?? 0) < DEPLOY_COOLDOWN_MS;
}

/** @param {string} id */
function markDeployed(id) {
  set(`deployedAt:${id}`, Date.now());
}

/**
 * Deploys a character under caracAL, at most once per cooldown whoever asks.
 * @param {string} id
 * @param {string} [realm] e.g. "EUII", ours when omitted
 * @returns {boolean} whether it was deployed
 */
function deployCharacterOnce(id, realm) {
  if (isRecentlyDeployed(id)) return false;

  markDeployed(id);
  parent.caracAL.deploy(
    id,
    realm ? `SR_${realm}` : null,
    caracALconfig.characters[id].script,
  );
  return true;
}

async function deployCharacters() {
  //// Deploy characters which arent active
  const loadedCharacters = get_active_characters();
  const loadedCharactersNames = Object.keys(loadedCharacters);
  const allCharacters = getMyCharacters();

  if (parent.caracAL && caracALconfig.characters[character.name].enabled) {
    const plan = getPartyPlan();
    const realm = plan?.realm ?? getCurrentServer();
    const isWithParty = realm === getCurrentServer();
    const roster = plan?.members ?? partyMems;
    const others = parent.caracAL.siblings.filter(
      (id) => id !== character.name,
    );

    // Fighters on the plan's realm fit the roster themselves
    if (!isWithParty && others.some((id) => getRealmBeat(id)?.realm === realm))
      return;

    if (isWithParty && character.ctype === "merchant")
      others
        .filter((id) => !roster.includes(id))
        .forEach(async (id) => {
          send_cm(id, "dc-harakiri");
          await sleep(character.ping);
          parent.caracAL.shutdown(id);
        });

    //the server only confirms one login at a time per account - deploying
    //these in the same tick gets all but one rejected as characters_unconfirmed
    for (const id of [...roster, partyMerchant].filter(
      (id) => !parent.caracAL.siblings.includes(id),
    )) {
      if (deployCharacterOnce(id, id === partyMerchant ? null : realm))
        await sleep(1000);
    }
  } else if (!parent.caracAL && !character.controller) {
    const hosted = SEPARATE_MERCHANT_WINDOW
      ? allCharacters.filter((id) => (id === partyMerchant) === isMerchant())
      : allCharacters;

    loadedCharactersNames
      .filter((id) => loadedCharacters[id] !== "self" && !hosted.includes(id))
      .forEach((id) => stop_character(id));

    hosted
      .filter((id) => !loadedCharacters[id] && !isInAnotherWindow(id))
      .forEach((id) =>
        start_character(id, CODE_SLOTS[id].script).catch(() => undefined),
      );
  }
}

/** Set once we asked to move to the plan's realm */
let isMovingToPartyRealm = false;

/** A fighter follows the hop owner's plan: its realm, and under caracAL its roster */
async function followPartyPlan() {
  if (isMerchant() || !isPartyPlanFollower() || isMovingToPartyRealm) return;
  if (character.cave || get("cryptInstance")) return;

  const plan = getPartyPlan();
  if (parent.caracAL) return fitPartyRoster(plan);

  // A native window moves as one, and its main starts and stops the runners
  if (!character.controller && plan.realm !== getCurrentServer())
    await moveToPartyRealm(plan);
}

/** @param {{realm: string, region: string, id: string}} plan */
async function moveToPartyRealm(plan) {
  console.warn(`Following the party to ${plan.realm}`);
  isMovingToPartyRealm = true;
  markDeployed(character.name);
  await midasLooting(true);
  if (parent.caracAL) parent.caracAL.deploy(null, `SR_${plan.realm}`);
  else change_server(plan.region, plan.id);
}

/**
 * An off-roster fighter, wherever it stands, deploys the member it pairs with onto the plan's realm
 * and leaves; a rostered one moves there, and the first one already there deploys the rest.
 * @param {{realm: string, members: string[]}} plan
 */
async function fitPartyRoster(plan) {
  const { siblings } = parent.caracAL;
  const members = plan.members ?? partyMems;
  const fighters = siblings.filter(
    (id) => getRealmBeat(id) && getRealmBeat(id).ctype !== "merchant",
  );
  const extras = fighters.filter((id) => !members.includes(id)).sort();
  const missing = members
    .filter(
      (id) =>
        !siblings.includes(id) && !getRealmBeat(id) && !isRecentlyDeployed(id),
    )
    .sort();

  const slot = extras.indexOf(character.name);
  if (slot >= 0) {
    const replacement = missing[slot];
    console.warn(`Leaving the roster for ${plan.realm}`, replacement ?? "");
    if (replacement) deployCharacterOnce(replacement, plan.realm);
    await midasLooting(true);
    parent.caracAL.shutdown();
    return;
  }

  if (plan.realm !== getCurrentServer()) return moveToPartyRealm(plan);

  const first = fighters
    .filter((id) => getRealmBeat(id).realm === plan.realm && members.includes(id))
    .sort()[0];
  if (first !== character.name) return;
  for (const id of missing.slice(extras.length))
    if (deployCharacterOnce(id, plan.realm)) await sleep(1000);
}

// Party presets
function horsemanRanger1Party() {
  RANGER = RANGER1;
  HEALER = PRIEST;
  return [RANGER1, MAGE, PRIEST];
}

function horsemanAsiaParty() {
  HEALER = PRIEST;
  return [ROGUE, MAGE, PRIEST];
}

const DYNAMIC_PARTY_PRESETS = {
  horseman: {
    EUII: () => {
      RANGER = RANGER2;
      HEALER = PRIEST;
      return [RANGER2, MAGE, PRIEST];
    },
    EUI: horsemanRanger1Party,
    USI: horsemanRanger1Party,
    USII: horsemanRanger1Party,
    ASIAI: horsemanAsiaParty,
    ASIAII: horsemanAsiaParty,
    default: () => {
      HEALER = PRIEST;
      return [WARRIOR, MAGE, PRIEST];
    },
  },
  mrgreen: () => {
    HEALER = PRIEST;
    return [WARRIOR, PRIEST, ROGUE];
  },
  mrpumpkin: {
    USIV: () => {
      HEALER = PRIEST;
      return [MAGE, PRIEST, ROGUE];
    },
    default: () => {
      HEALER = PRIEST;
      return [WARRIOR, PRIEST, ROGUE];
    },
  },
  franky: {
    EUII: () => {
      RANGER = RANGER2;
      return [RANGER2, PRIEST, ROGUE];
    },
    EUI: () => {
      RANGER = RANGER1;
      return [RANGER1, PRIEST, ROGUE];
    },
    default: [WARRIOR, PRIEST, ROGUE],
  },
  icegolem: {
    EUII: () => {
      RANGER = RANGER2;
      HEALER = RANGER2;
      return [RANGER2, ROGUE, MAGE];
    },
    EUI: () => {
      RANGER = RANGER1;
      HEALER = RANGER1;
      return [RANGER, ROGUE, MAGE];
    },
    USI: [WARRIOR, PRIEST, MAGE],
    USIV: [WARRIOR, PRIEST, MAGE],
    default: () => {
      HEALER = PRIEST;
      return [PRIEST, ROGUE, MAGE];
    },
  },
  dragold: {
    USII: [WARRIOR, PRIEST, ROGUE],
    EUI: () => {
      RANGER = RANGER1;
      HEALER = PRIEST;
      return [WARRIOR, RANGER, PRIEST];
    },
    EUII: () => {
      RANGER = RANGER2;
      HEALER = PRIEST;
      return [WARRIOR, RANGER, PRIEST];
    },
    USI: () => {
      HEALER = PRIEST;
      return [WARRIOR, MAGE, PRIEST];
    },
    USIV: () => {
      HEALER = PRIEST;
      return [WARRIOR, MAGE, PRIEST];
    },
    default: [WARRIOR, PRIEST, ROGUE],
  },
  crabxx: {
    EUII: () => {
      RANGER = RANGER2;
      return [WARRIOR, RANGER, PRIEST];
    },
    default: () => {
      RANGER = RANGER1;
      return [WARRIOR, RANGER, PRIEST];
    },
  },
  pinkgoo: {
    USII: [MAGE, PRIEST, ROGUE],
    USI: [WARRIOR, MAGE, PRIEST],
    USIV: [WARRIOR, MAGE, PRIEST],
    EUI: () => {
      RANGER = RANGER1;
      HEALER = RANGER;
      return [WARRIOR, RANGER, MAGE];
    },
    EUII: () => {
      RANGER = RANGER2;
      HEALER = RANGER;
      return [WARRIOR, RANGER, MAGE];
    },
    default: () => {
      RANGER = RANGER1;
      HEALER = RANGER;
      return [WARRIOR, RANGER, MAGE];
    },
  },
  wabbit: {
    USII: () => {
      RANGER = RANGER1;
      HEALER = RANGER;
      return [ROGUE, RANGER, MAGE];
    },
    USIV: [MAGE, RANGER, PRIEST],
    EUII: () => {
      RANGER = RANGER2;
      HEALER = RANGER;
      return [WARRIOR, RANGER, MAGE];
    },
    default: () => {
      RANGER = RANGER1;
      HEALER = RANGER;
      return [WARRIOR, RANGER, MAGE];
    },
  },
  snowman: {
    EUII: () => {
      RANGER = RANGER2;
      HEALER = RANGER;
      return [WARRIOR, RANGER, MAGE];
    },
    USII: () => {
      RANGER = RANGER1;
      HEALER = RANGER;
      return [WARRIOR, RANGER, ROGUE];
    },
    USIV: () => {
      RANGER = RANGER1;
      HEALER = PRIEST;
      return [WARRIOR, RANGER, PRIEST];
    },
    default: () => {
      RANGER = RANGER1;
      HEALER = RANGER;
      return [WARRIOR, RANGER, MAGE];
    },
  },

  default: () => {
    const globalParty = get("currentParty");
    HEALER = PRIEST;

    if (
      globalParty &&
      globalParty.some((id) => knownTankers.includes(id)) &&
      !serverCurrentlyHasLiveEvent()
    ) {
      setRogueSpeedLastDeployment();
      if (shouldDeployRogue()) {
        return [WARRIOR, ROGUE, MAGE];
      } else {
        return [WARRIOR, PRIEST, MAGE];
      }
    }

    return [WARRIOR, PRIEST, MAGE];
  },

  cave: () => {
    HEALER = PRIEST;
    return [WARRIOR, PRIEST, MAGE];
  },

  witch: {
    EUII: () => {
      RANGER = RANGER2;
      HEALER = PRIEST;
      return [RANGER2, PRIEST, MAGE];
    },
    default: () => {
      RANGER = RANGER1;
      HEALER = PRIEST;
      return [RANGER1, PRIEST, MAGE];
    },
  },
};

/** Gather kinds whose mobs the ranger's multishot clears faster than the warrior */
const WITCH_RANGER_KINDS = ["verdantspore", "frostscale", "gloomfeather"];

/** @returns {boolean} whether this round's gathering slot wants the witch preset */
function isRangerWitchSlot(status = server.status) {
  const cipher = status.witchcipher;
  if (!isWitchGathering(cipher) || get("cryptInstance")) return false;

  const plan = get("witchGatherPlan");
  return (
    plan?.key === getWitchRoundKey(cipher) &&
    WITCH_RANGER_KINDS.includes(plan.kind)
  );
}

function getPresetMembers(preset, currentServer) {
  if (typeof preset === "function") return preset();
  if (Array.isArray(preset)) return preset;
  if (typeof preset === "string")
    return getPresetMembers(DYNAMIC_PARTY_PRESETS[preset], currentServer);

  const value =
    preset[currentServer] ?? preset.default ?? DYNAMIC_PARTY_PRESETS.default();
  return typeof value === "function" ? value() : value;
}

/** Bosses whose preset wins whenever they are live */
const PRESET_FIRST_BOSSES = ["horseman"];

/**
 * @param {object} [status] a realm's server.status
 * @param {string} [realm] e.g. "EUII"
 * @returns {string[]|undefined} the roster `status` calls for on `realm`
 */
function pickPartyMembers(status = server.status, realm = getCurrentServer()) {
  const liveEvents = Object.keys(DYNAMIC_PARTY_PRESETS).filter(
    (name) => status[name]?.live,
  );
  const activeEvent =
    USE_CAVE_STRATEGY && isCaveUnderway()
      ? "cave"
      : isRangerWitchSlot(status)
      ? "witch"
      : liveEvents.find((name) => PRESET_FIRST_BOSSES.includes(name)) ??
        rankLiveBossesByHp(HP_RANKED_BOSSES, status).find((name) =>
          liveEvents.includes(name),
        ) ??
        liveEvents[0] ??
        "default";

  return getPresetMembers(DYNAMIC_PARTY_PRESETS[activeEvent], realm);
}

/** A follower on the plan's realm takes the plan's roster; anyone else picks from this realm's status */
function dynamicParty() {
  const plan = isPartyPlanFollower() && getPartyPlan();
  if (plan?.members && plan.realm === getCurrentServer()) {
    partyMems = plan.members;
    RANGER = plan.ranger;
    HEALER = plan.healer;
    return;
  }

  const members = pickPartyMembers();
  if (members) partyMems = members;
}

setInterval(() => {
  set(`${REALM_BEAT_LS_PREFIX}${character.name}`, {
    realm: getCurrentServer(),
    window: character.controller || character.name,
    ctype: character.ctype,
    at: Date.now(),
  });
}, 5000);

setTimeout(deployCharacters, 5000);
setInterval(deployCharacters, 30000);
setInterval(followPartyPlan, 5000);
