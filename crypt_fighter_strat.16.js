/** Tunables; distances in px */
const CRYPT = {
  bossRange: 300, // a boss this close to us, or to another boss, is in the fight
  safeDistance: 450, // a junction is clear with no boss this close
  arrival: 100,
  reach: 200, // nest, bait stops, follow gap, clearance from the pack when tagging
  supportHealRange: 120, // server: a supporter heals its focus within this
  holdShare: 0.9, // share of party hps a fight may cost
  maxKillS: 900,
  snowballUptime: 0.8,
  kiteRangeRate: 0.85,
  memoryMs: 60_000, // backed-off bosses stay blocked, sightings stay fresh
  snowballGapMs: 1500,
  pairPatienceMs: 45_000,
  planStaleMs: 2000,
  ageMs: 54 * 3_600_000, // an opened crypt levels this long before the run; 0 runs at once
  autoOpen: false, // whether the merchant opens a crypt on his own
};

/** Corridor junctions in lap order, the entrance first */
const CRYPT_JUNCTION = [
  { map: "crypt", x: 0, y: -226 },
  { x: -210, y: -1085 },
  { x: 375, y: -1085 },
  { x: 741, y: -1085 },
  { x: 726, y: -636 },
  { x: 1185, y: -465 },
  { x: 1544, y: -879 },
  { x: 2039, y: -879 },
  { x: 2491, y: -681 },
  { x: 2682, y: -1100 },
  { x: 2732, y: -1729 },
  { x: 1997, y: -1754 },
  { x: 1216, y: -1485 },
  { x: 373, y: -1305 },
];

/** The crypt's spawn table, sorted out once from G */
const CRYPT_MOBS = (() => {
  const boxCenter = ([x1, y1, x2, y2]) => ({
    map: "crypt",
    x: (x1 + x2) / 2,
    y: (y1 + y2) / 2,
  });
  const spawns = G.maps.crypt.monsters;
  const bosses = spawns.filter(({ type }) => G.monsters[type].humanoid);
  const minions = spawns.filter(({ type }) => !G.monsters[type].humanoid);

  return {
    bosses: bosses.map(({ type }) => type),
    supporters: bosses
      .map(({ type }) => type)
      .filter((type) => G.monsters[type].supporter),
    minions: minions.map(({ type }) => type),
    minionCount: minions.reduce((total, { count }) => total + count, 0),
    nest: boxCenter(minions[0].boundary),
    // What bosses spawn on whoever fights them; that player's scare removes them
    spawned: bosses.flatMap(({ type }) =>
      (G.monsters[type].spawns ?? []).map(([, mtype]) => mtype),
    ),
    // A boss that never roams is where it spawned
    fixedSpots: Object.fromEntries(
      bosses
        .filter(({ roam }) => !roam)
        .map(({ type, boundary }) => [type, { ...boxCenter(boundary), at: 0 }]),
    ),
  };
})();

/** What this character remembers of the open instance */
let cryptMemory = {};

/** This tick's fight, read by the kite: { target, dragTo, pairWith, at } */
let cryptPlan;

function resetCryptMemory(instance) {
  cryptMemory = {
    instance,
    sightings: { ...CRYPT_MOBS.fixedSpots }, // boss type -> { x, y, map, at, isGone }
    publishedAt: 0,
    blockedUntil: {}, // boss type -> time
    seenTypes: {}, // monster id -> mtype
    snowballAt: {}, // boss id -> time
    patrol: { index: undefined, emptyStops: 0 },
    drag: undefined, // { id, spot }
    pairingSince: undefined,
  };
}

const isCryptBoss = (mob) => CRYPT_MOBS.bosses.includes(mob?.mtype);
const isCryptMinion = (mob) => CRYPT_MOBS.minions.includes(mob?.mtype);
const isCryptSupporter = (mob) => CRYPT_MOBS.supporters.includes(mob.mtype);
const isCryptBlocked = (mtype) =>
  (cryptMemory.blockedUntil[mtype] ?? 0) > Date.now();

/** @returns {Object[]} G entries of what the boss spawns */
const cryptSpawnsOf = (mob) =>
  (G.monsters[mob.mtype]?.spawns ?? []).map(([, mtype]) => G.monsters[mtype]);

function nearestCryptSpot(from, spots) {
  return [...spots].sort(
    (lhs, rhs) => distance(from, lhs) - distance(from, rhs),
  )[0];
}

/**
 * The run as the whole party saw it. Kills are keyed by monster id, so a death
 * several of us saw counts once.
 * @returns {{killed: Object<string, string>, isMinionsSwept: boolean, isSupportGivenUp: boolean}}
 */
function readCryptRun() {
  const instance = get("cryptInstance");
  const run = { killed: {}, isMinionsSwept: false, isSupportGivenUp: false };

  for (const name of partyMems) {
    const record = get(`cryptRun:${name}`);
    if (record?.instance !== instance) continue;
    Object.assign(run.killed, record.killed);
    run.isMinionsSwept ||= !!record.isMinionsSwept;
    run.isSupportGivenUp ||= !!record.isSupportGivenUp;
  }

  return run;
}

/** @param {(record: Object) => void} change - applied to our own record of this instance */
function writeCryptRun(change) {
  const key = `cryptRun:${character.name}`;
  const instance = get("cryptInstance");
  const stored = get(key);
  const record =
    stored?.instance === instance ? stored : { instance, killed: {} };

  change(record);
  set(key, record);
}

function getCryptMinionsLeft(run) {
  if (run.isMinionsSwept) return 0;
  const killed = Object.values(run.killed).filter((mtype) =>
    CRYPT_MOBS.minions.includes(mtype),
  ).length;
  return Math.max(CRYPT_MOBS.minionCount - killed, 0);
}

/** @returns {number} share of the time we alone keep a boss frozen */
function getOwnFreezeUptime() {
  if (locate_item("snowball") !== -1) return CRYPT.snowballUptime;

  const chance = Math.max(
    0,
    ...[...character.items, ...Object.values(character.slots)]
      .filter((item) => item && G.items[item.name]?.ability === "freeze")
      .map(({ name, level = 0 }) => {
        const { attr0, upgrade } = G.items[name];
        return (attr0 + (upgrade?.attr0 ?? 0) * level) / 100;
      }),
  );
  if (!chance) return 0;

  const frozenS = G.conditions.frozen.duration / 1000;
  return frozenS / (frozenS + 1 / (chance * character.frequency));
}

/** Shares what we bring and what we saw, once a second */
function publishCryptKit() {
  if (Date.now() - cryptMemory.publishedAt < 1000) return;
  cryptMemory.publishedAt = Date.now();

  publishCharacterInfo({
    cryptFreeze: getOwnFreezeUptime(),
    cryptScare:
      locate_item("jacko") !== -1 || character.slots.orb?.name === "jacko",
    cryptSightings: {
      instance: cryptMemory.instance,
      spots: cryptMemory.sightings,
    },
  });
}

/** @returns {Object<string, Object>} boss type -> where it was last seen, by any of us */
function knownCryptSightings() {
  return Object.fromEntries(
    Object.entries(cryptMemory.sightings).filter(([, spot]) => !spot.isGone),
  );
}

/** @returns {Object[]} the bosses in view, their sightings refreshed */
function noteCryptMobs() {
  const bosses = [];
  const { sightings } = cryptMemory;

  for (const name of partyMems) {
    const shared = getCharacterInfo(name)?.cryptSightings;
    if (name === character.name || shared?.instance !== cryptMemory.instance)
      continue;
    for (const [mtype, spot] of Object.entries(shared.spots))
      if (spot.at > (sightings[mtype]?.at ?? -1)) sightings[mtype] = spot;
  }

  for (const mob of Object.values(parent.entities)) {
    if (mob.type !== "monster" || mob.dead) continue;
    if (!isCryptBoss(mob) && !isCryptMinion(mob)) continue;

    cryptMemory.seenTypes[mob.id] = mob.mtype;
    if (!isCryptBoss(mob)) continue;

    bosses.push(mob);
    sightings[mob.mtype] = {
      map: "crypt",
      x: mob.x,
      y: mob.y,
      at: Date.now(),
    };
  }

  return bosses;
}

/**
 * @param {Object[]} avoid - bosses to stay clear of, on top of the fresh sightings
 * @param {Object} from
 * @param {string} [exceptType] - a boss coming along
 * @returns {Object|undefined} the nearest junction with none of them around
 */
function getClearCryptJunction(avoid, from, exceptType) {
  const sightings = Object.entries(knownCryptSightings())
    .filter(
      ([mtype, { at }]) =>
        mtype !== exceptType && Date.now() - at < CRYPT.memoryMs,
    )
    .map(([, sighting]) => sighting);

  const spot = nearestCryptSpot(
    from,
    CRYPT_JUNCTION.filter((junction) =>
      [...avoid, ...sightings].every(
        (boss) => distance(junction, boss) > CRYPT.safeDistance,
      ),
    ),
  );
  return spot && { map: "crypt", x: spot.x, y: spot.y };
}

/**
 * Who holds the fight and what the party can heal through.
 * @returns {{holder: Object, party: Object[], hps: number, isReady: boolean, freezeUptime: number, canScareSpawns: boolean}}
 */
function getCryptFight() {
  const isAlive = (entity) => !!entity && !entity.rip;
  const tanker = get_entity(TANKER);
  const healer = get_entity(HEALER);
  const party = partyMems.map((name) => get_entity(name)).filter(isAlive);
  const kits = party.map((member) => getCharacterInfo(member.name) ?? {});

  return {
    holder: isAlive(tanker) ? tanker : character,
    party,
    freezeUptime: Math.max(0, ...kits.map((kit) => kit.cryptFreeze ?? 0)),
    canScareSpawns: kits.every((kit) => kit.cryptScare),
    hps:
      ((isAlive(healer) ? healerHps(healer) : 0) + hpot1Regen()) *
      CRYPT.holdShare,
    isReady: isAlive(tanker) && isAlive(healer),
  };
}

/**
 * Heal per second a boss's zappers cost: each zaps everyone in its radius, and
 * as many stand as fit in one's life — its degen, or our scare cooldown.
 */
function cryptSpawnDps(def, fight) {
  return (def.spawns ?? []).reduce((total, [intervalMs, mtype]) => {
    const { zap, degen } = G.monsters[mtype]?.abilities ?? {};
    if (!zap || typeof intervalMs !== "number") return total;

    const degenMs = degen
      ? (G.monsters[mtype].hp / degen.amount) * degen.cooldown
      : Infinity;
    const lifeMs = fight.canScareSpawns
      ? Math.min(degenMs, G.skills.scare.cooldown)
      : degenMs;
    const zapDps = (zap.amount / zap.cooldown) * 1000 * (lifeMs / intervalMs);
    return total + zapDps * Math.max(fight.party.length, 1);
  }, 0);
}

/** @returns {boolean} whether the victim outranges the boss and outruns it frozen */
function isCryptKitable(boss, victim) {
  const def = G.monsters[boss.mtype];
  return (
    victim.range > Math.max(def.range * 2, 75) &&
    victim.speed > (def.charge ?? def.speed) + G.conditions.frozen.speed
  );
}

/**
 * @param {Object} boss - an entity, or a G.monsters entry shaped like one
 * @param {Object} fight - from getCryptFight
 * @returns {number} its dps on the holder; an anger boss re-targets, so on whoever
 * it hurts most. Frozen it swings slower, and misses whoever kites it.
 */
function cryptBossDps(boss, fight) {
  const def = G.monsters[boss.mtype];
  const victims =
    def.abilities?.anger && fight.party.length ? fight.party : [fight.holder];
  const frozenShare = (victim) =>
    isCryptKitable(boss, victim) ? 0 : G.conditions.frozen.frequencym;

  return (
    Math.max(
      ...victims.map(
        (victim) =>
          calculateDamage(boss, victim) *
          (1 - fight.freezeUptime * (1 - frozenShare(victim))),
      ),
    ) + cryptSpawnDps(def, fight)
  );
}

/**
 * @param {Object[]} bosses
 * @param {Object} fight - from getCryptFight
 * @param {Object[]} [adds] - what else is on the holder
 * @returns {boolean} whether the party heals through all of them at once
 */
function canHoldCryptBosses(
  bosses,
  fight,
  adds = listOfMonsterAttacking(fight.holder).filter(
    (mob) => !isCryptBoss(mob) && !CRYPT_MOBS.spawned.includes(mob.mtype),
  ),
) {
  const bossDps = bosses.reduce(
    (total, boss) => total + cryptBossDps(boss, fight),
    0,
  );
  const auraAmps = bosses.flatMap((boss) =>
    Object.values(G.monsters[boss.mtype].abilities ?? {})
      .filter((ability) => ability.aura)
      .map((ability) => G.conditions[ability.condition]?.incdmgamp ?? 0),
  );

  return (
    (bossDps + totalMobDps(adds, fight.holder)) *
      (1 + Math.max(0, ...auraAmps) / 100) <
    fight.hps
  );
}

/** @returns {number} heal per second landing on the boss from the supporters in view */
function cryptHealOn(boss, bosses) {
  return bosses.reduce((total, healer) => {
    const healing = G.monsters[healer.mtype].abilities?.healing;
    if (!healing) return total;

    const focus = healer.focus && parent.entities[healer.focus];
    const recipient =
      focus && distance(focus, healer) < CRYPT.supportHealRange
        ? focus
        : healer;
    return recipient.id === boss.id
      ? total + (healing.heal / healing.cooldown) * 1000
      : total;
  }, 0);
}

function isCryptKillable(boss, bosses, party) {
  const net =
    party.reduce(
      (total, member) => total + calculateDamage(member, boss, false),
      0,
    ) - cryptHealOn(boss, bosses);
  return net > 0 && boss.hp / net < CRYPT.maxKillS;
}

/**
 * A boss as the server has levelled it by now: left alone it gains a level
 * every max(3min, max_hp * 30ms) * 2^(0.3 per level), each worth half its base
 * hp, 12.5% attack and 0.034 frequency (stats stop at level 12).
 * @param {string} mtype
 * @param {number} ageMs - how long the instance has been open
 * @returns {Object} shaped like an entity
 */
function agedCryptBoss(mtype, ageMs) {
  const def = G.monsters[mtype];
  let level = 1;
  let hp = def.hp;

  for (let left = ageMs; level < 100; level++) {
    const stepMs = Math.max(180_000, hp * 30) * 2 ** ((level - 1) * 0.3);
    if (left < stepMs) break;
    left -= stepMs;
    hp += def.hp / 2;
  }

  const scale = level > 1 ? Math.min(level, 12) : 0;
  return {
    ...def,
    type: "monster",
    mtype,
    level,
    hp,
    max_hp: hp,
    attack: def.attack * (1 + scale * 0.125),
    frequency: def.frequency + scale * 0.034,
  };
}

/**
 * Boss types still worth going after: alive, holdable and killable on their
 * own. Supporters are only killed off a partner, so they never count.
 * @returns {string[]}
 */
function getWantedCryptBosses(run, fight) {
  const killed = Object.values(run.killed);
  const openedAt = get("cryptVisit")?.openedAt;
  const ageMs = openedAt ? Date.now() - openedAt : 0;

  return CRYPT_MOBS.bosses.filter((mtype) => {
    if (killed.includes(mtype) || CRYPT_MOBS.supporters.includes(mtype))
      return false;

    const boss = agedCryptBoss(mtype, ageMs);
    return (
      canHoldCryptBosses([boss], fight, []) &&
      isCryptKillable(boss, [], fight.party)
    );
  });
}

/**
 * Decides this tick's boss fight: kill what the party can hold, pull one boss
 * out of a cluster it can't, or back off.
 * @param {Object[]} bosses - the bosses in view
 * @param {Object} fight - from getCryptFight
 * @param {string[]} wanted - from getWantedCryptBosses
 * @param {boolean} isHunting - whether bosses that leave us alone are sought out
 * @returns {{target?: Object, dragTo?: Object, pairWith?: Object, retreatFrom?: Object[]}|undefined}
 */
function planCryptFight(bosses, fight, wanted, isHunting) {
  const threats = bosses.filter(
    (boss) =>
      partyMems.includes(boss.target) ||
      fight.party.some((member) => distance(member, boss) < CRYPT.bossRange),
  );
  const hunted = isHunting
    ? bosses.filter(
        (boss) => wanted.includes(boss.mtype) && !isCryptBlocked(boss.mtype),
      )
    : [];
  const seed =
    nearestCryptSpot(fight.holder, threats) ??
    nearestCryptSpot(fight.holder, hunted);
  if (!seed) return undefined;

  const cluster = bosses.filter(
    (boss) =>
      boss.id === seed.id ||
      threats.includes(boss) ||
      distance(boss, seed) < CRYPT.bossRange,
  );

  if (canHoldCryptBosses(cluster, fight)) {
    cryptMemory.drag = undefined;

    const order = cluster
      .filter((boss) => isCryptKillable(boss, bosses, fight.party))
      .sort(
        (lhs, rhs) =>
          isCryptSupporter(rhs) - isCryptSupporter(lhs) ||
          distance(fight.holder, lhs) - distance(fight.holder, rhs),
      );

    // A supporter healing itself can't be killed: park a boss on it
    const selfHealer = cluster.find(
      (boss) => isCryptSupporter(boss) && !order.includes(boss),
    );
    const partner =
      selfHealer &&
      (order.find((boss) => boss.id === selfHealer.focus) ?? order[0]);
    if (partner) return { target: partner, pairWith: selfHealer };

    return { target: order[0] };
  }

  // Tagged from full range on our side, clear of the rest of the pack
  const isTaggable = (boss) => {
    if (boss.target === fight.holder.name) return true;
    const gap = distance(fight.holder, boss) || 1;
    const reach = Math.min(gap, fight.holder.range);
    const spot = {
      x: boss.x + ((fight.holder.x - boss.x) / gap) * reach,
      y: boss.y + ((fight.holder.y - boss.y) / gap) * reach,
    };
    return cluster.every(
      (other) => other.id === boss.id || distance(other, spot) > CRYPT.reach,
    );
  };
  const lone = nearestCryptSpot(
    fight.holder,
    cluster.filter(
      (boss) =>
        wanted.includes(boss.mtype) &&
        !isCryptBlocked(boss.mtype) &&
        canHoldCryptBosses([boss], fight) &&
        isTaggable(boss),
    ),
  );
  const { drag } = cryptMemory;
  const hasDragFailed =
    drag?.id === lone?.id &&
    distance(fight.holder, drag?.spot) < CRYPT.arrival;
  if (!lone || hasDragFailed) return { retreatFrom: cluster };

  if (drag?.id !== lone.id) {
    const spot = getClearCryptJunction(
      cluster.filter((boss) => boss.id !== lone.id),
      fight.holder,
      lone.mtype,
    );
    if (!spot) return { retreatFrom: cluster };
    cryptMemory.drag = { id: lone.id, spot };
  }

  return { target: lone, dragTo: cryptMemory.drag.spot };
}

/**
 * Read by resolveKiteTarget: where the tanker's kite is anchored this tick.
 * @returns {{spot: Object, isDrag: boolean}|undefined}
 */
function getCryptKiteAnchor(target) {
  if (character.map !== "crypt") return undefined;
  if (!cryptPlan || Date.now() - cryptPlan.at > CRYPT.planStaleMs)
    return undefined;
  if (!isAssignedAsTanker() && !cryptPlan.isEscape) return undefined;
  if (target?.id !== cryptPlan.target.id) return undefined;

  if (cryptPlan.dragTo) return { spot: cryptPlan.dragTo, isDrag: true };

  const supporter =
    cryptPlan.pairWith && parent.entities[cryptPlan.pairWith.id];
  return supporter && { spot: supporter, isDrag: false };
}

function shouldStopCryptTrip(wanted) {
  return Object.values(parent.entities).some(
    (mob) =>
      mob.type === "monster" &&
      !mob.dead &&
      isCryptBoss(mob) &&
      !isCryptSupporter(mob) &&
      (partyMems.includes(mob.target) ||
        (wanted.includes(mob.mtype) && !isCryptBlocked(mob.mtype))),
  );
}

const isCryptBossOnUs = () => shouldStopCryptTrip([]);

/** Followers stay on the tanker: a step in view, a trip to its party spot otherwise */
function followCryptLeader() {
  const leader = get_entity(TANKER);
  if (leader) {
    if (distance(character, leader) > CRYPT.reach) parkAt(leader);
    return;
  }

  const info = parent.party?.[TANKER];
  if (info?.in !== character.in || getCharacterInfo(TANKER)?.rip) return;

  advanceSmartMove(
    { map: "crypt", x: info.x, y: info.y },
    {
      useScare: true,
      stopWatcher: () => !!get_entity(TANKER) || isCryptBossOnUs(),
    },
  ).catch(() => {});
}

/** Stands on the far side of a boss from whoever it chases, out of its way */
function holdBehindCryptBoss(boss) {
  const victim = get_entity(boss.target);
  if (!victim) return followCryptLeader();

  const dx = boss.x - victim.x;
  const dy = boss.y - victim.y;
  const length = Math.hypot(dx, dy) || 1;
  parkAt({
    x: boss.x + (dx / length) * CRYPT.reach,
    y: boss.y + (dy / length) * CRYPT.reach,
  });
}

/**
 * The tanker is down, so nobody fights: a boss on us is kited to the entrance,
 * one on an ally is kept in front of us, and otherwise we wait at the entrance.
 * @returns {Object} travelling
 */
function escapeCrypt() {
  const entrance = CRYPT_JUNCTION[0];
  const bossOnMe = listOfMonsterAttacking(character).find(isCryptBoss);
  if (bossOnMe) {
    change_target(bossOnMe);
    cryptPlan = {
      target: bossOnMe,
      dragTo: entrance,
      isEscape: true,
      at: Date.now(),
    };
    return travelling();
  }

  const bossOnAlly = Object.values(parent.entities).find(
    (mob) =>
      mob.type === "monster" &&
      isCryptBoss(mob) &&
      partyMems.includes(mob.target),
  );
  if (bossOnAlly) holdBehindCryptBoss(bossOnAlly);
  else if (distance(character, entrance) > CRYPT.arrival)
    advanceSmartMove({ ...entrance }, { stopWatcher: isCryptBossOnUs }).catch(
      () => {},
    );

  return travelling();
}

/** Drops what is on us and moves the party to a junction clear of bosses. */
async function retreatInCrypt(cluster) {
  cryptMemory.drag = undefined;
  for (const boss of cluster)
    cryptMemory.blockedUntil[boss.mtype] = Date.now() + CRYPT.memoryMs;

  await scareAwayMobs();

  if (!isAssignedAsTanker()) {
    followCryptLeader();
    return travelling();
  }

  log("Crypt: backing off");
  const spot = getClearCryptJunction([], character) ?? CRYPT_JUNCTION[0];
  if (distance(character, spot) > CRYPT.arrival)
    advanceSmartMove(spot, {
      useScare: true,
      stopWatcher: () =>
        Object.values(parent.entities).some(
          (mob) =>
            isCryptBoss(mob) &&
            partyMems.includes(mob.target) &&
            !isCryptBlocked(mob.mtype),
        ),
    }).catch(() => {});

  return travelling();
}

/**
 * @returns {Object|undefined} the minion to hit; none in view walks to the nest,
 * and an empty nest ends the minion phase
 */
function pickCryptMinion(fight, wanted) {
  const minions = Object.values(parent.entities).filter(
    (mob) => mob.type === "monster" && !mob.dead && isCryptMinion(mob),
  );

  if (!minions.length) {
    if (distance(character, CRYPT_MOBS.nest) < CRYPT.reach)
      writeCryptRun((record) => (record.isMinionsSwept = true));
    else if (isAssignedAsTanker())
      advanceSmartMove(
        { ...CRYPT_MOBS.nest },
        {
          useScare: true,
          stopWatcher: () =>
            Object.values(parent.entities).some(isCryptMinion) ||
            shouldStopCryptTrip(wanted),
        },
      ).catch(() => {});
    else followCryptLeader();
    return undefined;
  }

  const nearest = nearestCryptSpot(character, minions);
  if (isAssignedAsTanker()) {
    const current = get_targeted_monster();
    return isCryptMinion(current) ? current : nearest;
  }

  const leaderTarget = get_target_of(fight.holder);
  return (
    (isCryptMinion(leaderTarget) && leaderTarget) ||
    minions.find((mob) => partyMems.includes(mob.target)) ||
    nearest
  );
}

/**
 * Where the search goes next: the nearest known boss of the sought types, else
 * the next junction of the lap.
 * @param {string[]} sought - boss types looked for
 * @param {number} [reach] - how close counts as having reached a stop
 * @returns {Object|undefined} undefined once a full lap turned up none of them
 */
function getCryptPatrolStop(sought, reach = CRYPT.arrival) {
  const { patrol } = cryptMemory;

  for (const [mtype, sighting] of Object.entries(knownCryptSightings())) {
    if (
      distance(character, sighting) < reach &&
      !get_nearest_monster({ type: mtype })
    )
      cryptMemory.sightings[mtype] = { isGone: true, at: Date.now() };
  }
  const sightings = knownCryptSightings();

  const known = nearestCryptSpot(
    character,
    sought
      .filter((mtype) => sightings[mtype] && !isCryptBlocked(mtype))
      .map((mtype) => sightings[mtype]),
  );
  if (known) return { map: "crypt", x: known.x, y: known.y };

  patrol.index ??= CRYPT_JUNCTION.indexOf(
    nearestCryptSpot(character, CRYPT_JUNCTION),
  );

  if (distance(character, CRYPT_JUNCTION[patrol.index]) < reach) {
    patrol.emptyStops++;
    if (patrol.emptyStops >= CRYPT_JUNCTION.length) {
      patrol.emptyStops = 0;
      return undefined;
    }
    patrol.index = (patrol.index + 1) % CRYPT_JUNCTION.length;
  }

  // Skip the junctions of a pack we backed off from
  const isAvoided = (junction) =>
    Object.entries(sightings).some(
      ([mtype, spot]) =>
        isCryptBlocked(mtype) &&
        Date.now() - spot.at < CRYPT.memoryMs &&
        distance(junction, spot) < CRYPT.safeDistance,
    );
  for (
    let skipped = 0;
    skipped < CRYPT_JUNCTION.length && isAvoided(CRYPT_JUNCTION[patrol.index]);
    skipped++
  )
    patrol.index = (patrol.index + 1) % CRYPT_JUNCTION.length;

  const { x, y } = CRYPT_JUNCTION[patrol.index];
  return { map: "crypt", x, y };
}

/** The tanker walks the search; a full lap with nothing to fight closes the run. */
function patrolCrypt(wanted) {
  if (!isAssignedAsTanker()) return followCryptLeader();

  const stop = getCryptPatrolStop(wanted);
  if (!stop) {
    log("Crypt: nothing left to fight");
    set("cryptInstance", undefined);
    return;
  }

  advanceSmartMove(stop, {
    useScare: true,
    stopWatcher: () => shouldStopCryptTrip(wanted),
  }).catch(() => {});
}

/**
 * The last tankable boss is all a supporter can still be killed off, so nobody
 * hits it: the tanker walks it to the supporter and parks it there until the
 * heal lands on it. A lap without the supporter, or one that won't pair, gives
 * the supporter up.
 * @param {Object} plan - from planCryptFight, its target the bait
 * @returns {Object} travelling
 */
function baitCryptSupporter(plan) {
  useCryptSkills(plan.target);

  if (!isAssignedAsTanker()) {
    if (plan.target.target === TANKER) holdBehindCryptBoss(plan.target);
    else followCryptLeader();
    return travelling();
  }

  change_target(plan.target);
  const giveUp = () => {
    log("Crypt: giving the supporter up");
    writeCryptRun((record) => (record.isSupportGivenUp = true));
  };

  if (plan.pairWith) {
    cryptMemory.pairingSince ??= Date.now();
    if (Date.now() - cryptMemory.pairingSince > CRYPT.pairPatienceMs) giveUp();
    return travelling();
  }
  cryptMemory.pairingSince = undefined;

  const stop = getCryptPatrolStop(CRYPT_MOBS.supporters, CRYPT.reach);
  if (stop) cryptPlan = { target: plan.target, dragTo: stop, at: Date.now() };
  else giveUp();

  return travelling();
}

/** Whoever holds snowballs keeps the bosses on us frozen; a frozen supporter can't keep up with its partner. */
function freezeCryptBosses(bosses, target) {
  if (locate_item("snowball") === -1) return;
  if (character.mp < G.skills.snowball.mp || is_on_cooldown("snowball")) return;

  const { snowballAt } = cryptMemory;
  const boss = bosses.find(
    (mob) =>
      (mob.id === target.id || partyMems.includes(mob.target)) &&
      !isCryptSupporter(mob) &&
      !mob.immune &&
      (mob.s?.frozen?.ms ?? 0) < CRYPT.snowballGapMs &&
      Date.now() - (snowballAt[mob.id] ?? 0) > CRYPT.snowballGapMs &&
      is_in_range(mob, "snowball"),
  );
  if (!boss) return;

  snowballAt[boss.id] = Date.now();
  use_skill("snowball", boss);
}

/**
 * The warrior taunts off allies when it tanks; the priest absorbs off allies,
 * and curses a supporter's partner that is outrunning its heal.
 */
function useCryptSkills() {
  const mobOnAlly = Object.values(parent.entities).find(
    (mob) =>
      mob.type === "monster" &&
      (isCryptBoss(mob) || isCryptMinion(mob)) &&
      partyMems.includes(mob.target) &&
      mob.target !== character.name,
  );

  const canCast = (skill) =>
    character.mp > G.skills[skill].mp && !is_on_cooldown(skill);

  switch (character.ctype) {
    case "warrior":
      if (
        isAssignedAsTanker() &&
        mobOnAlly &&
        canCast("taunt") &&
        character.hp > character.max_hp * 0.4
      )
        use_skill("taunt", mobOnAlly);
      break;

    case "priest": {
      const allyUnderMob =
        isAssignedAsTanker() && mobOnAlly && get_player(mobOnAlly.target);
      const lowHpMember = partyMems
        .map((id) => get_entity(id))
        .find((member) => member && member.hp < member.max_hp * 0.3);
      // Only what we can hold on top of what is on us; the ally scares the rest
      const canHoldAbsorbed = (ally) => {
        const pile = [
          ...listOfMonsterAttacking(character),
          ...listOfMonsterAttacking(ally),
        ];
        return canHoldCryptBosses(
          pile.filter(isCryptBoss),
          getCryptFight(),
          pile.filter(
            (mob) =>
              !isCryptBoss(mob) && !CRYPT_MOBS.spawned.includes(mob.mtype),
          ),
        );
      };
      const allyToAbsorb = [allyUnderMob, lowHpMember].find(
        (ally) =>
          ally &&
          ally.name !== character.name &&
          is_in_range(ally, "absorb") &&
          canHoldAbsorbed(ally),
      );

      if (allyToAbsorb && canCast("absorb")) use_skill("absorb", allyToAbsorb);

      const strayPartner = Object.values(parent.entities)
        .filter((mob) => mob.type === "monster" && isCryptBoss(mob))
        .filter(isCryptSupporter)
        .map((supporter) => ({
          supporter,
          partner: parent.entities[supporter.focus],
        }))
        .find(
          ({ supporter, partner }) =>
            partner &&
            !partner.s?.cursed &&
            distance(supporter, partner) > CRYPT.supportHealRange * 0.75 &&
            is_in_range(partner, "curse"),
        )?.partner;
      if (strayPartner && canCast("curse")) use_skill("curse", strayPartner);
      break;
    }
  }
}

/**
 * Starts the run on a crypt that has aged enough, once the whole party is on
 * its realm.
 */
function startAgedCrypt() {
  const visit = get("cryptVisit");
  if (!visit || visit.isStarted || get("cryptInstance")) return;
  if (visit.realm !== getCurrentServer()) return;
  if (Date.now() - visit.openedAt < CRYPT.ageMs) return;
  if (!partyMems.every((name) => get_entity(name) || parent.party?.[name]))
    return;

  set("cryptVisit", { ...visit, isStarted: true });
  set("cryptInstance", visit.instance);
}

/** @returns {boolean} whether the error says the instance no longer exists on this realm */
function isCryptGone(error) {
  const realm = get("cryptVisit")?.realm;
  return (
    (!realm || realm === getCurrentServer()) &&
    /invalid/.test(`${error?.response} ${error?.reason}`)
  );
}

async function useCryptStrategy() {
  cryptPlan = undefined;
  startAgedCrypt();

  const instance = get("cryptInstance");
  if (!instance) return undefined;

  const realm = get("cryptVisit")?.realm;
  if (realm && realm !== getCurrentServer()) return undefined;

  if (character.map !== "crypt") {
    changeToNormalStrategies();
    advanceSmartMove({ ...CRYPT_JUNCTION[0] });
    return travelling();
  }

  if (cryptMemory.instance !== instance) resetCryptMemory(instance);

  publishCryptKit();
  const fight = getCryptFight();
  const bosses = noteCryptMobs();

  // Damage dealers shake off anything; the tanker zappers and what it can't hold
  const mobsOnMe = listOfMonsterAttacking(character);
  const shouldScare = isAssignedAsTanker()
    ? mobsOnMe.some((mob) => G.monsters[mob.mtype]?.abilities?.zap) ||
      !canHoldCryptBosses(mobsOnMe.filter(isCryptBoss), fight)
    : mobsOnMe.length > 0;
  if (shouldScare) await scareAwayMobs();

  // Nothing is judged without the tanker and the healer in view
  if (!fight.isReady) {
    changeToNormalStrategies();
    if (isAssignedAsTanker()) return travelling();
    const tanker = get_entity(TANKER);
    const isTankerDown = tanker
      ? tanker.rip
      : getCharacterInfo(TANKER)?.rip ||
        parent.party?.[TANKER]?.in !== character.in;
    if (isTankerDown) return escapeCrypt();
    followCryptLeader();
    return travelling();
  }

  const run = readCryptRun();
  const wanted = getWantedCryptBosses(run, fight);
  const minionsLeft = getCryptMinionsLeft(run);

  if (!minionsLeft && !wanted.length) {
    log("Crypt: cleared");
    set("cryptInstance", undefined);
    return undefined;
  }

  const plan = planCryptFight(bosses, fight, wanted, !minionsLeft);
  if (plan?.retreatFrom) {
    changeToNormalStrategies();
    return retreatInCrypt(plan.retreatFrom);
  }

  let target = plan?.target;
  if (target) {
    cryptPlan = { ...plan, at: Date.now() };
    changeToNormalStrategies();

    const isSupporterLeft =
      !run.isSupportGivenUp &&
      CRYPT_MOBS.supporters.some(
        (mtype) => !Object.values(run.killed).includes(mtype),
      );
    if (
      isSupporterLeft &&
      !minionsLeft &&
      !plan.dragTo &&
      wanted.length === 1 &&
      target.mtype === wanted[0]
    )
      return baitCryptSupporter(plan);

    cryptMemory.patrol.emptyStops = 0;

    // The others wait until the tanker has the boss it is pulling out
    if (
      plan.dragTo &&
      !isAssignedAsTanker() &&
      target.target !== fight.holder.name
    ) {
      followCryptLeader();
      return travelling();
    }

    // Zappers only land on whoever damaged the boss, so the tanker never does
    const spawns = cryptSpawnsOf(target);
    if (isAssignedAsTanker() && spawns.some((def) => def?.abilities?.zap)) {
      change_target(target);
      useCryptSkills();
      return travelling();
    }

    // Spawns that fight are splashed down
    if (spawns.some((def) => def?.attack > 0)) changeToPullStrategies();
    if (!plan.pairWith && !isMelee() && isCryptKitable(target, character))
      rangeRate = CRYPT.kiteRangeRate;
    freezeCryptBosses(bosses, target);
  } else if (minionsLeft) {
    target = pickCryptMinion(fight, wanted);
    if (!target) return travelling();
    changeToPullStrategies();
  } else {
    changeToNormalStrategies();
    patrolCrypt(wanted);
    return travelling();
  }

  useCryptSkills();
  return engage(target);
}

game.on("death", ({ id }) => {
  if (character.map !== "crypt" || character.in !== get("cryptInstance"))
    return;

  const mtype = parent.entities[id]?.mtype ?? cryptMemory.seenTypes?.[id];
  if (!CRYPT_MOBS.bosses.includes(mtype) && !CRYPT_MOBS.minions.includes(mtype))
    return;

  writeCryptRun((record) => (record.killed[id] = mtype));
});
