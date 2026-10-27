// Rogue: the fight model and the damage and boss-burn gear picks

/** @returns {boolean} whether the stats meet the skill's requirements */
function meetsRequirements(skill, stats = character) {
  return Object.entries(G.skills[skill]?.requirements ?? {}).every(
    ([stat, min]) => (stats[stat] ?? 0) >= min,
  );
}

/** @returns {number} one rogue hit: (attack × crit + stack) × defense */
function rogueHitDamage(
  skill,
  stats,
  target,
  {
    crit,
    roll = 1,
    stack = Math.min((target.s?.stack?.s ?? 0) + 1, G.skills.stack.max),
  } = {},
) {
  const info = G.skills[skill];
  const critScale = info.procs ? crit ?? averageCritFactor(stats) : 1;
  return (
    (stats.attack * (info.damage_multiplier ?? 1) * critScale * roll + stack) *
    mitigation(stats, target, { damageType: info.damage_type })
  );
}

/** @returns {number} chance a hit lands: our miss, the target's avoidance, and its evasion on physical hits */
function rogueLandChance(skill, stats, target) {
  const def = G.monsters[target.mtype] ?? {};
  const isPhysical =
    (G.skills[skill].damage_type ?? damageTypeOf(stats)) === "physical";
  return (
    (1 - Math.max(0, stats.miss ?? 0) / 100) *
    (1 - (target.avoidance ?? def.avoidance ?? 0) / 100) *
    (isPhysical ? 1 - (target.evasion ?? def.evasion ?? 0) / 100 : 1)
  );
}

const ROGUE_GEAR_SWAP_MIN_GAIN = 0.01;
const BURN_FUEL_HORIZON_S = 30;
const BURN_REFUEL_SHARE = 0.9;
const STACK_HORIZON_S = 30;
const ROGUE_SKIPPED_WEAPONS = ["candycanesword"];
const ROGUE_WEAPON_SLOTS = ["mainhand", "offhand"];
const ROGUE_WEAPON_SLOT = /^(mainhand|offhand)$/;

function fitsRogueHand(info, slot) {
  if (info.type !== "weapon") return false;
  if (info.class && !info.class.includes(character.ctype)) return false;
  return info.wtype in (G.classes[character.ctype][slot] ?? {});
}

const followUpFor = (mainhand) =>
  ["quickstab", "quickpunch"].find(
    (skill) => G.skills[skill].wtype === mainhand?.wtype,
  );

/** Cast rates under the mp income, hits on the stack built over the horizon, and the burn */
function rogueFightModel(projected, picks, target, worn) {
  const mainhand = handWith(picks, worn, "mainhand");
  const wornModifier = classWeaponModifier(worn.mainhand).modifier;
  const modifier = classWeaponModifier(mainhand).modifier;
  const frequency =
    projected.frequency +
    (((modifier.frequency ?? 0) - (wornModifier.frequency ?? 0)) / 100) *
      conditionFrequencyScale(character);
  const restore = gearAbilityWith(picks, "restore_mp", worn);

  const attackHit = rogueHitDamage("attack", projected, target);
  const targetMp = target.mp ?? 0;
  const income =
    getMpIncome() +
    Math.min(
      (frequency * attackHit * (projected.manasteal ?? 0)) / 100,
      targetMp / MANASTEAL_HORIZON_S,
    );

  const attackCost = castMpCost(projected.mp_cost, projected, restore);
  const rates = {
    attack: attackCost > 0 ? Math.min(frequency, income / attackCost) : frequency,
  };
  let budget = income - rates.attack * attackCost;

  const skills = [followUpFor(mainhand), "mentalburst"]
    .filter((skill) => skill && meetsRequirements(skill, projected))
    .map((skill) => ({
      skill,
      hit: rogueHitDamage(skill, projected, target),
      landed:
        rogueHitDamage(skill, projected, target) *
        rogueLandChance(skill, projected, target),
      cost: castMpCost(G.skills[skill].mp, projected, restore, target),
    }))
    .sort((lhs, rhs) => rhs.landed / rhs.cost - lhs.landed / lhs.cost);
  for (const { skill, cost } of skills) {
    const maxRate = 1000 / G.skills[skill].cooldown;
    rates[skill] =
      cost > 0 ? Math.min(maxRate, Math.max(0, budget) / cost) : maxRate;
    budget -= rates[skill] * cost;
  }

  // A dodge adds no stack and lights no burn
  const landed = Object.fromEntries(
    Object.keys(rates).map((skill) => [
      skill,
      rates[skill] * rogueLandChance(skill, projected, target),
    ]),
  );

  const hitsNow = { attack: attackHit };
  for (const { skill, hit } of skills) hitsNow[skill] = hit;
  const hitRate = Object.values(landed).reduce((sum, rate) => sum + rate, 0);
  const dpsNow = Object.keys(landed).reduce(
    (sum, skill) => sum + landed[skill] * hitsNow[skill],
    0,
  );
  const fightS = Math.min(
    STACK_HORIZON_S,
    dpsNow > 0 ? (target.hp ?? 0) / dpsNow : 0,
  );
  const stack = Math.min(
    G.skills.stack.max,
    (target.s?.stack?.s ?? 0) + 1 + (hitRate * fightS) / 2,
  );
  const hits = Object.fromEntries(
    Object.keys(rates).map((skill) => [
      skill,
      rogueHitDamage(skill, projected, target, { stack }),
    ]),
  );

  const burn = gearAbilityWith(picks, "burn", worn);
  const burnChance =
    (burn.attr0 * (G.maps[character.map]?.burn_multiplier ?? 1)) / 100;
  const procRate = Object.keys(landed)
    .filter((skill) => G.skills[skill].procs)
    .reduce((sum, skill) => sum + landed[skill], 0);
  const burnCap = burnChance
    ? burnIntensityCap(
        rogueHitDamage("attack", projected, target, {
          crit: projected.crit > 0 ? critMultiplier(projected) : 1,
          roll: MIN_DAMAGE_ROLL,
          stack,
        }),
        target.firesistance,
      )
    : 0;

  return {
    rates,
    landed,
    hits,
    stack,
    burnCap,
    burnProcRate: procRate * burnChance,
    critProcRate: procRate * burnChance * (Math.min(projected.crit, 100) / 100),
  };
}

function rogueDamagePerSecond(model) {
  const hits = Object.keys(model.landed).reduce(
    (sum, skill) => sum + model.landed[skill] * model.hits[skill],
    0,
  );
  const burnUptime = 1 - Math.exp(-BURN_SECONDS * model.burnProcRate);
  return hits + model.burnCap * BURN_DPS_PER_INTENSITY * burnUptime;
}

function rogueFuelScore(model) {
  return (
    model.burnCap * (1 - Math.exp(-BURN_FUEL_HORIZON_S * model.critProcRate))
  );
}

const lastRoguePicks = { damage: {}, fuel: {} };

/** Best weapon pair; a stars mainhand pairs only with stars (server cuts item attack to a third) */
function pickRogueWeapons(score, needsBurn, incumbents) {
  const copies = getGearCopies(ROGUE_WEAPON_SLOTS);
  const names = Object.keys(copies).filter(
    (name) => !ROGUE_SKIPPED_WEAPONS.includes(name),
  );
  const pairs = [];
  for (const mainName of names) {
    const mainhand = copies[mainName][0];
    if (!fitsRogueHand(mainhand, "mainhand")) continue;
    for (const offName of names) {
      const offhand = copies[offName][offName === mainName ? 1 : 0];
      if (!offhand || !fitsRogueHand(offhand, "offhand")) continue;
      if (mainhand.wtype === "stars" && offhand.wtype !== "stars") continue;
      if (needsBurn && mainhand.ability !== "burn" && offhand.ability !== "burn")
        continue;
      const picks = { mainhand, offhand };
      pairs.push({
        gear: { mainhand: mainName, offhand: offName },
        picks,
        score: score({ ...character, ...projectStatsWith(picks) }, picks),
      });
    }
  }
  if (!pairs.length) return undefined;

  pairs.sort((lhs, rhs) => lhs.score - rhs.score);
  const incumbent = pairs.find(
    ({ gear }) =>
      gear.mainhand === incumbents.mainhand &&
      gear.offhand === incumbents.offhand,
  );
  return incumbent &&
    pairs[0].score >= incumbent.score * (1 - ROGUE_GEAR_SWAP_MIN_GAIN)
    ? incumbent
    : pairs[0];
}

/** @returns {{gear: Object<string, string>, model: Object}} the weapon pair, then the rest */
function pickRogueGear(target, kind, needsBurn) {
  const worn = getWornGearInfos();
  const value = kind === "fuel" ? rogueFuelScore : rogueDamagePerSecond;
  const score = (projected, picks) => {
    const result = value(rogueFightModel(projected, picks, target, worn));
    return result > 0 ? 1 / result : Infinity;
  };

  const incumbents = {
    ...Object.fromEntries(
      getGearSlots().map((slot) => [slot, character.slots[slot]?.name]),
    ),
    ...lastRoguePicks[kind],
  };
  const weapons = pickRogueWeapons(score, needsBurn, incumbents);
  const rest = pickGearByScore(
    getGearSlots(ROGUE_WEAPON_SLOT),
    score,
    ROGUE_GEAR_SWAP_MIN_GAIN,
    incumbents,
    weapons?.picks,
  );

  const gear = { ...rest, ...weapons?.gear };
  lastRoguePicks[kind] = gear;

  const picks = { ...weapons?.picks };
  const copies = getGearCopies(getGearSlots(ROGUE_WEAPON_SLOT));
  for (const [slot, name] of Object.entries(rest))
    picks[slot] = copies[name]?.shift();
  const projected = { ...character, ...projectStatsWith(picks) };
  return { gear, model: rogueFightModel(projected, picks, target, worn) };
}

const isRogueBurnTarget = (target) =>
  !!target &&
  (!!target.cooperative || PRIORITY_MOB_IDS.includes(target.mtype));

const ROGUE_GEAR_REUSE_MS = 500;
let lastRogueGear = { id: undefined, at: 0, gear: {} };

/** calculateRogueItems, reused briefly on the same target */
function calculateRogueItemsCached(target) {
  const now = Date.now();
  if (
    lastRogueGear.id !== target?.id ||
    now - lastRogueGear.at > ROGUE_GEAR_REUSE_MS
  )
    lastRogueGear = {
      id: target?.id,
      at: now,
      gear: withItemInfoMemo(() => calculateRogueItems(target)),
    };
  return { ...lastRogueGear.gear };
}

/** Damage gear, fuel gear on a boss under our burn, luck/xp gear on top but the weapons */
function calculateRogueItems(target) {
  const statGear = shouldWearLuckGear()
    ? pickStatGear("luck")
    : shouldWearExpGear()
    ? pickStatGear("xp")
    : {};
  for (const slot of ROGUE_WEAPON_SLOTS) delete statGear[slot];

  if (!target || target.type !== "monster")
    return { ...lastRoguePicks.damage, ...statGear };

  const needsBurn = isRogueBurnTarget(target);
  let { gear } = pickRogueGear(target, "damage", needsBurn);
  if (needsBurn) {
    const fuel = pickRogueGear(target, "fuel", true);
    if (
      (target.s?.burned?.intensity ?? 0) <
      BURN_REFUEL_SHARE * fuel.model.burnCap
    )
      gear = fuel.gear;
  }
  return { ...gear, ...statGear };
}
