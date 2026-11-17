/** Tunables; distances in px */
const CRYPT = {
  bossRange: 300, // a boss on an ally this close is waited at from its back
  safeDistance: 450, // a junction is clear with no boss this close
  arrival: 100,
  reach: 200, // nest, bait stops, follow gap, clearance from the pack when tagging
  supportHealRange: 120, // server: a supporter heals its focus within this
  holdShare: 0.9, // share of party hps a fight may cost
  maxKillS: 900,
  kiteRangeRate: 0.85,
  memoryMs: 60_000, // backed-off bosses stay blocked, sightings stay fresh
  snowballGapMs: 1500,
  pairPatienceMs: 45_000,
  planStaleMs: 2000,
  untouchedSpawns: ["nerfedbat", "zapper0"], // the tanker holds their boss by absorb alone
  behindGap: 60, // waiting at a boss's back; natural aggro reaches ~32-64px, in front only
  // Hunt order once the vbats are done; a supporter in sight goes before all of them
  bossOrder: ["a3", "a7", "a2", "a8", "a4", "a6"],
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
  { x: 2504, y: -104 }, // looks into Spike's room from ~430px off his box
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
    snowballAt: {}, // boss id -> time
    patrol: { index: undefined, step: 1, emptyStops: 0, isShuffled: false },
    drag: undefined, // { id, spot }
    pairingSince: undefined,
    isScoutDone: false,
    wanted: undefined, // the tanker's own judgement, written for the followers
    writtenWanted: undefined, // JSON of the last wanted written
    unwritten: {}, // boss type -> sightings not yet in our run record
  };
}

const isCryptBoss = (mob) => CRYPT_MOBS.bosses.includes(mob?.mtype);
const isCryptMinion = (mob) => CRYPT_MOBS.minions.includes(mob?.mtype);
const isCryptSupporter = (mob) => CRYPT_MOBS.supporters.includes(mob.mtype);
const isCryptBlocked = (mtype) =>
  (cryptMemory.blockedUntil[mtype] ?? 0) > Date.now();

/** Sorts boss types by CRYPT.bossOrder, anything unlisted last */
const byCryptBossOrder = (lhs, rhs) => {
  const rank = (mtype) => {
    const index = CRYPT.bossOrder.indexOf(mtype);
    return index === -1 ? CRYPT.bossOrder.length : index;
  };
  return rank(lhs) - rank(rhs);
};

/** @returns {Object[]} G entries of what the boss spawns */
const cryptSpawnsOf = (mob) =>
  (G.monsters[mob.mtype]?.spawns ?? []).map(([, mtype]) => G.monsters[mtype]);

function nearestCryptSpot(from, spots) {
  return [...spots].sort(
    (lhs, rhs) => distance(from, lhs) - distance(from, rhs),
  )[0];
}

/** @returns {{killed: Object<string, string>, isMinionsSwept?: boolean, isSupportGivenUp?: boolean}} */
const readCryptRun = () => readDungeonRun("crypt");

function getCryptMinionsLeft(run) {
  if (run.isMinionsSwept) return 0;
  const killed = Object.values(run.killed).filter((mtype) =>
    CRYPT_MOBS.minions.includes(mtype),
  ).length;
  return Math.max(CRYPT_MOBS.minionCount - killed, 0);
}

/**
 * Shares our kit, once a second, and writes what we saw into our run record:
 * every boss in sight, so the whole party works off one map of the crypt.
 * The tanker also writes what it judged worth fighting.
 */
function publishCryptKit() {
  if (Date.now() - cryptMemory.publishedAt < 1000) return;
  cryptMemory.publishedAt = Date.now();

  publishCharacterInfo({
    cryptFreeze: getOwnFreezeUptime(),
    cryptScare:
      locate_item("jacko") !== -1 || character.slots.orb?.name === "jacko",
  });

  const seen = cryptMemory.unwritten;
  const wanted = isAssignedAsTanker() ? cryptMemory.wanted : undefined;
  const isWantedNew =
    !!wanted && JSON.stringify(wanted) !== cryptMemory.writtenWanted;
  if (!Object.keys(seen).length && !isWantedNew) return;

  writeDungeonRun("crypt", (record) => {
    record.sightings = { ...record.sightings, ...seen };
    if (isWantedNew) record.wanted = wanted;
  });
  cryptMemory.unwritten = {};
  if (isWantedNew) cryptMemory.writtenWanted = JSON.stringify(wanted);
}

/** Records a sighting, written to the run on the next publish */
function noteCryptSighting(mtype, spot) {
  cryptMemory.sightings[mtype] = spot;
  cryptMemory.unwritten[mtype] = spot;
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

  for (const [mtype, spot] of Object.entries(readCryptRun().sightings))
    if (spot.at > (sightings[mtype]?.at ?? -1)) sightings[mtype] = spot;

  for (const mob of Object.values(parent.entities)) {
    if (mob.type !== "monster" || mob.dead) continue;
    if (!isCryptBoss(mob) && !isCryptMinion(mob)) continue;

    noteDungeonMob(mob);
    if (!isCryptBoss(mob)) continue;

    bosses.push(mob);
    noteCryptSighting(mob.mtype, {
      map: "crypt",
      x: mob.x,
      y: mob.y,
      level: mob.level,
      at: Date.now(),
    });
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

/** Heal per second a boss's zappers cost, their life being our scare cooldown or, without jackos, their degen */
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
    // Server: one spawn per interval beside a random damager, cleared with its owner's
    // scare, so half a cycle's worth stand on average, each zapping mostly its owner
    const standing = lifeMs / 2 / intervalMs;
    return total + (zap.amount / zap.cooldown) * 1000 * standing;
  }, 0);
}

/** @returns {boolean} whether the victim outranges the boss and outruns it frozen; never a supporter */
function isCryptKitable(boss, victim) {
  const def = G.monsters[boss.mtype];
  return (
    !def.supporter &&
    victim.range > Math.max(def.range * 2, 75) &&
    victim.speed > (def.charge ?? def.speed) + G.conditions.frozen.speed
  );
}

/**
 * @param {Object} boss - an entity, or a G.monsters entry shaped like one
 * @param {Object} fight - from getCryptFight
 * @returns {number} its dps on the holder, plus for an anger boss one hit on
 * whoever it hurts most per anger: the holder takes it back within a hit.
 * Frozen it swings slower, and misses whoever kites it.
 */
function cryptBossDps(boss, fight) {
  const def = G.monsters[boss.mtype];
  const frozenShare = (victim) =>
    isCryptKitable(boss, victim) ? 0 : G.conditions.frozen.frequencym;
  const dpsOn = (victim) =>
    calculateDamage(boss, victim) *
    (1 - fight.freezeUptime * (1 - frozenShare(victim)));

  const anger = def.abilities?.anger;
  const angerDps =
    anger && fight.party.length
      ? Math.max(...fight.party.map(dpsOn)) /
        (boss.frequency ?? def.frequency) /
        (anger.cooldown / 1000)
      : 0;

  return dpsOn(fight.holder) + angerDps + cryptSpawnDps(def, fight);
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
 * Boss types still worth going after: alive, holdable and killable on their
 * own. Supporters are only killed off a partner, so they never count.
 * @returns {string[]}
 */
function getWantedCryptBosses(run, fight) {
  const killed = Object.values(run.killed);
  const openedAt = getActiveDungeonVisit("crypt")?.openedAt;
  const ageMs = openedAt ? Date.now() - openedAt : 0;

  return CRYPT_MOBS.bosses
    .filter((mtype) => {
      if (killed.includes(mtype) || CRYPT_MOBS.supporters.includes(mtype))
        return false;

      const boss = agedBoss(mtype, ageMs);
      return (
        canHoldCryptBosses([boss], fight, []) &&
        isCryptKillable(boss, [], fight.party)
      );
    })
    .sort(byCryptBossOrder);
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
  // Server: an idle boss only comes at us by anger (ticks idle too) or by natural aggro, ~64px in front
  const angerReach = (boss) =>
    G.monsters[boss.mtype].abilities?.anger?.radius ?? 0;
  const willEngage = (boss) =>
    partyMems.includes(boss.target) ||
    fight.party.some((member) => distance(member, boss) < angerReach(boss));
  const threats = bosses.filter(willEngage);
  // A supporter in sight first, then the wanted ones in CRYPT.bossOrder
  const hunted = isHunting
    ? bosses
        .filter(
          (boss) =>
            (isCryptSupporter(boss) || wanted.includes(boss.mtype)) &&
            !isCryptBlocked(boss.mtype),
        )
        .sort(
          (lhs, rhs) =>
            isCryptSupporter(rhs) - isCryptSupporter(lhs) ||
            byCryptBossOrder(lhs.mtype, rhs.mtype) ||
            distance(fight.holder, lhs) - distance(fight.holder, rhs),
        )
    : [];
  const seed = nearestCryptSpot(fight.holder, threats) ?? hunted[0];
  if (!seed) return undefined;

  // An idle partner by her side is no part of the fight: she is hit freely
  const cluster = bosses.filter(
    (boss) => boss.id === seed.id || threats.includes(boss),
  );

  if (canHoldCryptBosses(cluster, fight)) {
    cryptMemory.drag = undefined;

    const order = cluster
      .filter((boss) => isCryptKillable(boss, bosses, fight.party))
      .sort(
        (lhs, rhs) =>
          isCryptSupporter(rhs) - isCryptSupporter(lhs) ||
          byCryptBossOrder(lhs.mtype, rhs.mtype) ||
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

  // Server: she heals her focus only within 120 and trails it, so the holder stands on her, not orbits
  const supporter =
    cryptPlan.pairWith && parent.entities[cryptPlan.pairWith.id];
  return supporter && { spot: { x: supporter.x, y: supporter.y }, isDrag: false };
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

/**
 * What the tanker last judged worth fighting, shared because a follower out of
 * the healer's view can't judge it; before any word, every boss left but a supporter.
 * @returns {string[]}
 */
function getPartyWantedCryptBosses(run = readCryptRun()) {
  const record = get(`cryptRun:${TANKER}`);
  const killed = Object.values(run.killed);
  if (record?.instance === cryptMemory.instance && record.wanted)
    return record.wanted.filter((mtype) => !killed.includes(mtype));
  return CRYPT_MOBS.bosses
    .filter(
      (mtype) =>
        !killed.includes(mtype) && !CRYPT_MOBS.supporters.includes(mtype),
    )
    .sort(byCryptBossOrder);
}

/** @returns {Object|undefined} a free boss in view the party wants, found for the tanker to come to */
function getFoundCryptBoss(wanted) {
  return nearestCryptSpot(
    character,
    Object.values(parent.entities).filter(
      (mob) =>
        mob.type === "monster" &&
        !mob.dead &&
        !mob.target &&
        wanted.includes(mob.mtype) &&
        !isCryptBlocked(mob.mtype),
    ),
  );
}

/** @returns {boolean} whether there is a gather point, walked to until a boss turns on us or a wanted one shows */
const gatherInCrypt = (wanted = []) =>
  gatherInDungeon(() => shouldStopCryptTrip(wanted));

/**
 * Stands at its back, calling the party to it. Server: natural aggro needs an
 * untargeted boss, us within its range in the 32px grid around it, and in
 * front of it (±45° of its `angle`), so its back is safe at any gap.
 */
function standBehindCryptBoss(boss) {
  setDungeonGoal(boss, true);
  const facing =
    boss.angle !== undefined
      ? (boss.angle * Math.PI) / 180
      : Math.atan2(boss.y - character.real_y, boss.x - character.real_x);
  parkAt({
    x: boss.x - Math.cos(facing) * CRYPT.behindGap,
    y: boss.y - Math.sin(facing) * CRYPT.behindGap,
  });
}

/** @param {string[]} wanted - boss types worth stopping for on the way */
function walkToCryptNest(wanted) {
  setDungeonGoal(CRYPT_MOBS.nest);
  advanceSmartMove(
    { ...CRYPT_MOBS.nest },
    {
      useScare: true,
      stopWatcher: () =>
        Object.values(parent.entities).some(isCryptMinion) ||
        shouldStopCryptTrip(wanted),
    },
  ).catch(() => {});
}

/**
 * Out of a fight: a boss on me sends me to a clear junction; one busy with an
 * ally close by, or a free one the tanker wants anywhere in view, is waited at
 * from its back until the tanker comes. Else we go to the gather point, else
 * set it ourselves: the nest while minions are left, the lap after.
 * @returns {Object} travelling
 */
function walkCryptAlone() {
  const bosses = Object.values(parent.entities).filter(
    (mob) => mob.type === "monster" && !mob.dead && isCryptBoss(mob),
  );

  const bossOnMe = bosses.find((boss) => boss.target === character.name);
  if (bossOnMe) {
    const spot = getClearCryptJunction([bossOnMe], character);
    if (spot && distance(character, spot) > CRYPT.arrival)
      advanceSmartMove(spot, { useScare: true }).catch(() => {});
    return travelling();
  }

  const busyBoss = bosses.find(
    (boss) =>
      partyMems.includes(boss.target) &&
      distance(character, boss) < CRYPT.bossRange,
  );
  if (busyBoss) {
    setDungeonGoal(busyBoss, true);
    holdBehindCryptBoss(busyBoss);
    return travelling();
  }

  const run = readCryptRun();
  const wanted = getPartyWantedCryptBosses(run);
  const found = getFoundCryptBoss(wanted);
  if (found) {
    standBehindCryptBoss(found);
    return travelling();
  }

  if (gatherInCrypt(wanted)) return travelling();

  const killed = Object.values(run.killed);
  const unkilled = CRYPT_MOBS.bosses.filter((mtype) => !killed.includes(mtype));
  const stopWatcher = () =>
    isCryptBossOnUs() ||
    !!getFoundCryptBoss(wanted) ||
    !!getDungeonGatherPoint();

  const spot =
    getCryptMinionsLeft(run) > 0
      ? CRYPT_MOBS.nest
      : getCryptPatrolStop(unkilled);
  if (spot && distance(character, spot) > CRYPT.arrival) {
    setDungeonGoal(spot);
    advanceSmartMove(
      { map: "crypt", x: spot.x, y: spot.y },
      { useScare: true, stopWatcher },
    ).catch(() => {});
  }
  return travelling();
}

/** Stands on the far side of a boss from whoever it chases, out of its way */
function holdBehindCryptBoss(boss) {
  const victim = get_entity(boss.target);
  if (!victim) {
    gatherInCrypt();
    return;
  }

  const dx = boss.x - victim.x;
  const dy = boss.y - victim.y;
  const length = Math.hypot(dx, dy) || 1;
  parkAt({
    x: boss.x + (dx / length) * CRYPT.behindGap,
    y: boss.y + (dy / length) * CRYPT.behindGap,
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
    gatherInCrypt();
    return travelling();
  }

  log("Crypt: backing off");
  const spot = getClearCryptJunction([], character) ?? CRYPT_JUNCTION[0];
  setDungeonGoal(spot);
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
      writeDungeonRun("crypt", (record) => (record.isMinionsSwept = true));
    else walkToCryptNest(wanted);
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
 * Where the search goes next: the first sought type, in CRYPT.bossOrder, with a
 * known spot, else the next junction of the lap.
 * @param {string[]} sought - boss types looked for
 * @param {number} [reach] - how close counts as having reached a stop
 * @returns {Object|undefined} undefined once the shuffled lap also turned up none of them
 */
function getCryptPatrolStop(sought, reach = CRYPT.arrival) {
  const { patrol } = cryptMemory;

  for (const [mtype, sighting] of Object.entries(knownCryptSightings())) {
    if (
      distance(character, sighting) < reach &&
      !get_nearest_monster({ type: mtype })
    )
      noteCryptSighting(mtype, { isGone: true, at: Date.now() });
  }
  const sightings = knownCryptSightings();

  const first = [...sought]
    .sort(byCryptBossOrder)
    .find((mtype) => sightings[mtype] && !isCryptBlocked(mtype));
  if (first)
    return { map: "crypt", x: sightings[first].x, y: sightings[first].y };

  const laps = CRYPT_JUNCTION.length;
  patrol.index ??= CRYPT_JUNCTION.indexOf(
    nearestCryptSpot(character, CRYPT_JUNCTION),
  );
  const next = () => (patrol.index = (patrol.index + patrol.step + laps) % laps);

  if (distance(character, CRYPT_JUNCTION[patrol.index]) < reach) {
    patrol.emptyStops++;
    if (patrol.emptyStops >= laps) {
      patrol.emptyStops = 0;
      if (patrol.isShuffled) return undefined;

      // A full lap turned up nothing: each of us takes its own share, every other one backwards
      const rank = Math.max(partyMems.indexOf(character.name), 0);
      patrol.isShuffled = true;
      patrol.step = rank % 2 ? -1 : 1;
      patrol.index =
        (patrol.index +
          Math.round((rank * laps) / Math.max(partyMems.length, 1))) %
        laps;
    } else next();
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
    skipped < laps && isAvoided(CRYPT_JUNCTION[patrol.index]);
    skipped++
  )
    next();

  const { x, y } = CRYPT_JUNCTION[patrol.index];
  return { map: "crypt", x, y };
}

/** Everyone walks the search lap; a full lap with nothing to fight closes the run. */
function patrolCrypt(wanted) {
  const stop = getCryptPatrolStop(wanted);
  if (!stop) {
    log("Crypt: nothing left to fight");
    closeCryptRun();
    return;
  }

  setDungeonGoal(stop);
  const known = Object.keys(knownCryptSightings());
  const unknown = wanted.filter((mtype) => !known.includes(mtype));
  advanceSmartMove(stop, {
    useScare: true,
    stopWatcher: () =>
      shouldStopCryptTrip(wanted) || hasNewCryptSighting(unknown),
  }).catch(() => {});
}

/**
 * Read mid-trip, when our own sightings are not merged.
 * @param {string[]} types - boss types
 * @returns {boolean} whether the run record has one of them newer than our last word on it
 */
function hasNewCryptSighting(types) {
  const { sightings } = readCryptRun();
  return types.some((mtype) => {
    const spot = sightings[mtype];
    return (
      spot &&
      !spot.isGone &&
      !isCryptBlocked(mtype) &&
      spot.at > (cryptMemory.sightings[mtype]?.at ?? -1)
    );
  });
}

/**
 * The mage blinks ahead on the lap while a boss is unaccounted for, and turns
 * back on sighting one; the sighting is shared. A lap with nothing ends it.
 * @returns {boolean} whether it is scouting
 */
function scoutCrypt() {
  if (character.ctype !== "mage" || cryptMemory.isScoutDone) return false;

  const run = readCryptRun();
  if (getCryptMinionsLeft(run) > 0) return false;

  const killed = Object.values(run.killed);
  const known = knownCryptSightings();
  const unseen = CRYPT_MOBS.bosses.filter(
    (mtype) => !killed.includes(mtype) && !known[mtype],
  );
  if (!unseen.length) return false;

  const stop = getCryptPatrolStop(unseen);
  if (!stop) {
    cryptMemory.isScoutDone = true;
    return false;
  }

  advanceSmartMove(stop, {
    useScare: true,
    stopWatcher: () =>
      Object.values(parent.entities).some(
        (mob) => mob.type === "monster" && !mob.dead && isCryptBoss(mob),
      ),
  }).catch(() => {});
  return true;
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
  if (!isAssignedAsTanker()) {
    if (plan.target.target === TANKER) holdBehindCryptBoss(plan.target);
    else gatherInCrypt();
    return travelling();
  }

  change_target(plan.target);
  const giveUp = () => {
    log("Crypt: giving the supporter up");
    writeDungeonRun("crypt", (record) => (record.isSupportGivenUp = true));
  };

  if (plan.pairWith) {
    cryptMemory.pairingSince ??= Date.now();
    if (Date.now() - cryptMemory.pairingSince > CRYPT.pairPatienceMs) giveUp();
    return travelling();
  }
  cryptMemory.pairingSince = undefined;

  const stop = getCryptPatrolStop(CRYPT_MOBS.supporters, CRYPT.reach);
  if (stop) {
    cryptPlan = { target: plan.target, dragTo: stop, at: Date.now() };
    setDungeonGoal(stop);
  } else giveUp();

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
 * Read by the priest's absorb picker: only a pile we can hold on top of what
 * is on us is taken; the ally scares the rest.
 * @returns {boolean}
 */
function canAbsorbInCrypt(ally) {
  const pile = [
    ...listOfMonsterAttacking(character),
    ...listOfMonsterAttacking(ally),
  ];
  return canHoldCryptBosses(
    pile.filter(isCryptBoss),
    getCryptFight(),
    pile.filter(
      (mob) => !isCryptBoss(mob) && !CRYPT_MOBS.spawned.includes(mob.mtype),
    ),
  );
}

/**
 * Read by the priest's curse picker: a supporter's partner outrunning its heal.
 * @returns {Object|undefined}
 */
function getStrayCryptPartner() {
  if (character.mp < G.skills.curse.mp) return undefined;

  return Object.values(parent.entities)
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
}

/** Ends the run, kept with its kills and boss levels while mobs remain */
function closeCryptRun() {
  const visit = getActiveDungeonVisit("crypt");
  const run = readCryptRun();
  const killed = Object.values(run.killed);
  const hasMobsLeft =
    CRYPT_MOBS.bosses.some((mtype) => !killed.includes(mtype)) ||
    getCryptMinionsLeft(run) > 0;

  closeDungeonRun("crypt", {
    kept: visit &&
      hasMobsLeft && {
        killed: run.killed,
        isMinionsSwept: run.isMinionsSwept,
        bossLevels: Object.fromEntries(
          CRYPT_MOBS.bosses
            .filter((mtype) => !killed.includes(mtype))
            .map((mtype) => [
              mtype,
              cryptMemory.sightings?.[mtype]?.level ??
                agedBoss(mtype, Date.now() - visit.openedAt).level,
            ]),
        ),
      },
  });
}

async function useCryptStrategy() {
  cryptPlan = undefined;
  startNextDungeonRun();

  const instance = getDungeonInstance("crypt");
  if (!instance || !isDungeonRunHere("crypt")) return undefined;

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
    if (isAssignedAsTanker()) return walkCryptAlone();
    if (isDungeonTankerDown()) return escapeCrypt();
    if (!bosses.length && !mobsOnMe.length && scoutCrypt()) return travelling();
    return walkCryptAlone();
  }

  const run = readCryptRun();
  const wanted = getWantedCryptBosses(run, fight);
  if (isAssignedAsTanker()) cryptMemory.wanted = wanted;
  const minionsLeft = getCryptMinionsLeft(run);

  if (!minionsLeft && !wanted.length) {
    log("Crypt: cleared");
    closeCryptRun();
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
    setDungeonGoal(plan.dragTo ?? target, true);
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
      gatherInCrypt();
      return travelling();
    }

    // Spawns only land on whoever damaged the boss, so the tanker never does
    const spawns = cryptSpawnsOf(target);
    const isHeldUntouched = (G.monsters[target.mtype].spawns ?? []).some(
      ([, mtype]) => CRYPT.untouchedSpawns.includes(mtype),
    );
    if (isAssignedAsTanker() && isHeldUntouched) {
      change_target(target);
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
    setDungeonGoal(target, true);
    changeToPullStrategies();
  } else {
    changeToNormalStrategies();
    patrolCrypt(wanted);
    return travelling();
  }

  return engage(target);
}
