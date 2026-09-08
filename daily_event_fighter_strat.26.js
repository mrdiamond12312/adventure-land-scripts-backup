// Daily events and world bosses — the fighter's highest priority strategy.

/**
 * Targets whatever live event outranks farming, walking there when it is out of
 * sight. A live event owns the tick even with nothing in reach: the field is
 * empty between waves, and going back to the farming spot loses the fight.
 * @returns {Promise<object|undefined>} the event outcome, if one owns this tick
 */
async function useEventStrategy() {
  if (
    (server.status.goobrawl ||
      get_nearest_monster({ type: "bgoo" }) ||
      get_nearest_monster({ type: "rgoo" })) &&
    !character.s["hopsickness"]
  ) {
    changeToPullStrategies();
    if (character.map !== "goobrawl") {
      await join("goobrawl");
      await sleep(character.ping);
    }

    const engagedGoo = ["bgoo", "rgoo"].includes(get_targeted_monster()?.mtype)
      ? get_targeted_monster()
      : undefined;

    return engage(
      get_nearest_monster({ type: "rgoo" }) ??
        engagedGoo ??
        get_nearest_monster({ type: "bgoo" }),
    );
  }

  if (server.status.dragold?.live) {
    changeToPullStrategies();

    let dragoldInstance = get_nearest_monster({ type: "dragold" });
    if (!dragoldInstance) {
      await advanceSmartMove(server.status.dragold);
      dragoldInstance = get_nearest_monster({ type: "dragold" });
    }

    return engage(dragoldInstance);
  }

  const activeBosses = [];

  if (server.status.mrpumpkin?.live) {
    activeBosses.push({
      ...server.status.mrpumpkin,
      type: "mrpumpkin",
      strategy: changeToPullStrategies,
    });
  }

  if (server.status.mrgreen?.live) {
    activeBosses.push({
      ...server.status.mrgreen,
      type: "mrgreen",
      strategy: changeToPullStrategies,
    });
  }

  if (server.status.icegolem?.live) {
    activeBosses.push({
      ...server.status.icegolem,
      type: "icegolem",
      strategy: changeToNormalStrategies,
    });
  }

  if (activeBosses.length) {
    const bossToFight = activeBosses
      .sort(
        (lhs, rhs) =>
          lhs.hp / parent.G.monsters[lhs.type].hp -
          rhs.hp / parent.G.monsters[rhs.type].hp,
      )
      .shift();

    if (bossToFight) {
      bossToFight.strategy();

      let bossInstance = get_nearest_monster({ type: bossToFight.type });
      if (!bossInstance) {
        await advanceSmartMove(bossToFight);
        bossInstance = get_nearest_monster({ type: bossToFight.type });
      }

      return engage(bossInstance);
    }
  }

  if (server.status.crabxx?.live) {
    if (character.range > 100) rangeRate = 0.3;

    const inRange = (entity) =>
      distance(entity, character) < character.range + character.xrange * 0.8;

    let { crabxxInstance, crabxList } = getCrabsForCrabxx();

    if (!crabxxInstance) {
      if (character.s.hopsickness) {
        await advanceSmartMove(server.status.crabxx);
      } else {
        await join("crabxx");
        await sleep(character.ping);
      }
      ({ crabxxInstance, crabxList } = getCrabsForCrabxx());

      if (!crabxxInstance) return travelling();
    }

    let bestCrabx;
    let bestClusteredCrabx;

    for (const crabx of crabxList) {
      const isCurrentCrabxInRange = inRange(crabx);
      const currentCrabxHp = crabx.predictedHp ?? crabx.hp ?? 0;
      const bestCrabxHp = bestCrabx?.predictedHp ?? bestCrabx?.hp ?? 0;

      if (!bestCrabx) {
        bestCrabx = crabx;
      } else {
        const isBestCrabxInRange = inRange(bestCrabx);

        if (isCurrentCrabxInRange && !isBestCrabxInRange) {
          bestCrabx = crabx;
        } else if (isCurrentCrabxInRange === isBestCrabxInRange) {
          if (currentCrabxHp > bestCrabxHp) {
            bestCrabx = crabx;
          }
        }
      }

      if (distance(crabx, crabxxInstance) <= BLAST_RADIUS) {
        const bestClusteredCrabxHp =
          bestClusteredCrabx?.predictedHp ?? bestClusteredCrabx?.hp ?? 0;
        if (!bestClusteredCrabx || currentCrabxHp > bestClusteredCrabxHp) {
          bestClusteredCrabx = crabx;
        }
      }
    }

    if (
      character.ctype === "warrior" &&
      (!crabxxInstance.s.stunned ||
        crabxxInstance.s.stunned.ms < character.ping / 2) &&
      crabxList.length <= 1
    ) {
      await warriorStomp();
    }

    let targetCrab;

    // The shell ("1hp") is what decides the target, not whether crabx happen to
    // be standing around: while it is up every hit on the boss lands for 1, and
    // the moment it drops the boss is worth more than any crabx.
    if (!crabxxInstance["1hp"]) {
      targetCrab = crabxxInstance;
    } else if (character.ctype === "warrior") {
      targetCrab = bestClusteredCrabx || crabxxInstance;
    } else {
      targetCrab =
        bestCrabx || (crabxxInstance?.target ? crabxxInstance : undefined);
    }

    const isTanker = isAssignedAsTanker();
    const canAgitate =
      isTanker &&
      !is_on_cooldown("agitate") &&
      character.mp > G.skills["agitate"].mp + 500;

    const hasCrabxSpawnedByCrabxx = crabxList.some(
      (entity) => entity.s?.young && entity.target === character.name,
    );

    if (hasCrabxSpawnedByCrabxx && (!isTanker || canAgitate)) {
      const promisesToAwait = [];
      promisesToAwait.push(scareAwayMobs());

      if (canAgitate) {
        promisesToAwait.push(use_skill("agitate"));
      }
      await Promise.all(promisesToAwait);
    }

    changeToPullStrategies();
    return engage(targetCrab);
  }

  if (server.status.franky?.live) {
    if (character.ctype === "warrior") changeToPullStrategies();
    else changeToNormalStrategies();

    let frankyInstance = get_nearest_monster({ type: "franky" });
    if (!frankyInstance) {
      await join("franky").catch((e) => console.warn(e));
      await sleep(character.ping);
      await advanceSmartMove(server.status.franky);
      frankyInstance = get_nearest_monster({ type: "franky" });
    }

    if (frankyInstance) {
      rangeRate = 0.2;
      await scareAwayMobs();
    }

    return engage(frankyInstance);
  }

  if (server.status.pinkgoo?.live) {
    changeToPullStrategies();

    let pinkgooInstance = get_nearest_monster({ type: "pinkgoo" });
    if (!pinkgooInstance && server.status.pinkgoo?.x) {
      await advanceSmartMove(server.status.pinkgoo);
      pinkgooInstance = get_nearest_monster({ type: "pinkgoo" });
    }

    return engage(pinkgooInstance);
  }

  if (server.status.snowman?.live) {
    changeToPullStrategies();

    let snowmanInstance = get_nearest_monster({ type: "snowman" });

    if (!snowmanInstance) {
      await advanceSmartMove(server.status.snowman);
      snowmanInstance = get_nearest_monster({ type: "snowman" });
    }

    const currentTarget = get_target();
    const grinchInstance = get_nearest_monster({ type: "grinch" });
    const beeToAttack =
      currentTarget && currentTarget.mtype === "arcticbee"
        ? currentTarget
        : get_nearest_monster({ type: "arcticbee" });

    // The shielded snowman takes nothing, so its bees are the way in
    return engage(
      grinchInstance ??
        (snowmanInstance?.s?.fullguardx ? beeToAttack : snowmanInstance),
    );
  }

  if (server.status.abtesting && !character.s.hopsickness) {
    if (character.map != "abtesting") join("abtesting");

    changeToNormalStrategies();
    const priority = [
      "priest",
      "mage",
      "ranger",
      "rogue",
      "warrior",
      "paladin",
    ];

    let pvpTarget = {
      priority: priority.length + 1,
      entity: undefined,
      sqrDistance: undefined,
    };

    for (const id in parent.entities) {
      const currentCharacter = parent.entities[id];

      if (
        currentCharacter.team === character.team ||
        currentCharacter.rip ||
        currentCharacter.hp <= 0
      )
        continue;

      const currentCharacterTarget = {
        priority: priority.findIndex(
          (element) => element === currentCharacter.ctype,
        ),
        entity: currentCharacter,
        sqrDistance:
          Math.pow(currentCharacter.real_x - character.real_x, 2) +
          Math.pow(currentCharacter.real_y - character.real_y, 2),
      };

      if (currentCharacterTarget.priority < pvpTarget.priority)
        pvpTarget = currentCharacterTarget;

      if (
        currentCharacterTarget.priority <= pvpTarget.priority &&
        currentCharacterTarget.sqrDistance <= pvpTarget.sqrDistance
      )
        pvpTarget = currentCharacterTarget;
    }

    return engage(pvpTarget.entity);
  }

  if (server.status.wabbit?.live) {
    changeToPullStrategies();
    if (character.range < 100) rangeRate = 0.1;
    else rangeRate = 0.4;

    let wabbitInstance = get_nearest_monster({ type: "wabbit" });
    if (!wabbitInstance && server.status.wabbit?.x) {
      await advanceSmartMove(server.status.wabbit);
      wabbitInstance = get_nearest_monster({ type: "wabbit" });
    }

    return engage(wabbitInstance);
  }

  // Last: every live boss above outranks the kiss
  if (await visitAnniversaryPlayer()) return travelling();

  return undefined;
}
