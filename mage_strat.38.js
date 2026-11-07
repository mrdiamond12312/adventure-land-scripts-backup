// Mage: weapon and gear scored together under the mp budget, and cburst targeting

// Sleeping mobs a single cburst must wake to be worth the mp
const CBURST_MIN_BATCH = 3;
/** Cooldown pull mode adds after each cburst */
const CBURST_COOLDOWN_PAD_MS = 6000;

const MAGE_MP_HORIZON_S = 10;
const MAGE_RESERVED_BLINKS = 2;
const MAGE_GEAR_SWAP_MIN_GAIN = 0.03;
const MAGE_GEAR_REUSE_MS = 500;
const MAGE_MAINHAND_SLOT = /^mainhand$/;
const MAGE_WEAPON_SLOT = /^(mainhand|offhand)$/;
/** The crypt's single-target weapons once the froststaff has frozen the target */
const MAGE_CRYPT_STAFFS = ["froststaff", "firestaff"];

/** @returns {number} mp the gear choice leaves alone: a magiport and the blinks */
const mageMpReserve = (stats = character) =>
  (G.skills["magiport"].mp + MAGE_RESERVED_BLINKS * G.skills["blink"].mp) *
  (1 - (stats.mp_reduction ?? 0) / 100);

const REFLECTOR_WATCH_MS = 10_000;
const ROGUE_SHIELD_DAMAGE_RATIO = 2;
let reflectorWatch = { id: undefined, baselines: {} };

/** @returns {number} `pdps` per second on this boss, 0 until watched */
function watchedDamageRate(player) {
  const now = Date.now();
  const pdps = player.pdps ?? 0;
  const baseline = reflectorWatch.baselines[player.name];
  if (!baseline || pdps < baseline.pdps) {
    reflectorWatch.baselines[player.name] = { pdps, at: now };
    return 0;
  }
  const watchedMs = now - baseline.at;
  return watchedMs < REFLECTOR_WATCH_MS
    ? 0
    : (pdps - baseline.pdps) / (watchedMs / 1000);
}

/** @returns {Object|undefined} who to shield now */
function getFrostballReflector(boss) {
  if (reflectorWatch.id !== boss.id)
    reflectorWatch = { id: boss.id, baselines: {} };

  const best = [character, get_player(ROGUE)]
    .filter(
      (player) =>
        player &&
        !player.rip &&
        is_in_range(player, "reflection") &&
        distance(player, boss) < MULTI_FREEZE_RANGE,
    )
    .map((player) => ({
      player,
      worth:
        watchedDamageRate(player) *
        (player === character ? ROGUE_SHIELD_DAMAGE_RATIO : 1),
    }))
    .sort((lhs, rhs) => rhs.worth - lhs.worth)[0];
  if (!(best?.worth > 0)) return undefined;

  const flightMs =
    (distance(boss, best.player) / G.projectiles.frostball.speed) * 1000;
  return isFrostballDue(boss, G.conditions.reflection.duration, flightMs)
    ? best.player
    : undefined;
}

/** @returns {[string, number][]} skill → cooldown padding, for the skills drawing on the attack mp */
function mageBusySkills() {
  const known = (skill) => character.level >= (G.skills[skill].level ?? 0);
  return [
    currentStrategy === usePullStrategies &&
      known("cburst") && ["cburst", CBURST_COOLDOWN_PAD_MS],
    (avgPartyDmgTaken(partyMems, "magical") > 0 || getFrostballBoss()) &&
      known("reflection") && ["reflection", 0],
  ].filter(Boolean);
}

/** @returns {number} frequency points self-energize adds on average, less the burst already in ours */
function energizeFrequencyDelta() {
  const { frequency, duration } = G.conditions.energized;
  const average =
    character.level >= G.skills.energize.level && isSelfEnergizeTarget()
      ? (frequency * duration) / G.skills.energize.cooldown
      : 0;
  return average - (character.s.energized ? frequency : 0);
}

const ENERGIZE_LEAD_MARGIN_MS = 20;
const ENERGIZE_WAKE_FLOOR_MS = 10;
const ENERGIZE_BUFF_MARGIN_MS = 100;
const ENERGIZE_MIN_SAVED_SHARE = 0.5;
const ENERGIZE_WATCH_MS = 15_000;
const ENERGIZE_SKIPPED_CLASSES = ["priest", "merchant"];
const energizeDamageWatch = {};
let lastMageShot = { at: 0, cooldown: undefined };

/** @returns {number} `pdps` per second over the last finished window */
function recentDamageRate(player) {
  const now = Date.now();
  const pdps = player.pdps ?? 0;
  const watch = energizeDamageWatch[player.name];
  if (!watch || pdps < watch.pdps) {
    energizeDamageWatch[player.name] = { pdps, at: now, rate: watch?.rate ?? 0 };
    return watch?.rate ?? 0;
  }
  if (now - watch.at >= ENERGIZE_WATCH_MS) {
    watch.rate = (pdps - watch.pdps) / ((now - watch.at) / 1000);
    watch.pdps = pdps;
    watch.at = now;
  }
  return watch.rate;
}

/** @returns {boolean} whether the ally shot within two cycles */
function isAllyShooting(player) {
  const shotAt = getCharacterInfo(player.name)?.lastShotAt;
  return !!shotAt && Date.now() - shotAt < 2000 / player.frequency;
}

/** @returns {number} the player's attack cycle with energize */
function cycleWithEnergizeMs(player) {
  const { frequency } = G.conditions.energized;
  const boost = (frequency / 100) * conditionFrequencyScale(player);
  return 1000 / (player.frequency + boost);
}

/** @returns {boolean} whether the ally's penalty eats most of what energize saves */
function isAllyPenaltyBlocking(player) {
  const { penaltyUntil, lastShotAt } = getCharacterInfo(player.name) ?? {};
  if (!penaltyUntil || !lastShotAt) return false;

  const normalReady = lastShotAt + 1000 / player.frequency;
  const energizedReady = lastShotAt + cycleWithEnergizeMs(player);
  const saved = normalReady - Math.max(energizedReady, penaltyUntil);
  return saved < (normalReady - energizedReady) * ENERGIZE_MIN_SAVED_SHARE;
}

/** @returns {Object} who gains the most from energize */
function getEnergizeDamageTarget() {
  const allies = [...getAlliedNames()]
    .filter((name) => name !== character.name && isOwnedCharacter(name))
    .map((name) => get_player(name))
    .filter(
      (player) =>
        player &&
        !player.rip &&
        !ENERGIZE_SKIPPED_CLASSES.includes(player.ctype) &&
        is_in_range(player, "energize") &&
        isAllyShooting(player) &&
        !isAllyPenaltyBlocking(player),
    );
  const damagePerShot = (player) =>
    recentDamageRate(player) / Math.max(player.frequency, 0.01);
  return [character, ...allies].reduce((best, player) =>
    damagePerShot(player) > damagePerShot(best) ? player : best,
  );
}

const isSelfEnergizeTarget = () => getEnergizeDamageTarget() === character;

/** @returns {boolean} whether energize landing now comes after the ally's swaps and before his shot */
function isAllyEnergizeDue(player) {
  const shotAt = getCharacterInfo(player.name)?.lastShotAt;
  if (!shotAt) return true;

  const { duration } = G.conditions.energized;
  const energizedMs = cycleWithEnergizeMs(player);
  const normalMs = 1000 / player.frequency;
  const earliest = Math.max(
    normalMs - energizeLeadMs(player),
    (energizedMs <= duration ? 2 * energizedMs : energizedMs) -
      duration +
      ENERGIZE_BUFF_MARGIN_MS,
  );
  const latest = normalMs - character.ping;
  if (latest <= earliest) return true;

  const elapsed = Date.now() - shotAt + character.ping / 2;
  return elapsed >= earliest && elapsed <= latest;
}

function markMageShot() {
  lastMageShot = { at: Date.now(), cooldown: parent.next_skill.attack };
}

/** @returns {boolean} whether the last shot's reply is still out */
function isMageShotInFlight() {
  return (
    parent.next_skill.attack === lastMageShot.cooldown &&
    Date.now() - lastMageShot.at < 2 * character.ping + 100
  );
}

/**
 * @param {Object} [player]
 * @returns {number} ms before the player's normal shot that energize already makes it ready
 */
function energizeLeadMs(player = character) {
  return Math.max(
    0,
    1000 / player.frequency -
      cycleWithEnergizeMs(player) -
      ENERGIZE_LEAD_MARGIN_MS,
  );
}

/** @returns {boolean} whether a shot now should carry self-energize */
function isSelfEnergizeDue() {
  return (
    !is_on_cooldown("energize") &&
    !isEquipingItems &&
    !unansweredPenaltyMs &&
    !character.s.penalty_cd &&
    isSelfEnergizeTarget()
  );
}

/** @returns {boolean} whether the mage can shoot now */
function canMageAct() {
  if (isMageShotInFlight()) return false;
  if (canActOnAttackCooldown()) return true;
  return (
    !isOnTrip() &&
    !Object.keys(character.c).length &&
    ms_to_next_skill("attack") <= energizeLeadMs() &&
    isSelfEnergizeDue()
  );
}

/** @returns {number} ms until the action loop looks again */
function mageLoopInterval() {
  const interval = getLoopInterval();
  const attackMs = ms_to_next_skill("attack");
  if (!attackMs || !isSelfEnergizeTarget()) return interval;

  const earlyMs = Math.max(
    attackMs - energizeLeadMs(),
    ms_to_next_skill("energize"),
  );
  return earlyMs < attackMs
    ? Math.min(interval, Math.max(ENERGIZE_WAKE_FLOOR_MS, earlyMs))
    : interval;
}

/** @returns {number} piercing the impact swap adds */
function impactSwapPiercing(mainhand, frequency, target, swapPiercing) {
  const gain = swapPiercing - weaponPiercing(mainhand);
  if (gain < PIERCING_SWAP_MIN_GAIN) return 0;
  const holdMs = 1000 / frequency - character.ping - 2 * EQUIP_PENALTY_MS;
  return projectileEtaMs(target, mainhand) < holdMs ? gain / 2 : 0;
}

const BURN_PROC_JUMP_MS = 500;
let burnRivals = {
  id: undefined,
  since: 0,
  procs: 0,
  outsiderProcs: 0,
  owner: undefined,
  endsAt: 0,
};

/** @returns {{holdSeconds: number, refreshEverySeconds: number}} others' burn proc rates */
function burnRivalRates(target) {
  const now = Date.now();
  if (burnRivals.id !== target.id)
    burnRivals = {
      id: target.id,
      since: now,
      procs: 0,
      outsiderProcs: 0,
      owner: undefined,
      endsAt: 0,
    };

  const burn = target.s?.burned;
  if (burn && burn.f !== character.name) {
    const endsAt = now + (burn.ms ?? 0);
    if (
      burnRivals.owner &&
      (burn.f !== burnRivals.owner ||
        endsAt > burnRivals.endsAt + BURN_PROC_JUMP_MS)
    ) {
      burnRivals.procs++;
      if (!isOwnedCharacter(burn.f)) burnRivals.outsiderProcs++;
    }
    burnRivals.owner = burn.f;
    burnRivals.endsAt = endsAt;
  }

  const watchedSeconds = (now - burnRivals.since) / 1000;
  return {
    holdSeconds: burnRivals.outsiderProcs
      ? Math.min(BURN_SECONDS, watchedSeconds / burnRivals.outsiderProcs)
      : BURN_SECONDS,
    refreshEverySeconds: burnRivals.procs
      ? watchedSeconds / burnRivals.procs
      : Infinity,
  };
}

/**
 * @param {number} hit - damage before crit
 * @param {Object} stats - projected stats
 * @param {Object} target
 * @param {number} procsPerSecond
 * @param {{holdSeconds: number, refreshEverySeconds: number}} rivals
 * @returns {number} burn damage per second his procs earn
 */
function burnProcDps(hit, stats, target, procsPerSecond, rivals) {
  const carryOver = (1 - (target.firesistance ?? 0) / 100) / 3;
  const coverage = 1 - Math.exp(-BURN_SECONDS * procsPerSecond);
  const steady = (hit * averageCritFactor(stats)) / (1 - carryOver * coverage);
  const burn = target.s?.burned;
  const old = burn?.intensity ?? 0;

  if (!burn || (burn.f === character.name && old <= steady))
    return steady * BURN_DPS_PER_INTENSITY * coverage;

  const crit = Math.min(stats.crit ?? 0, 100) / 100;
  const raisedBy = (roll) => Math.max(old, carryOver * old + roll);
  const raised =
    (1 - crit) * raisedBy(hit) +
    crit * raisedBy(hit * critMultiplier(stats));
  const secondsLeft = (burn.ms ?? 0) / 1000;
  const lapseChance = Math.exp(-secondsLeft / rivals.refreshEverySeconds);
  const earnedSeconds =
    target.cooperative && !isOwnedCharacter(burn.f)
      ? raised * rivals.holdSeconds
      : (raised - old) * BURN_SECONDS +
        old * Math.max(0, BURN_SECONDS - secondsLeft) * lapseChance;
  return (earnedSeconds * BURN_DPS_PER_INTENSITY * coverage) / BURN_SECONDS;
}

/**
 * Shots under the mp budget, and what they land on `target` and the mobs its splash reaches.
 * @returns {{shots: number, landedHits: number, dps: number}}
 */
function mageFightModel(projected, picks, target, worn, context) {
  const mainhand = handWith(picks, worn, "mainhand");
  const wornModifier = classWeaponModifier(worn.mainhand).modifier;
  const modifier = classWeaponModifier(mainhand).modifier;
  const frequency =
    projected.frequency +
    (((modifier.frequency ?? 0) -
      (wornModifier.frequency ?? 0) +
      context.energizeDelta) /
      100) *
      conditionFrequencyScale(character);
  const mpCost = Math.max(
    1,
    projected.mp_cost + (modifier.mp_cost ?? 0) - (wornModifier.mp_cost ?? 0),
  );

  const def = G.monsters[target.mtype] ?? {};
  const avoidance = (target.avoidance ?? def.avoidance ?? 0) / 100;
  const reflection = (target.reflection ?? def.reflection ?? 0) / 100;
  const land = (1 - avoidance) * (1 - reflection);
  const hp = target.max_hp ?? target.hp ?? 0;
  const rawHit =
    projected.attack *
    mitigation(projected, target, {
      extraPiercing: impactSwapPiercing(
        mainhand,
        frequency,
        target,
        context.swapPiercing,
      ),
    });

  const restore = gearAbilityWith(picks, "restore_mp", worn);
  const skillMp = context.skills.reduce(
    (sum, [skill, padMs]) =>
      sum +
      castMpCost(G.skills[skill].mp, projected, restore) /
        ((G.skills[skill].cooldown + padMs) / 1000),
    0,
  );
  const income =
    context.mpIncome +
    Math.max(0, character.mp - mageMpReserve(projected)) / MAGE_MP_HORIZON_S +
    Math.min(
      (frequency * land * rawHit * (projected.manasteal ?? 0)) / 100,
      (target.mp ?? 0) / MANASTEAL_HORIZON_S,
    ) -
    skillMp;
  const attackCost = castMpCost(mpCost, projected, restore);
  const shots =
    attackCost > 0
      ? Math.min(frequency, Math.max(0, income) / attackCost)
      : frequency;

  const blast = Object.keys(worn).reduce(
    (sum, slot) => sum + splashOf(slot in picks ? picks[slot] : worn[slot]),
    0,
  );
  const splashed = blast
    ? Math.max(0, context.clusterOf(target, blast / BLAST_DIVISOR) - 1) *
      (1 - avoidance)
    : 0;
  const landedHits = shots * land * (1 + splashed);
  const crit = Math.min(projected.crit ?? 0, 100) / 100;

  if (target["1hp"])
    return { shots, landedHits, dps: shots * land * (1 + crit + splashed) };

  const hexed = G.conditions.hexed;
  const hexChance = gearAbilityWith(picks, "hex", worn).attr0 / 100;
  const hexAmp =
    !hexed || target.s?.hexed || target.s?.cursed
      ? 1
      : 1 +
        (hexed.incdmgamp / 100) *
          (1 - Math.exp((-hexed.duration / 1000) * shots * land * hexChance));

  const hit = rawHit * hexAmp;
  const main =
    (1 - crit) * Math.min(hit, hp) +
    crit * Math.min(hit * critMultiplier(projected), hp);
  const splash = Math.min(
    (hit *
      averageCritFactor(projected) *
      damage_multiplier(target.resistance ?? 0) *
      blast) /
      100,
    hp,
  );

  const burn = gearAbilityWith(picks, "burn", worn);
  const burnChance =
    (burn.attr0 * (G.maps[character.map]?.burn_multiplier ?? 1)) / 100;
  // A burn only lights on a hit that leaves the mob alive
  const burnDps =
    burnChance && rawHit * MIN_DAMAGE_ROLL < hp
      ? burnProcDps(
          hit,
          projected,
          target,
          shots * land * burnChance,
          context.burnRivals,
        )
      : 0;

  return {
    shots,
    landedHits,
    dps: shots * land * (main + splashed * splash) + burnDps,
  };
}

/** Slot → damage item the mage picks last chose, luck/xp gear left out; the next pick's incumbents */
let lastMagePicks = {};

/**
 * Every owned weapon with the rest of the gear picked around it: landed hits on a mob with
 * avoidance, damage otherwise.
 * @param {Object<string, string>} fixed - slot → item kept out of the scoring
 * @returns {Object<string, string>} slot → item
 */
function pickMageGear(target, blasterAllowed, fixed) {
  const worn = getWornGearInfos();
  const clusters = new Map();
  const context = {
    mpIncome: getMpIncome(),
    energizeDelta: energizeFrequencyDelta(),
    burnRivals: burnRivalRates(target),
    skills: mageBusySkills(),
    clusterOf: (mob, radius) => {
      const key = Math.round(radius);
      if (!clusters.has(key))
        clusters.set(key, numberOfMonsterAroundTarget(mob, radius));
      return clusters.get(key);
    },
  };
  const avoids =
    (target.avoidance ?? G.monsters[target.mtype]?.avoidance ?? 0) > 0;
  const score = (projected, picks) => {
    const model = mageFightModel(projected, picks, target, worn, context);
    const value = avoids ? model.landedHits : model.dps;
    return value > 0 ? 1 / value : Infinity;
  };

  const fixedInfos = {};
  const fixedCopies = getGearCopies(getGearSlots());
  for (const [slot, name] of Object.entries(fixed))
    fixedInfos[slot] = fixedCopies[name]?.shift();

  // Worn luck/xp gear is no incumbent: it was put on for another mode
  const incumbents = {
    ...Object.fromEntries(
      getGearSlots().map((slot) => [
        slot,
        worn[slot]?.luck > 0 || worn[slot]?.xp > 0
          ? undefined
          : character.slots[slot]?.name,
      ]),
    ),
    ...lastMagePicks,
  };
  const copies = getGearCopies(["mainhand"]);
  const owned = Object.keys(copies).filter(
    (name) =>
      fitsMainhand(copies[name][0]) &&
      (blasterAllowed || !classWeaponModifier(copies[name][0]).doublehand),
  );
  context.swapPiercing = Math.max(
    0,
    ...owned
      .map((name) => copies[name][0])
      .filter((info) => !classWeaponModifier(info).doublehand)
      .map(weaponPiercing),
  );
  const cryptStaffs = owned.filter((name) => MAGE_CRYPT_STAFFS.includes(name));
  const weapons =
    character.map !== "crypt"
      ? owned
      : !target.s?.frozen && owned.includes("froststaff")
      ? ["froststaff"]
      : !blasterAllowed && cryptStaffs.length
      ? cryptStaffs
      : owned;

  const loadouts = weapons.map((name) => {
    const mainhand = copies[name][0];
    const doublehand = classWeaponModifier(mainhand).doublehand;
    const base = {
      ...fixedInfos,
      mainhand,
      ...(doublehand && { offhand: {} }),
    };
    const slots = getGearSlots(
      doublehand ? MAGE_WEAPON_SLOT : MAGE_MAINHAND_SLOT,
    ).filter((slot) => !(slot in fixed));
    const rest = pickGearByScore(
      slots,
      score,
      MAGE_GEAR_SWAP_MIN_GAIN,
      incumbents,
      base,
    );

    const picks = { ...base };
    const restCopies = getGearCopies(slots);
    for (const [slot, name] of Object.entries(rest))
      picks[slot] = restCopies[name]?.shift();
    return {
      gear: {
        ...rest,
        mainhand: name,
        ...(doublehand && { offhand: undefined }),
      },
      score: score({ ...character, ...projectStatsWith(picks) }, picks),
    };
  });
  if (!loadouts.length) return { ...lastMagePicks, ...fixed };

  loadouts.sort((lhs, rhs) => lhs.score - rhs.score);
  const incumbent = loadouts.find(
    ({ gear }) => gear.mainhand === incumbents.mainhand,
  );
  const choice =
    incumbent &&
    loadouts[0].score >= incumbent.score * (1 - MAGE_GEAR_SWAP_MIN_GAIN)
      ? incumbent
      : loadouts[0];
  lastMagePicks = { ...lastMagePicks, ...choice.gear };
  return { ...choice.gear, ...fixed };
}

let lastMageGear = { key: undefined, at: 0, gear: {} };

function calculateMageItems() {
  const currentTarget = get_target();
  const incomingMp =
    ms_to_next_skill("use_mp") < ms_to_next_skill("attack") ? 500 : 0;
  const blasterAllowed =
    currentStrategy === usePullStrategies &&
    numberOfMonsterAroundTarget(currentTarget) >=
      TARGET_TO_SWITCH_TO_BLASTER_WEAPON &&
    character.mp + incomingMp > mageMpReserve();

  const statGear = shouldWearLuckGear()
    ? pickStatGear("luck")
    : shouldWearExpGear()
    ? pickStatGear("xp")
    : {};
  delete statGear.mainhand;
  delete statGear.offhand;

  const now = Date.now();
  const key = `${currentTarget?.id}:${blasterAllowed}`;
  if (lastMageGear.key !== key || now - lastMageGear.at > MAGE_GEAR_REUSE_MS)
    lastMageGear = {
      key,
      at: now,
      gear:
        currentTarget?.type === "monster"
          ? withItemInfoMemo(() =>
              pickMageGear(currentTarget, blasterAllowed, statGear),
            )
          : { ...lastMagePicks, ...statGear },
    };

  const items = { ...lastMageGear.gear };
  return wantsMidasGear() ? { ...items, ...MIDAS_GEAR } : items;
}

function getMonstersToCBurst() {
  const partyHealer = get_entity(HEALER) ?? get_entity(RANGER);
  const partyTanker = get_entity(TANKER);

  if (!partyHealer || !partyTanker) return [];

  const healerHealPerSecond = healerHps(partyHealer);
  const MAX_SAFE_DPS = healerHealPerSecond * 0.95;
  const NEW_MOB_DMG_LIMIT = healerHealPerSecond * 0.9;

  const eligibleMobs = Object.values(parent.entities)
    .filter(
      (mob) =>
        mob.type === "monster" &&
        is_in_range(mob, "cburst") &&
        !MELEE_IGNORE_LIST.includes(mob.mtype) &&
        calculateDamage(mob, partyTanker) < MAX_MOB_DPS &&
        mob.range < character.range - 20 &&
        !WATCHOUT_ABILITIES.some((skill) =>
          Object.keys(mob.abilities ?? {}).includes(skill),
        ),
    )
    .sort((lhs, rhs) => distance(character, rhs) - distance(character, lhs));

  const selectedMobs = [];
  let currentPartyDmgRecieved = avgPartyDmgTaken(partyMems);
  const tankerMobs = listOfMonsterAttacking(partyTanker);

  for (const mob of eligibleMobs) {
    if (currentPartyDmgRecieved >= MAX_SAFE_DPS) break;

    const projectedDmg =
      currentPartyDmgRecieved -
      totalMobDps(tankerMobs, partyTanker) +
      totalMobDps([...tankerMobs, mob], partyTanker);

    if (
      is_in_range(mob, "cburst") &&
      !mob.target &&
      projectedDmg < NEW_MOB_DMG_LIMIT
    ) {
      selectedMobs.push(mob);
      tankerMobs.push(mob);
      currentPartyDmgRecieved = projectedDmg;
    }
  }

  return selectedMobs.map((mob) => [mob, 2]);
}
