// Merchant Frenzinessss!
// Get him to join in events & chickens!

// Timeout the loop if he's below this hp
const EVENT_RETREAT_HP_RATIO = 0.8;
const EVENT_RESUME_HP_RATIO = 0.95;

// Or with our priest nearby
const EVENT_COVERED_RETREAT_HP_RATIO = 0.4;
const EVENT_COVERED_RESUME_HP_RATIO = 0.6;

// Orbit radius
const EVENT_RANGE_RATE = 0.85;
const EVENT_RETREAT_RANGE_RATE = 2.5;

// Close the gap if target too far
const EVENT_APPROACH_MULTIPLIER = 1.4;

// Smartmoving to other mobs if the current one have hp higher than the lowest one
const EVENT_SWITCH_MARGIN = 0.001;

// nextDelay ticks
const EVENT_TICK = 5;
const EVENT_IDLE_TICK = 250;

// Sniping mobs
const SNIPE_MAX_PREDICTED_HP = 200;
// loot after this interval if not in a party
const LOOT_INTERVAL = 50;

var isFightingBoss = false;
// Set only when *this* loop took onDuty, so it never clears a duty it didn't acquire
var holdsEventDuty = false;
var lastLootTime = 0;
var lastPartyHealRequest = 0;

// The event this loop is currently committed to, for the switch margin above
var currentEventName = undefined;

/**
 * Polled by hitAndRun (basic_function.7.js) before it moves us. The orbit radius
 * is `character.range * rangeRate`, so kiting while the broom is still in hand
 * would have the merchant hold a melee-length orbit around a boss.
 * @returns {boolean}
 */
function shouldMerchantKite() {
  if (!isFightingBoss) return false;
  if (character.slots.mainhand?.name !== ATTACK_WEAPON) return false;

  // Whatever we're shooting is about to die anyway — orbiting it just walks us
  // out of position for the boss
  const target = get_target();
  if (target && getPredictedHp(target) < SNIPE_MAX_PREDICTED_HP) return false;

  return true;
}

/** @returns {boolean} whether someone other than us is holding the boss' aggro */
function isEventTanked(eventName) {
  const eventInfo = parent.S[eventName];
  if (!eventInfo) return false;

  const instance = get_nearest_monster({ type: eventName });
  const aggroHolder = instance?.target ?? eventInfo.target;

  return !!aggroHolder && aggroHolder !== character.name;
}

/** @returns {boolean} whether somebody other than us is holding this mob */
function isSomeoneElsesTarget(target) {
  return !!target?.target && target.target !== character.name;
}

/**
 * Generic gate every boss if they are aggroed
 */
function isSafeToHit(target) {
  if (!target || target.rip || target.dead) return false;
  // Untargeted or on us: our hit is what aggroes it, or it is already coming
  return isSomeoneElsesTarget(target);
}

/**
 * Boss table. 
 * `shouldJoin` whether to join the boss,
 * `strategy` travels and returns the entity to hit, 
 * `shouldAttack` is the per-boss safety check layered on top of `isSafeToHit`.
 * @type {Object<string, {shouldJoin: () => boolean, shouldAttack: (target?: Object) => boolean, strategy: () => Promise<Object|undefined>}>}
 */
const bossConfigs = {
  crabxx: {
    shouldJoin: () => !!parent.S.crabxx?.live,
    shouldAttack: (target) => !!target && !target["1hp"],
    strategy: async () => {
      let { crabxxInstance } = getCrabsForCrabxx();

      if (!crabxxInstance) {
        if (character.s.hopsickness) {
          await advanceSmartMove(parent.S.crabxx);
        } else {
          await join("crabxx").catch((e) => console.warn(e));
          await sleep(character.ping);
        }
        ({ crabxxInstance } = getCrabsForCrabxx());
      }

      return crabxxInstance;
    },
  },
  snowman: {
    shouldJoin: () => !!parent.S.snowman?.live,
    shouldAttack: (target) => !!target && !target.s?.fullguardx,
    strategy: async () => {
      let snowmanInstance = get_nearest_monster({ type: "snowman" });
      if (!snowmanInstance) {
        await advanceSmartMove(parent.S.snowman);
        snowmanInstance = get_nearest_monster({ type: "snowman" });
      }
      return snowmanInstance;
    },
  },
  franky: {
    shouldJoin: () => isEventTanked("franky"),
    shouldAttack: () => isEventTanked("franky"),
    strategy: async () => {
      let frankyInstance = get_nearest_monster({ type: "franky" });
      if (!frankyInstance) {
        if (!character.s.hopsickness) {
          await join("franky").catch((e) => console.warn(e));
          await sleep(character.ping);
        }
        await advanceSmartMove(parent.S.franky);
        frankyInstance = get_nearest_monster({ type: "franky" });
      }
      return frankyInstance;
    },
  },
  icegolem: {
    shouldJoin: () => isEventTanked("icegolem"),
    shouldAttack: () => isEventTanked("icegolem"),
    strategy: async () => {
      let icegolemInstance = get_nearest_monster({ type: "icegolem" });
      if (!icegolemInstance) {
        await advanceSmartMove(parent.S.icegolem);
        icegolemInstance = get_nearest_monster({ type: "icegolem" });
      }
      return icegolemInstance;
    },
  },
  dragold: {
    shouldJoin: () => isEventTanked("dragold"),
    shouldAttack: () => isEventTanked("dragold"),
    strategy: async () => {
      let dragoldInstance = get_nearest_monster({ type: "dragold" });
      if (!dragoldInstance) {
        await advanceSmartMove(parent.S.dragold);
        dragoldInstance = get_nearest_monster({ type: "dragold" });
      }
      return dragoldInstance;
    },
  },
  mrpumpkin: {
    shouldJoin: () => isEventTanked("mrpumpkin"),
    shouldAttack: () => isEventTanked("mrpumpkin"),
    strategy: async () => {
      let pumpkinInstance = get_nearest_monster({ type: "mrpumpkin" });
      if (!pumpkinInstance) {
        await advanceSmartMove(parent.S.mrpumpkin);
        pumpkinInstance = get_nearest_monster({ type: "mrpumpkin" });
      }
      return pumpkinInstance;
    },
  },
  mrgreen: {
    shouldJoin: () => isEventTanked("mrgreen"),
    shouldAttack: () => isEventTanked("mrgreen"),
    strategy: async () => {
      let greenInstance = get_nearest_monster({ type: "mrgreen" });
      if (!greenInstance) {
        await advanceSmartMove(parent.S.mrgreen);
        greenInstance = get_nearest_monster({ type: "mrgreen" });
      }
      return greenInstance;
    },
  },
  wabbit: {
    shouldJoin: () => !!parent.S.wabbit?.live && !!parent.S.wabbit?.x,
    shouldAttack: (target) => !!target,
    strategy: async () => {
      let wabbitInstance = get_nearest_monster({ type: "wabbit" });
      if (!wabbitInstance) {
        await advanceSmartMove(parent.S.wabbit);
        wabbitInstance = get_nearest_monster({ type: "wabbit" });
      }
      return wabbitInstance;
    },
  },
  pinkgoo: {
    shouldJoin: () => !!parent.S.pinkgoo?.live && !!parent.S.pinkgoo?.x,
    shouldAttack: (target) => !!target,
    strategy: async () => {
      let pinkgooInstance = get_nearest_monster({ type: "pinkgoo" });
      if (!pinkgooInstance) {
        await advanceSmartMove(parent.S.pinkgoo);
        pinkgooInstance = get_nearest_monster({ type: "pinkgoo" });
      }
      return pinkgooInstance;
    },
  },
};

// Bosses whose doesn't demand a tank (harmless ones) still go
const UNTANKED_OK = ["snowman", "wabbit", "pinkgoo"];

/**
 * Remaining hp share of a live event boss
 * @returns {number} 0..1, defaulting to 1 (full) when the event reports no hp
 */
function getEventHpRatio(eventName) {
  const eventInfo = parent.S[eventName];
  const instance = get_nearest_monster({ type: eventName });
  const source = instance ?? eventInfo;

  if (!source?.hp) return 1;

  const maxHp = source.max_hp ?? G.monsters[eventName]?.hp;
  if (!maxHp) return 1;

  return source.hp / maxHp;
}

/**
 * Which live event to go to.Lowest %HP one if concurrently occurs
 * @returns {string|undefined}
 */
function getEventToJoin() {
  const joinable = Object.keys(bossConfigs).filter((eventName) => {
    try {
      return bossConfigs[eventName].shouldJoin();
    } catch (e) {
      console.warn(`shouldJoin(${eventName}) failed:`, e);
      return false;
    }
  });

  const best = joinable
    .sort((lhs, rhs) => getEventHpRatio(lhs) - getEventHpRatio(rhs))
    .shift();

  if (!best || !joinable.includes(currentEventName)) return best;

  const isWorthSwitching =
    getEventHpRatio(best) <
    getEventHpRatio(currentEventName) - EVENT_SWITCH_MARGIN;

  return isWorthSwitching ? best : currentEventName;
}

/**
 * Blockers that stop us *starting* a fight.
 * @returns {boolean}
 */
function isMerchantBusy() {
  return (
    // The startup bank trip comes first — everything downstream reads its cache
    !hasVisitedBank ||
    (onDuty && !holdsEventDuty) ||
    isLuringMobs ||
    isDraggingMobs ||
    mustAbandonFight()
  );
}

/**
 * Dont fight while urgent task
 * @returns {boolean}
 */
function mustAbandonFight() {
  return character.rip || isInvFull(3) || invJammed;
}

function acquireEventDuty() {
  if (holdsEventDuty) return true;
  if (onDuty || isLuringMobs || isDraggingMobs) return false;

  onDuty = true;
  isFightingBoss = true;
  holdsEventDuty = true;
  return true;
}

function releaseEventDuty() {
  currentEventName = undefined;
  // hitAndRun reads this global; hand it back so nothing inherits our orbit
  rangeRate = basicRangeRate;

  if (!holdsEventDuty) return;

  onDuty = false;
  isFightingBoss = false;
  holdsEventDuty = false;
}

/**
 * hp minus everything already in the air, same measure getCrabsForCrabxx uses.
 * @returns {number}
 */
function getPredictedHp(entity) {
  const incoming = PROJECTILE_MANAGER?.getIncomingNumber(entity.id) ?? 0;
  return (entity.hp ?? 0) + incoming;
}

/**
 * Anything nearly dead that is already inside dartgun range
 *  so it costs the merchant nothing but the shot.
 * @returns {Object|undefined}
 */
function getSnipeTarget() {
  // Max range or base range if equipped
  const snipeRange = getAttackWeaponReach();
  if (!snipeRange) return undefined;

  let bestTarget;
  let bestHp = SNIPE_MAX_PREDICTED_HP;

  for (const id in parent.entities) {
    const entity = parent.entities[id];

    if (!entity || entity.type !== "monster" || entity.rip || entity.dead)
      continue;
    if (distance(character, entity) > snipeRange) continue;

    const predictedHp = getPredictedHp(entity);
    if (predictedHp <= 0 || predictedHp >= bestHp) continue;

    bestTarget = entity;
    bestHp = predictedHp;
  }

  return bestTarget;
}

/** @returns {boolean} whether a snipe may take over our position and gear */
function canSnipe() {
  return !(
    isLuringMobs ||
    isDraggingMobs ||
    character.c.mining ||
    character.c.fishing
  );
}

/**
 * What calculateMerchantEquipment should be returning
 * @returns {boolean}
 */
function shouldHoldAttackWeapon() {
  if (isDraggingMobs || isFightingBoss) return true;

  return canSnipe() && !!getSnipeTarget();
}

/**
 * Takes the free kill if there is one. Skips anything that owns our position
 * (a lure/drag, a channelled gather).
 * @returns {Promise<Object|undefined>} the candidate seen, shot or not — the
 * caller ticks faster while one is around
 */
async function snipeNearbyWeakMob() {
  if (!canSnipe()) return undefined;

  const target = getSnipeTarget();
  if (!target) return undefined;

  if (character.s.penalty_cd || ms_to_next_skill("attack") > 0) return target;

  // The broom can't reach it — and the gear calc already agrees, since it
  // branches on the same target being there
  if (character.slots.mainhand?.name !== ATTACK_WEAPON) {
    await equipBatch(calculateMerchantEquipments());
    if (character.slots.mainhand?.name !== ATTACK_WEAPON) return target;
  }

  if (!is_in_range(target, "attack")) return target;

  change_target(target);
  await attack(target)
    .then(() => reduce_cooldown("attack", character.ping * 0.95))
    .catch((e) => console.warn(e));

  return target;
}

/**
 * Solo, there is no midas looter in the party to defer to
 */
function lootIfSolo() {
  if (parent.party_list?.length) return;
  if (Date.now() - lastLootTime < LOOT_INTERVAL) return;
  if (!Object.keys(parent.chests).length) return;

  lastLootTime = Date.now();
  return loot();
}

/**
 * Our priest nearby?
 * @returns {Object|undefined}
 */
function getCoveringHealer() {
  const healer = get_entity(HEALER) ?? get_entity(PRIEST) ?? get_entity(RANGER);
  if (!healer || healer.rip || healer.hp <= 0) return undefined;

  const healRange = (healer.range ?? G.skills.heal?.range ?? 175) * 0.9;
  return distance(character, healer) <= healRange ? healer : undefined;
}

/**
 * Opens the stand while there is nothing worth shooting.
 */
function idleAtEvent() {
  if (character.stand || smart.moving || isAdvanceSmartMoving) return;

  open_stand();
}

/**
 * Asks the priest for a partyheal
 */
function requestPartyHeal() {
  const partyHealInfo = G.skills["partyheal"];
  if (Date.now() - lastPartyHealRequest < partyHealInfo.cooldown) return;

  // mp only reads on a priest we can see; a far one gets the benefit of doubt
  const priest = get_entity(PRIEST);
  if (priest && priest.mp < partyHealInfo.mp) return;

  lastPartyHealRequest = Date.now();
  send_cm(PRIEST, "party_heal");
}

/** @returns {Object[]} monsters currently aggroed on the merchant */
function monstersOnMe() {
  return Object.values(parent.entities).filter(
    (entity) => entity?.type === "monster" && entity.target === character.name,
  );
}

/**
 * The merchant half of the fighters' shouldAttack
 * @returns {Promise<boolean>} whether it is safe to keep fighting this tick
 */
async function keepMerchantSafe(target) {
  if (character.rip) return false;

  const healer = getCoveringHealer();
  const retreatRatio = healer
    ? EVENT_COVERED_RETREAT_HP_RATIO
    : EVENT_RETREAT_HP_RATIO;
  const resumeRatio = healer
    ? EVENT_COVERED_RESUME_HP_RATIO
    : EVENT_RESUME_HP_RATIO;

  const threats = monstersOnMe();
  const isHurt = character.hp < character.max_hp * retreatRatio;

  if (!threats.length && !isHurt) return true;

  // Shed what we can, but scare is on a long cooldown next to this loop's tick
  if (threats.length) await scareAwayMobs();

  if (isHurt) {
    if (!healer) requestPartyHeal();
    return character.hp >= character.max_hp * resumeRatio;
  }

  return true;
}

/**
 * The event half of a tick: joins, travels, gears up and shoots the boss.
 * @returns {Promise<{delay: number, attacked?: boolean}>} the tick delay, and
 * whether the shot was spent — an unspent one is the snipe's to take
 */
async function fightCurrentEvent() {
  const eventName = getEventToJoin();
  // Once committed, only a hard blocker unseats us — see mustAbandonFight
  const isBlocked = holdsEventDuty ? mustAbandonFight() : isMerchantBusy();

  if (!eventName || isBlocked) {
    releaseEventDuty();
    return { delay: EVENT_IDLE_TICK };
  }

  if (!acquireEventDuty()) return { delay: EVENT_IDLE_TICK };

  currentEventName = eventName;
  const config = bossConfigs[eventName];
  const target = await config.strategy();

  if (!target) return { delay: EVENT_IDLE_TICK };

  await equipBatch(calculateMerchantEquipments());

  if (character.slots.mainhand?.name !== ATTACK_WEAPON) {
    return { delay: EVENT_IDLE_TICK };
  }

  // hitAndRun kites off get_target(), so hand it the boss before anything else
  change_target(target);

  const isSafeToFight = await keepMerchantSafe(target);
  rangeRate = isSafeToFight ? EVENT_RANGE_RATE : EVENT_RETREAT_RANGE_RATE;

  if (!isSafeToFight) return { delay: EVENT_TICK };

  const requiresTank = !UNTANKED_OK.includes(eventName);
  if (!config.shouldAttack(target) || (requiresTank && !isSafeToHit(target))) {
    // Nothing to shoot (a guarded snowman, an untanked boss)
    idleAtEvent();
    return { delay: EVENT_TICK };
  }

  if (!is_in_range(target, "attack")) {
    // hitAndRun walks us into orbit; only a real gap needs the pathfinder
    const reach = character.range + character.xrange;
    if (distance(character, target) > reach * EVENT_APPROACH_MULTIPLIER) {
      await advanceSmartMove(target, { useScare: false });
    }
    return { delay: EVENT_TICK };
  }

  if (ms_to_next_skill("attack") > 0 || character.s.penalty_cd) {
    return { delay: EVENT_TICK };
  }

  await attack(target)
    .then(() => reduce_cooldown("attack", character.ping * 0.95))
    .catch((e) => console.warn(e));

  return {
    delay: Math.max(ms_to_next_skill("attack"), EVENT_TICK),
    attacked: true,
  };
}

// Merchant main attack loop
async function merchantAttackLoop() {
  let nextDelay = EVENT_IDLE_TICK;

  try {
    // Respawn is handled by merchant main loop already
    // he may be using an elixir later, but not found any suitable yet :)
    if (character.rip) {
      releaseEventDuty();
      return;
    }

    lootIfSolo();

    const { delay, attacked } = await fightCurrentEvent();
    nextDelay = delay;

    // A free kill in range costs nothing, event or not — it only ever spends a
    // shot the boss didn't take, and is worth ticking at attack speed for
    if (attacked) return;

    const snipeTarget = await snipeNearbyWeakMob();
    if (snipeTarget) {
      nextDelay = Math.max(ms_to_next_skill("attack"), EVENT_TICK);
    }
  } catch (e) {
    console.warn(e);
  } finally {
    setTimeout(merchantAttackLoop, nextDelay);
  }
}
