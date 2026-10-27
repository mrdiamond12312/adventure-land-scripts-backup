// basic_function part: promise helpers, cooldowns, the skill and potion loops, cosmetic skills

async function withTimeout(
  promise,
  timeoutInterval = Math.max(...parent.pings),
) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(resolve, timeoutInterval)),
  ]);
}

/**
 * Leads every server-sent skill cooldown by the fastest ping
 * @param {{name: string, ms: number}} data
 */
function leadSkillTimeout(data) {
  if (data?.name) reduce_cooldown(data.name, Math.min(...parent.pings));
}

async function waitUntil(fn, timeout = 10_000, interval = 100) {
  const start = Date.now();

  while (true) {
    try {
      if (fn()) return true;
    } catch (e) {
      console.warn("waitUntil fn error:", e);
      return false;
    }

    if (Date.now() - start > timeout) return false;

    await sleep(interval || 100);
  }
}

function pickRestoreSkill() {
  const isChanneling =
    character.c.town || character.c.fishing || character.c.mining;

  const isSavingForSurge =
    character.mp < surgeMpReserve() && character.hp > character.max_hp * 0.6;

  const shouldRestoreHp =
    !isSavingForSurge &&
    (character.hp / character.max_hp < character.mp / character.max_mp ||
      (character.hp < character.max_hp * 0.6 && character.mp > 1000));

  const stat = shouldRestoreHp ? "hp" : "mp";
  const missing = character[`max_${stat}`] - character[stat];
  const regenMissing = stat === "hp" ? 50 : 100;

  if (missing > 500 && !is_on_cooldown(`use_${stat}`) && !isChanneling)
    return `use_${stat}`;
  if (missing > regenMissing && !is_on_cooldown(`regen_${stat}`))
    return `regen_${stat}`;

  return undefined;
}

async function potionLoop() {
  try {
    const skillToUse = pickRestoreSkill();

    if (skillToUse) {
      await withTimeout(use_skill(skillToUse));

      const minPing = Math.min(...parent.pings);
      reduce_cooldown("use_mp", minPing);
      reduce_cooldown("use_hp", minPing);
    }
  } catch (e) {}
  setTimeout(
    potionLoop,
    Math.min(
      Math.max(ms_to_next_skill("use_mp"), 5),
      Math.max(ms_to_next_skill("use_hp"), 5),
    ),
  );
}

const INTERVAL_BREAKPOINTS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
function getLoopInterval() {
  const dynamicInterval = INTERVAL_BREAKPOINTS.map(
    (breakpoint) => ((1 / character.frequency) * 1000) / breakpoint,
  ).find((loopInterval) => loopInterval > 250);
  const nextAttackMs = ms_to_next_skill("attack");

  return dynamicInterval === undefined || nextAttackMs <= dynamicInterval
    ? Math.max(nextAttackMs, 1)
    : dynamicInterval;
}

function ms_to_next_skill(skill) {
  const next_skill = parent.next_skill[skill];
  if (next_skill == undefined) return 0;
  const ms = parent.next_skill[skill].getTime() - Date.now();
  return ms < 0 ? 0 : ms;
}

/**
 * Self-rescheduling loop for one skill, decoupled from the attack loop.
 * Reschedules on `ms_to_next_skill(skill)` (floored by `floorMs`); a non-skill
 * name makes it a fixed `floorMs` loop.
 * @param {string} skill - skill name to key the cooldown on
 * @param {() => boolean} canUse - whether to cast this tick
 * @param {() => Promise} cast - issues the skill; awaited to avoid double-casts
 * @param {() => number} [nextDelayMs] - overrides the reschedule delay
 */
// Skills used to sit in fight(), which mainLoop skipped while smart moving, so
// loops stay silent then too. whileMoving opts back in the ones that used to
// run from their own loop or before mainLoop's smart_move throw.
function runSkillLoop({
  skill,
  canUse,
  cast,
  floorMs = 100,
  timeoutMs = 1000,
  whileMoving = false,
  nextDelayMs,
}) {
  async function loop() {
    try {
      const isMovingControlled =
        (smart.moving || isAdvanceSmartMoving) && !smartmoveDebug;

      // A paused cave refuses every action
      if (
        !character.rip &&
        !character.cave?.paused &&
        (whileMoving || !isMovingControlled) &&
        canUse()
      )
        await withTimeout(cast(), timeoutMs);
    } catch (e) {
      console.log(`[skillLoop:${skill}]`, e);
    } finally {
      setTimeout(
        loop,
        nextDelayMs?.() ?? Math.max(ms_to_next_skill(skill), floorMs),
      );
    }
  }
  loop();
  return loop;
}

/**
 * Whether this character unlocked the cosmetic a novelty skill rides on.
 * @param {string} skill
 * @returns {boolean}
 */
function hasCosmeticSkill(skill) {
  const emote = G.skills[skill]?.emote;
  return Boolean(emote && character.acx?.[emote]);
}

/** character name -> when we last kissed them */
const kissedAt = {};

/** @returns {Object|undefined} whoever in range has gone longest without one */
function getKissTarget() {
  const inRange = Object.values(parent.entities).filter(
    (entity) =>
      entity?.type === "character" &&
      !entity.npc &&
      !entity.rip &&
      is_in_range(entity, "ikissyou"),
  );

  // One shared cooldown, and the visit ticket expires — the emote can wait
  if (hasAnniversaryVisitToMake()) {
    const featured = getAnniversaryEvent()?.id;
    return inRange.find((entity) => entity.name === featured);
  }

  return inRange
    .filter((entity) => !isOwnedCharacter(entity.name))
    .sort((lhs, rhs) => {
      const waited = (kissedAt[lhs.name] ?? 0) - (kissedAt[rhs.name] ?? 0);
      if (waited) return waited;

      return distance(character, lhs) - distance(character, rhs);
    })[0];
}

/** Novelty emotes — every class that unlocked the cosmetic gets them */
function startCosmeticSkillLoops() {
  let pendingKissTarget = null;

  runSkillLoop({
    skill: "makeawish",
    floorMs: 1000,
    whileMoving: true,
    canUse: () =>
      hasCosmeticSkill("makeawish") && character.mp >= G.skills.makeawish.mp,
    cast: () => use_skill("makeawish"),
  });

  runSkillLoop({
    skill: "ikissyou",
    floorMs: 1000,
    whileMoving: true,
    canUse: () => {
      if (!hasCosmeticSkill("ikissyou")) return false;

      pendingKissTarget = getKissTarget();
      return pendingKissTarget != null;
    },
    cast: () => {
      kissedAt[pendingKissTarget.name] = Date.now();
      return use_skill("ikissyou", pendingKissTarget);
    },
  });

  runSkillLoop({
    skill: "drop_egg",
    whileMoving: true,
    canUse: () =>
      hasCosmeticSkill("drop_egg") &&
      character.moving &&
      !is_on_cooldown("drop_egg"),
    cast: () => use_skill("drop_egg"),
  });
}

function sleep(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}
