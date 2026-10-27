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

/** @returns {[string, number][]} skill → cooldown padding, for the skills drawing on the attack mp */
function mageBusySkills() {
  const known = (skill) => character.level >= (G.skills[skill].level ?? 0);
  return [
    currentStrategy === usePullStrategies &&
      known("cburst") && ["cburst", CBURST_COOLDOWN_PAD_MS],
    avgPartyDmgTaken(partyMems, "magical") > 0 &&
      known("reflection") && ["reflection", 0],
  ].filter(Boolean);
}

/** @returns {number} frequency points self-energize adds on average, less the burst already in ours */
function energizeFrequencyDelta() {
  const { frequency, duration } = G.conditions.energized;
  const average =
    character.level >= G.skills.energize.level
      ? (frequency * duration) / G.skills.energize.cooldown
      : 0;
  return average - (character.s.energized ? frequency : 0);
}

/** @returns {boolean} whether the mage can hold `info` in his mainhand */
function fitsMageHand(info) {
  if (info?.type !== "weapon") return false;
  if (info.class && !info.class.includes(character.ctype)) return false;
  const classData = G.classes[character.ctype];
  return info.wtype in classData.mainhand || info.wtype in classData.doublehand;
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
  const rawHit = projected.attack * mitigation(projected, target);

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
      ? burnIntensityCap(rawHit * MIN_DAMAGE_ROLL, target.firesistance) *
        BURN_DPS_PER_INTENSITY *
        (1 - Math.exp(-BURN_SECONDS * shots * land * burnChance))
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
      fitsMageHand(copies[name][0]) &&
      (blasterAllowed || !classWeaponModifier(copies[name][0]).doublehand),
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
