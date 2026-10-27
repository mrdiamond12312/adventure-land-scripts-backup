// Ranger: cupid, bow choice for splashing, splash safety, and gear

const RANGER_INV_ITEMS = {
  poucher: "pouchbow",
  fireBow: "firebow",
  crossBow: "crossbow",
  cupid: "cupid",
};

/**
 * Party members in cupid range that want a heal (empty while feared).
 * @param {Object[]} [playersToHeal] - candidates, defaults to getPlayersToHeal()
 * @returns {Object[]} the healees
 */
function getCupidHealees(playersToHeal = getPlayersToHeal()) {
  if (character.fear) return [];

  const characterRange = character.range + character.xrange;
  return playersToHeal.filter(
    (player) =>
      player.name !== character.name &&
      distance(player, character) < characterRange,
  );
}

/**
 * Best-scoring bow to splash with, over every bow carried plus the one in hand.
 * @param {Object[]} targets - the mobs about to be shot
 * @returns {string} the bow's name
 */
function chooseBowForSplashing(targets) {
  const currentBow = character.slots.mainhand;
  const currentInfo = currentBow ? item_info(currentBow) : undefined;
  const currentExplosion = splashOf(currentInfo);
  const currentCrit = currentInfo?.crit ?? 0;

  // Bows sharing a radius share their cluster counts, for this call only
  const clusters = new Map();
  const clusterOf = (mob, radius) => {
    const key = `${mob.id}:${Math.round(radius)}`;
    if (!clusters.has(key))
      clusters.set(key, numberOfMonsterAroundTarget(mob, radius));
    return clusters.get(key);
  };

  const best = findOwnedItems(
    (entry) =>
      ["bow", "crossbow"].includes(entry.info?.wtype) &&
      entry.name !== RANGER_INV_ITEMS.cupid,
    (entry) =>
      explosionScore(
        {
          ...entry.info,
          explosion_delta: splashOf(entry.info) - currentExplosion,
          crit_delta: (entry.info.crit ?? 0) - currentCrit,
        },
        targets,
        clusterOf,
      ),
  )[0];

  return best?.name ?? RANGER_INV_ITEMS.fireBow;
}

/**
 * Whether waking `mob` with a splash is acceptable: it barely scratches us, or
 * the same splash kills it outright.
 * @param {Object} mob - the unaggroed bystander in the blast
 * @returns {boolean}
 */
function isNegligibleMob(mob) {
  return (
    isHarmlessMob(mob) ||
    isDyingToOurShot(mob, (character.explosion ?? 0) / 100)
  );
}

/**
 * Whether firing at `mob` is safe once splash is accounted for.
 * @param {Object} mob - the intended target
 * @param {number} [splashRadius] - blast radius to test; 0 means no splash
 * @returns {boolean}
 */
function isSafeToShoot(mob, splashRadius = getSplashRadius(0)) {
  if (!shouldAttack(mob)) return false;
  // A watchout mob nobody holds yet is ours the moment we touch it
  if (!mob?.target && hasWatchoutAbility(mob)) return false;
  if (!splashRadius) return true;

  return !hasUntargetedMonsterAround(
    mob,
    splashRadius,
    (bystander) => hasWatchoutAbility(bystander) || !isNegligibleMob(bystander),
  );
}

/**
 * @param {Object|Object[]} [target] - forwarded to calculateRangerItems
 * @returns {Promise} the gear swap, forced while holding cupid
 */
function equipRangerItems(target) {
  const isHoldingCupid =
    character.slots.mainhand?.name === RANGER_INV_ITEMS.cupid;
  return equipBatch(calculateRangerItems(target), {
    preventPenaltizeNextAttack: !isHoldingCupid,
    preventKeySnatch: !isHoldingCupid,
  });
}

function calculateRangerItems(target) {
  const targets = !target ? [] : Array.isArray(target) ? target : [target];
  const feelingLucky = shouldWearLuckGear();
  const feelingWise = shouldWearExpGear();
  const someTargetCooperative = targets.some((mob) => mob.cooperative);

  // Judge splash safety against the radius we *would* have, not the one we have
  // now, or picking up the poucher would immediately make itself unsafe.
  const prospectiveSplashRadius = getSplashRadius();
  const targetsAreSafeToSplash = targets
    .filter((entity) => entity.type === "monster")
    .every((mob) => isSafeToShoot(mob, prospectiveSplashRadius));

  let mainhand = getServerSlot("mainhand")?.name;

  // Cupid outranks every bow: the strategy hands it over whenever someone wants
  // a heal, and the ranger keeps shooting mobs until it is actually in hand.
  const cupidAvailable =
    findMaxLevelItem(RANGER_INV_ITEMS.cupid) !== -1 ||
    mainhand === RANGER_INV_ITEMS.cupid;

  if (!mainhand) mainhand = RANGER_INV_ITEMS.fireBow;

  if (cupidAvailable && getCupidHealees().length) {
    mainhand = RANGER_INV_ITEMS.cupid;
  } else if (targets.length) {
    const canSplash =
      currentStrategy === usePullStrategies &&
      targets.some(
        (mob) =>
          (mob.cluster_count ??
            numberOfMonsterAroundTarget(mob, getSplashRadius())) >=
          TARGET_TO_SWITCH_TO_BLASTER_WEAPON,
      );

    if (canSplash) {
      mainhand = chooseBowForSplashing(targets);
    } else if (someTargetCooperative) {
      mainhand = RANGER_INV_ITEMS.fireBow;
    } else {
      const current = character.slots.mainhand;
      const currentInfo = current ? item_info(current) : { attack: 0 };

      const rangedWeapons = character.items
        .map((item, slot) => {
          if (!item) return null;

          const info = item_info(item);
          if (
            !["bow", "crossbow"].includes(info.wtype) ||
            item.name === "cupid" ||
            // Keep hands off the poucher when the blast would wake a fresh mob
            (!targetsAreSafeToSplash && item.name === RANGER_INV_ITEMS.poucher)
          )
            return null;

          return {
            slot,
            name: item.name,
            info,
            attackDelta: info.attack - currentInfo.attack,
            rangeDelta: info.range - (currentInfo.range || 0),
          };
        })
        .filter(Boolean);

      if (current) {
        const info = item_info(current);
        if (
          ["bow", "crossbow"].includes(info.wtype) &&
          current.name !== "cupid"
        ) {
          rangedWeapons.push({
            slot: "mainhand",
            name: current.name,
            info,
            attackDelta: 0,
            rangeDelta: 0,
          });
        }
      }

      rangedWeapons.sort((lhs, rhs) => {
        if (lhs.info.wtype !== rhs.info.wtype) {
          return lhs.info.wtype === "crossbow" ? 1 : -1;
        }
        return (
          rhs.rangeDelta - lhs.rangeDelta || lhs.attackDelta - rhs.attackDelta
        );
      });

      const oneShotWeapon = rangedWeapons.find((weapon) =>
        canOneShotWithWeapon(weapon.info, targets),
      );
      mainhand = oneShotWeapon ? oneShotWeapon.name : RANGER_INV_ITEMS.fireBow;
    }
  }

  return {
    helmet: feelingLucky ? "wcap" : "fury",
    mainhand,
    offhand:
      !targetsAreSafeToSplash ||
      targets.some((entity) => haveFormidableMonsterAroundTarget(entity))
        ? "t2quiver"
        : "alloyquiver",
    orb: feelingLucky
      ? "rabbitsfoot"
      : feelingWise
      ? "talkingskull"
      : getOwnedItemInfo("cave_loaded_die")
      ? "cave_loaded_die"
      : "orbofdex",
    amulet: feelingWise ? "spookyamulet" : "dexamulet",
    shoes: feelingLucky ? "wshoes" : "wingedboots",
    gloves: feelingLucky ? "wgloves" : "supermittens",
    belt: "dexbelt",
    earring1: feelingLucky ? "cloverstud" : "dexearring",
    earring2: feelingLucky
      ? "cloverstud"
      : character.name === RANGER2
      ? "molesteeth"
      : "dexearring",
  };
}
