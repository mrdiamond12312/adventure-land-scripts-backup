// Priest: heal-window, luck and xp rules over the heal and tank picks

/** Below this hp share the priest skips luck gear */
const PRIEST_LUCK_MIN_HP_RATIO = 0.5;
/** Party volleys that count as a quick kill */
const PRIEST_EXP_KILL_VOLLEYS = 2;
const PRIEST_DEFAULT_GEAR = {
  gloves: "supermittens",
  belt: "intbelt",
  ring1: "zapper",
  ring2: "zapper",
  cape: "angelwings",
  earring1: "cearring",
  earring2: "cearring",
};

let priestLastHealGearAt = 0;

function isPriestInHealGraceWindow(target) {
  if (target && target.type !== "monster") {
    priestLastHealGearAt = Date.now();
    return true;
  }

  const graceMs = 1000 / character.frequency;
  return Date.now() - priestLastHealGearAt < graceMs;
}

function isPriestInDanger() {
  return (
    !!character.s.burned ||
    character.hp < character.max_hp * PRIEST_LUCK_MIN_HP_RATIO
  );
}

function isPartyQuickKilling(mob) {
  if (!mob) return false;

  const volley = partyMems
    .map((name) => get_player(name))
    .filter(Boolean)
    .reduce((sum, member) => sum + member.attack * mitigation(member, mob), 0);
  return mob.max_hp <= volley * PRIEST_EXP_KILL_VOLLEYS;
}

function getPriestMainhand(target, currentTarget, statGear) {
  if (isUnhealedGhost(target)) return "pinkie";
  if (isPriestInHealGraceWindow(target)) return "lmace";

  if (character.map === "crypt") {
    return currentTarget?.s?.frozen ? "lmace" : "froststaff";
  }

  return statGear.mainhand ?? "firestaff";
}

function getPriestOffhand(mainhand, tankGear, statGear, healGear) {
  const wtype = G.items[mainhand]?.wtype;
  if (G.classes[character.ctype].doublehand?.[wtype]) return undefined;
  if (statGear.offhand) return statGear.offhand;
  return tankGear.offhand ?? healGear.offhand ?? "exoarm";
}

function getPriestOrb(target, tankGear, statGear, healGear) {
  if (statGear.orb) return statGear.orb;
  if (isPriestInHealGraceWindow(target)) return healGear.orb ?? "jacko";
  return tankGear.orb ?? "test_orb";
}

function getPriestAmulet(tankGear, statGear, healGear) {
  if (statGear.amulet) return statGear.amulet;

  // Re-equip sanguine to (re)apply its aura
  const haveSanguine =
    locate_item("sanguine") !== -1 ||
    character.slots.amulet?.name === "sanguine";
  if (
    haveSanguine &&
    (!character.s.sanguine || character.s.sanguine.ms < 10000)
  ) {
    return "sanguine";
  }

  return tankGear.amulet ?? healGear.amulet ?? "intamulet";
}

const PRIEST_GEAR_REUSE_MS = 500;
let lastPriestPicks = { key: undefined, at: 0, picks: undefined };

/** The tank, stat and heal picks, reused briefly while the fireball and modes hold */
function getPriestGearPicks(fireball, isTanking, feelingLucky, feelingWise) {
  const now = Date.now();
  const key = `${fireball?.id}:${isTanking}:${feelingLucky}:${feelingWise}`;
  if (
    lastPriestPicks.key === key &&
    now - lastPriestPicks.at <= PRIEST_GEAR_REUSE_MS
  )
    return lastPriestPicks.picks;

  const picks = withItemInfoMemo(() => ({
    tankGear: fireball
      ? pickFireballGear(fireball)
      : isTanking
      ? pickTankGear()
      : {},
    statGear: feelingLucky
      ? pickStatGear("luck")
      : feelingWise
      ? pickStatGear("xp")
      : {},
    healGear: fireball ? {} : pickHealGear(PRIEST_DEFAULT_GEAR),
  }));
  lastPriestPicks = { key, at: now, picks };
  return picks;
}

function calculatePriestItems(target) {
  const currentTarget = get_targeted_monster();
  const isTanking = isAssignedAsTanker();
  const fireball = getImminentFireball();
  const feelingLucky = !fireball && shouldWearLuckGear() && !isPriestInDanger();
  const feelingWise =
    !fireball &&
    !isTanking &&
    (shouldWearExpGear() || isPartyQuickKilling(currentTarget));
  const { tankGear, statGear, healGear } = getPriestGearPicks(
    fireball,
    isTanking,
    feelingLucky,
    feelingWise,
  );

  const mainhand = getPriestMainhand(target, currentTarget, statGear);
  return {
    ...PRIEST_DEFAULT_GEAR,
    ...healGear,
    ...tankGear,
    ...statGear,
    mainhand,
    offhand: getPriestOffhand(mainhand, tankGear, statGear, healGear),
    orb: getPriestOrb(target, tankGear, statGear, healGear),
    amulet: getPriestAmulet(tankGear, statGear, healGear),
  };
}
