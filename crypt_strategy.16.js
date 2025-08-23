const defeatableBosses = ["a3", "a7", "a2"];
const scarableBosses = ["a3", "a7", "a2", "a8", "a5", "a4"];

const VBAT_LOCATION = {
  name: "vbat",
  map: "crypt",
  x: 1191,
  y: -384.5,
};

const CRYPT_STARTING_LOCATION = {
  map: "crypt",
  x: 0,
  y: -226,
};

let snowballThreshold = 10;
var currentJunction = 0;
const CRYPT_JUNCTION = [
  CRYPT_STARTING_LOCATION,
  { x: -210, y: -1085 },
  { x: 375, y: -1085 },
  { x: 741, y: -1085 },
  { x: 726, y: -636 },
  { x: 1185, y: -465 },
  { x: 1544, y: -879 },
  { x: 2039, y: -879 },
  { x: 2491, y: -681 },
  { x: 2682, y: -1100 },
  { x: 2732, y: -1729 },
  { x: 1997, y: -1754 },
  { x: 1216, y: -1485 },
  { x: 373, y: -1305 },
];

function getMobsListNearTarget(mob) {
  return Object.values(parent.entities).filter(
    (othermob) =>
      othermob.type === "monster" &&
      othermob.mtype !== mob.mtype &&
      distance(othermob, mob) < 250,
  );
}

async function useCryptStrategy(target) {
  if (!get("cryptInstance") || character.map !== "crypt") return;
  rangeRate = calculateRangeRate() ?? originRangeRate ?? basicRangeRate;
  const defeatedCrybtMobs = get("cryptDefeatedMobs") ?? [];

  if (
    defeatedCrybtMobs.filter((mtype) => mtype === "vbat").length >= 7 &&
    defeatedCrybtMobs.filter((mtype) => mtype !== "vbat").length >=
      defeatableBosses.length
  ) {
    set("cryptInstance", undefined);
    return;
  }

  // Check for 7 vbats
  if (defeatedCrybtMobs.filter((mtype) => mtype === "vbat").length < 7) {
    if (
      !get_nearest_monster({ type: "vbat" }) &&
      !get_nearest_monster({ type: "a2" })
    ) {
      await advanceSmartMove(VBAT_LOCATION);
    }

    const vbat =
      character.name === TANKER
        ? get_nearest_monster({ type: "a2" }) ||
          get_targeted_monster() ||
          get_nearest_monster({ type: "vbat" })
        : get_nearest_monster({ type: "a2" }) ||
          get_target_of(get_entity(TANKER)) ||
          get_nearest_monster({ target: TANKER }) ||
          get_nearest_monster({ target: HEALER }) ||
          get_nearest_monster({ target: MAGE }) ||
          get_nearest_monster({ type: "vbat" });

    const nearestKillableBosses = Object.values(parent.entities).filter(
      (mobs) =>
        mobs.type === "monster" &&
        defeatableBosses.includes(mobs.mtype) &&
        distance(character, mobs) < 200,
    );

    const nearestFormiddableBosses = Object.values(parent.entities).filter(
      (mobs) =>
        mobs.type === "monster" &&
        ![...scarableBosses, "vbat"].includes(mobs.mtype) &&
        distance(character, mobs) < 300,
    );

    if (nearestFormiddableBosses.length || nearestKillableBosses.length > 2) {
      log("Too dangerous");
      await advanceSmartMove(
        CRYPT_JUNCTION.sort(
          (lhs, rhs) => distance(character, rhs) - distance(character, lhs),
        ).pop(),
      );
    } else {
      if (
        !get_nearest_monster({ type: "vbat" }) &&
        distance(character, VBAT_LOCATION) < 200
      ) {
        // const defeatedCryptMobs = get("cryptDefeatedMobs");
        // defeatedCryptMobs.push(...Array(7).fill("vbat"));
        // set("cryptDefeatedMobs", defeatedCryptMobs);
      } else target = vbat;
    }
  }
  // No more vbat, now trying for killable bosses
  else {
    const currentTarget = get_targeted_monster();
    const lastSeenDefeatableCryptBoss = get("lastSeenDefeatableCryptBoss");
    if (
      !currentTarget ||
      currentTarget?.mtype !== get("lastSeenDefeatableCryptBoss")?.mtype
    ) {
      if (lastSeenDefeatableCryptBoss) {
        await advanceSmartMove(lastSeenDefeatableCryptBoss);
        target = get_nearest_monster({
          type: lastSeenDefeatableCryptBoss.mtype,
        });
        if (!get_nearest_monster({ type: lastSeenDefeatableCryptBoss.mtype })) {
          set("lastSeenDefeatableCryptBoss", undefined);
        } else
          set("lastSeenDefeatableCryptBoss", {
            mtype: target?.mtype,
            x: target?.x,
            y: target?.y,
            map: character.map,
          });
      } else {
        const checkBossInterval = setInterval(() => {
          const nearbyBoss = Object.values(parent.entities).filter(
            (mob) =>
              mob.type === "monster" &&
              defeatableBosses.includes(mob.mtype) &&
              getMobsListNearTarget(mob).length < 1,
          );
          if (nearbyBoss.length) {
            set("lastSeenDefeatableCryptBoss", {
              mtype: nearbyBoss[0]?.mtype,
              x: nearbyBoss[0]?.x,
              y: nearbyBoss[0]?.y,
              map: character.map,
            });
            change_target(nearbyBoss[0]);
            target = nearbyBoss[0];
            clearInterval(checkBossInterval);
            stop("smart");
          }
        }, 2000);
        await advanceSmartMove(
          CRYPT_JUNCTION[currentJunction++ % CRYPT_JUNCTION.length],
        );
      }
    } else {
      const otherBossNearCurrentTarget = getMobsListNearTarget(currentTarget);

      if (
        otherBossNearCurrentTarget.length >
          (currentTarget.mtype === "a5" ? 2 : 1) ||
        otherBossNearCurrentTarget.some(
          (mob) => !defeatableBosses.includes(mob.mtype),
        )
      ) {
        await advanceSmartMove(CRYPT_STARTING_LOCATION);
        set("lastSeenDefeatableCryptBoss", undefined);
      } else if (
        otherBossNearCurrentTarget.length === 1 &&
        otherBossNearCurrentTarget[0]?.mtype === "a5"
      ) {
        set("lastSeenDefeatableCryptBoss", {
          mtype: otherBossNearCurrentTarget[0]?.mtype,
          x: otherBossNearCurrentTarget[0]?.x,
          y: otherBossNearCurrentTarget[0]?.y,
          map: character.map,
        });
        change_target(otherBossNearCurrentTarget[0]);
        target = otherBossNearCurrentTarget;
      } else {
        set("lastSeenDefeatableCryptBoss", {
          mtype: currentTarget?.mtype,
          x: currentTarget?.x,
          y: currentTarget?.y,
          map: character.map,
        });
        target = currentTarget;
      }
    }
  }

  if (
    listOfMonsterAttacking(character).length >
      (character.ctype === "warrior" ? 1 : 0) ||
    character.hp < character.max_hp * 0.6
  ) {
    await scareAwayMobs();

    if (!get_entity(HEALER)) await advanceSmartMove(CRYPT_STARTING_LOCATION);
  }

  if (get_targeted_monster()?.mtype === "vbat") changeToPullStrategies;
  else changeToNormalStrategies();

  switch (character.ctype) {
    case "warrior":
      if (
        target &&
        (target.mtype === "a2" ||
          ![...defeatableBosses, "vbat"].includes(target.mtype)) &&
        (!target.s?.frozen || target.s.frozen.ms < 300) &&
        locate_item("snowball") !== -1 &&
        is_in_range(target, "snowball") &&
        !is_on_cooldown("snowball")
      ) {
        if (snowballThreshold < 0) {
          use_skill("snowball", target);
          snowballThreshold = 10;
        } else {
          snowballThreshold--;
        }
      }

      const mobTargetingAlly = Object.values(parent.entities).find((mob) => {
        return (
          [...defeatableBosses, "vbat"].includes(mob.mtype) &&
          partyMems.includes(mob.target) &&
          mob.target !== character.name
        );
      });

      if (
        character.name === TANKER &&
        character.mp > G.skills["taunt"].mp &&
        !is_on_cooldown("taunt") &&
        mobTargetingAlly &&
        character.hp > character.max_hp * 0.4
      )
        use_skill("taunt", mobTargetingAlly).then(() =>
          reduce_cooldown("taunt", character.ping * 0.95),
        );

      break;

    case "priest":
      const lowHpMember = partyMems
        .map((id) => get_entity(id))
        .filter((char) => char)
        .find((char) => char.hp < char.max_hp * 0.3);
      if (
        lowHpMember &&
        is_in_range(lowHpMember, "absorb") &&
        character.mp > G.skills["absorb"].mp &&
        !is_on_cooldown("absorb")
      )
        use_skill("absorb", lowHpMember);

      break;

    case "mage":
      break;

    default:
      break;
  }

  return target;
}

character.on("target_hit", (data) => {
  if (data.kill) {
    const target = parent.entities[data?.target]?.mtype;
    if (defeatableBosses.includes(target) || target === "vbat") {
      const defeatedCryptMobs = get("cryptDefeatedMobs");
      defeatedCryptMobs.push(target);
      set("cryptDefeatedMobs", defeatedCryptMobs);
      set("lastSeenDefeatableCryptBoss", undefined);
    }
  }
});
