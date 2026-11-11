// Debug checks: call one by name from the Hub, results go to console.warn

const debugChecks = {};

/**
 * @param {string} name
 * @param {number} seconds
 * @param {(tools: {on: Function, every: Function}) => (label: string) => void} setup - returns the reporter
 */
function runDebugCheck(name, seconds, setup) {
  debugChecks[name]?.();

  const handlers = [];
  const timers = [];
  const report = setup({
    on: (event, handler) => {
      parent.socket.on(event, handler);
      handlers.push([event, handler]);
    },
    every: (ms, callback) => timers.push(setInterval(callback, ms)),
  });

  const stop = () => {
    timers.forEach((timer) => clearInterval(timer));
    handlers.forEach(([event, handler]) => parent.socket.off(event, handler));
    clearTimeout(ender);
    delete debugChecks[name];
  };
  const ender = setTimeout(() => {
    report("done");
    stop();
  }, seconds * 1000);

  debugChecks[name] = stop;
  console.warn(`${name}: started for ${seconds}s`);
}

function stopDebugChecks() {
  Object.values(debugChecks).forEach((stop) => stop());
}

/**
 * Shots fired against what the live frequency allows.
 * @param {number} [seconds]
 * @param {number} [targetPercent]
 */
function checkFrequency(seconds = 120, targetPercent = 95) {
  runDebugCheck("checkFrequency", seconds, ({ on, every }) => {
    let possible = 0;
    let shots = 0;
    let fightMs = 0;
    let readyMs = 0;
    const lost = { penalty: 0, swapping: 0, mp: 0, channel: 0, other: 0 };
    let lastSample = Date.now();

    const inFight = () => {
      const target = get_target();
      return (
        !character.rip &&
        !smart.moving &&
        !!target &&
        !target.dead &&
        target.type === "monster" &&
        distance(character, target) <= character.range + character.xrange
      );
    };

    const rates = () =>
      `${((shots / possible) * 100).toFixed(1)}% | should be ${(possible / (fightMs / 1000)).toFixed(2)}/s, fired ${(shots / (fightMs / 1000)).toFixed(2)}/s`;

    const report = (label) => {
      if (!possible) return console.warn(`checkFrequency ${label}: no fight yet`);
      const share = (ms) => `${((ms / fightMs) * 100).toFixed(1)}%`;
      console.warn(
        `checkFrequency ${label}: ${rates()} (want ${targetPercent}%) | ${shots} shots of ${possible.toFixed(1)} possible in ${(fightMs / 1000).toFixed(0)}s | ready but not firing ${share(readyMs)}: penalty ${share(lost.penalty)}, swapping ${share(lost.swapping)}, mp ${share(lost.mp)}, channel ${share(lost.channel)}, other ${share(lost.other)}`,
      );
    };

    on("skill_timeout", (d) => {
      if (d.name === "attack" && !d.reason && inFight()) shots++;
    });
    every(50, () => {
      const now = Date.now();
      const dt = now - lastSample;
      lastSample = now;
      if (!inFight()) return;

      fightMs += dt;
      possible += (character.frequency * dt) / 1000;
      if (ms_to_next_skill("attack") > 0) return;

      readyMs += dt;
      if (character.s.penalty_cd) lost.penalty += dt;
      else if (isEquipBusy()) lost.swapping += dt;
      else if (character.mp < character.mp_cost) lost.mp += dt;
      else if (Object.keys(character.c).length) lost.channel += dt;
      else lost.other += dt;
    });
    every(1000, () => {
      if (possible) console.warn(`checkFrequency: ${rates()}`);
    });
    return report;
  });
}

/**
 * Refused and late shots.
 * @param {number} [seconds]
 */
function checkAttacks(seconds = 120) {
  runDebugCheck("checkAttacks", seconds, ({ on }) => {
    let lastAt = 0;
    let expected = 0;
    let shots = 0;
    let late = 0;
    const rejects = {};
    const state = () =>
      `hand ${character.slots.mainhand?.name} swapping ${isEquipBusy()} mp ${Math.round(character.mp)} pen ${character.s.penalty_cd?.ms ?? 0} frozen ${!!character.s.frozen} ping ${Math.round(character.ping)}`;

    on("game_response", (d) => {
      if (d?.place !== "attack" || !d.failed) return;
      const why = d.reason ?? d.response;
      rejects[why] = (rejects[why] ?? 0) + 1;
      console.warn(`REJECT ${why} ms ${d.ms ?? "-"} ${state()}`);
    });
    on("skill_timeout", (d) => {
      if (d.name !== "attack") return;
      const now = Date.now();
      if (d.reason) {
        expected = now - lastAt + d.ms;
        return;
      }
      shots++;
      const gap = now - lastAt;
      if (lastAt && gap > expected + 150 && gap < 5000) {
        late++;
        console.warn(`LATE gap ${gap} expected ${Math.round(expected)} ${state()}`);
      }
      lastAt = now;
      expected = Math.max(d.ms, shotCycleMs());
    });

    return (label) =>
      console.warn(
        `checkAttacks ${label}: ${shots} shots, ${late} late, rejects ${JSON.stringify(rejects)}`,
      );
  });
}

/**
 * Each self-energized shot and the one after it.
 * @param {number} [seconds]
 */
function checkEnergize(seconds = 90) {
  runDebugCheck("checkEnergize", seconds, ({ on }) => {
    let energizedAt = 0;
    let last;
    let attacks = 0;
    let energizes = 0;

    on("skill_timeout", (d) => {
      if (d.name === "energize") {
        energizes++;
        energizedAt = Date.now();
      }
      if (d.name !== "attack" || d.reason) return;

      attacks++;
      const now = Date.now();
      if (last?.energized || last?.afterEnergized)
        console.warn(
          `${last.energized ? "E" : "next"} cd ${last.cooldown} pen ${last.penalty} gap ${now - last.at} ping ${last.ping}`,
        );
      last = {
        at: now,
        cooldown: d.ms,
        penalty: d.penalty ?? 0,
        energized: now - energizedAt < 150,
        afterEnergized: !!last?.energized,
        ping: Math.round(character.ping),
      };
    });

    return (label) =>
      console.warn(
        `checkEnergize ${label}: ${attacks} attacks, ${energizes} energizes`,
      );
  });
}

/**
 * How often the impact swap holds, and from how far he shoots.
 * @param {number} [seconds]
 */
function checkPiercingSwap(seconds = 30) {
  runDebugCheck("checkPiercingSwap", seconds, ({ every }) => {
    const held = {};
    const distances = [];
    let samples = 0;
    let swapping = 0;

    every(50, () => {
      samples++;
      const name = character.slots.mainhand?.name ?? "none";
      held[name] = (held[name] ?? 0) + 1;
      if (isEquipBusy()) swapping++;
      const target = get_target();
      if (target) distances.push(Math.round(distance(character, target)));
    });

    return (label) => {
      distances.sort((lhs, rhs) => lhs - rhs);
      console.warn(
        `checkPiercingSwap ${label}: held ${JSON.stringify(held)} | equip busy ${((swapping / Math.max(samples, 1)) * 100).toFixed(0)}% | target distance median ${distances[distances.length >> 1]}`,
      );
    };
  });
}

/**
 * Median shot gap per projectile, which tells the weapon fired.
 * @param {number} [seconds]
 */
function checkShotGaps(seconds = 60) {
  runDebugCheck("checkShotGaps", seconds, ({ on }) => {
    const shots = [];
    on("action", (a) => {
      if (a.attacker === character.name && a.source === "attack")
        shots.push({ at: Date.now(), projectile: a.projectile });
    });

    return (label) => {
      const byProjectile = {};
      shots.forEach((shot, i) => {
        const entry = (byProjectile[shot.projectile] ??= { count: 0, gaps: [] });
        entry.count++;
        if (shots[i - 1]?.projectile === shot.projectile)
          entry.gaps.push(shot.at - shots[i - 1].at);
      });
      for (const [projectile, { count, gaps }] of Object.entries(byProjectile)) {
        gaps.sort((lhs, rhs) => lhs - rhs);
        console.warn(
          `checkShotGaps ${label}: ${projectile} ${count} shots, median gap ${gaps[gaps.length >> 1] ?? "?"}ms`,
        );
      }
    };
  });
}

/** Rogue: the target's burn against the refuel line */
function checkRogueBurn() {
  withItemInfoMemo(() => {
    const target = get_target();
    const fuel = pickRogueGear(target, "fuel", true);
    const damage = pickRogueGear(target, "damage", true);
    console.warn(
      `checkRogueBurn: burn ${target.s?.burned?.intensity ?? 0} by ${target.s?.burned?.f} | line ${Math.round(BURN_REFUEL_SHARE * fuel.model.burnCap)} | fuel ${fuel.gear.mainhand}+${fuel.gear.offhand} cap ${Math.round(fuel.model.burnCap)} | damage ${damage.gear.mainhand}+${damage.gear.offhand} cap ${Math.round(damage.model.burnCap)} | stack ${Math.round(fuel.model.stack)}`,
    );
  });
}

/** Rogue: every burn weapon pair in the bag on the target */
function checkRogueWeapons() {
  withItemInfoMemo(() => {
    const target = get_target();
    const worn = getWornGearInfos();
    const copies = getGearCopies(ROGUE_WEAPON_SLOTS);
    const names = Object.keys(copies);
    for (const mainName of names)
      for (const offName of names) {
        const mainhand = copies[mainName][0];
        const offhand = copies[offName][offName === mainName ? 1 : 0];
        if (
          !offhand ||
          !fitsRogueHand(mainhand, "mainhand") ||
          !fitsRogueHand(offhand, "offhand") ||
          (mainhand.wtype === "stars" && offhand.wtype !== "stars") ||
          (mainhand.ability !== "burn" && offhand.ability !== "burn")
        )
          continue;

        const picks = { mainhand, offhand };
        const model = rogueFightModel(
          { ...character, ...projectStatsWith(picks) },
          picks,
          target,
          worn,
        );
        console.warn(
          `checkRogueWeapons: ${mainName}+${offName} attacks ${model.rates.attack.toFixed(2)} stabs ${(model.rates.quickstab ?? 0).toFixed(2)} procs/s ${model.burnProcRate.toFixed(3)} cap ${Math.round(model.burnCap)} fuel ${Math.round(rogueFuelScore(model))} dps ${Math.round(rogueDamagePerSecond(model))}`,
        );
      }
  });
}

/**
 * What the hop loop knows about a realm, and what it would do now. Hop owner only.
 * @param {string} [realm] - e.g. "ASIAI"
 */
function checkRealmMobs(realm = "ASIAI") {
  const realmData = getRealmData();
  if (!realmData || typeof pickHopDecision !== "function") {
    console.warn(`checkRealmMobs: ${character.name} doesn't own the realm data`);
    return;
  }

  const secondsAgo = (at) => Math.round((Date.now() - at) / 1000);
  const cached = realmData.realms[realm];
  const freshness = !cached
    ? "no data"
    : `updated ${secondsAgo(cached.at)}s ago${realmData.isStale(realm) ? " (stale, ignored)" : ""}`;

  const best = getRaceCandidates()[0];
  const bossLines = realmData
    .query()
    .filter((row) => realmOf(row) === realm)
    .map((row) => {
      const maxHp = row.max_hp ?? G.monsters[row.type]?.hp;
      const hp = row.hp && maxHp ? `${Math.round((100 * row.hp) / maxHp)}%` : "?";
      const isExempt = FATIGUE_EXEMPT_BOSSES.includes(row.type);
      const verdict =
        best?.type === row.type && realmOf(best) === realm
          ? "race leader"
          : isExempt && isReachableRealm(row, row.type)
          ? "exempt, chased"
          : trackedBossTypes().includes(row.type) && isHopCandidate(row)
          ? "race candidate"
          : "not chased";
      return `  ${row.type} hp ${hp} target ${row.target ?? "none"}: ${verdict}`;
    });

  const sightingLines = Object.entries(readStore(REALM_SIGHTINGS_LS_KEY))
    .filter(([, sighting]) => sighting.realm === realm)
    .map(
      ([type, sighting]) =>
        `  ${type} on ${sighting.map} hp ${sighting.hp ?? "?"} target ${sighting.target ?? "none"}, ${secondsAgo(sighting.seenAt)}s ago`,
    );

  const picked = pickHopDecision();
  const where = picked?.decision.target
    ? ` → ${realmOf(picked.decision.target)}`
    : "";
  const decision = picked
    ? `${picked.rule.name}: ${picked.decision.action}${where} — ${picked.decision.reason}`
    : "no rule decided";

  console.warn(
    [
      `checkRealmMobs ${realm}: ${freshness}`,
      "live bosses:",
      ...(bossLines.length ? bossLines : ["  none"]),
      "observer sightings:",
      ...(sightingLines.length ? sightingLines : ["  none"]),
      `hop decision now: ${decision}`,
    ].join("\n"),
  );
}
