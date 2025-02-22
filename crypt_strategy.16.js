const defeatableBosses = ["a5", "a3", "a4", "a7"];

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

const CRYPT_DOOR = {
  map: "cave",
  x: -192,
  y: -1296,
};

var currentJunction = 0;
const CRYPT_JUNCTION = [
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
      distance(othermob, mob) < 150
  );
}

async function useCryptStrategy(target) {
  if (!get("cryptInstance") || character.map !== "crypt") return;

  const defeatedCrybtMobs = get("cryptDefeatedMobs");
  // Check for 8 vbats
  if (defeatedCrybtMobs.filter((mtype) => mtype === "vbat").length < 7) {
    if (!get_nearest_monster({ type: "vbat" })) {
      await advanceSmartMove(VBAT_LOCATION);
    }

    const vbat =
      character.name === partyMems[0]
        ? get_targeted_monster() || get_nearest_monster({ type: "vbat" })
        : get_nearest_monster({ type: "vbat", target: TANKER });

    const nearestKillableBosses = Object.values(parent.entities).filter(
      (mobs) =>
        mobs.type === "monster" &&
        defeatableBosses.includes(mobs.mtype) &&
        distance(character, mobs) < 200
    );

    const nearestFormiddableBosses = Object.values(parent.entities).filter(
      (mobs) =>
        mobs.type === "monster" &&
        ![...defeatableBosses, "vbat"].includes(mobs.mtype) &&
        distance(character, mobs) < 300
    );

    if (nearestFormiddableBosses.length || nearestKillableBosses.length > 2) {
      await advanceSmartMove(CRYPT_STARTING_LOCATION);
    } else {
      if (
        !get_nearest_monster({ type: "vbat" }) &&
        distance(character, VBAT_LOCATION) < 200
      ) {
        defeatableBosses.push(...Array(7).fill("vbat"));
      } else target = vbat;
    }
  }
  // No more vbat, now trying for killable bosses
  else {
    const currentTarget = get_targeted_monster();
    const lastSeenDefeatableCryptBoss = get("lastSeenDefeatableCryptBoss");
    if (
      !currentTarget ||
      currentTarget.mtype !== get("lastSeenDefeatableCryptBoss")
    ) {
      if (lastSeenDefeatableCryptBoss) {
        await advanceSmartMove(currentCryptBoss);
      } else {
        const checkBossInterval = setInterval(() => {
          const nearbyBoss = Object.values(parent.entities).filter(
            (mob) =>
              mob.type === "monster" &&
              defeatableBosses.includes(mob.mtype) &&
              getMobsListNearTarget(mob).length < 1
          );
          if (nearbyBoss.length) {
            set("lastSeenDefeatableCryptBoss", nearbyBoss[0]);
            change_target(nearbyBoss[0]);
            target = nearbyBoss[0];
            clearInterval(checkBossInterval);
            stop("smart");
          }
        }, 2000);
        await advanceSmartMove(
          CRYPT_JUNCTION[currentJunction++ % CRYPT_JUNCTION.length]
        );
      }
    } else {
      const otherBossNearCurrentTarget = getMobsListNearTarget(currentTarget);
      if (
        otherBossNearCurrentTarget.length > (mob.mtype === "a5" ? 2 : 1) ||
        otherBossNearCurrentTarget.some(
          (mob) => !defeatableBosses.includes(mob.mtype)
        )
      ) {
        await advanceSmartMove(CRYPT_STARTING_LOCATION);
      } else if (
        otherBossNearCurrentTarget.length === 1 &&
        otherBossNearCurrentTarget[0]?.mtype === "a5"
      ) {
        set("lastSeenDefeatableCryptBoss", otherBossNearCurrentTarget[0]);
        change_target(otherBossNearCurrentTarget[0]);
        target = otherBossNearCurrentTarget;
      }
    }
  }

  if (
    listOfMonsterAttacking(character).length >
    (character.ctype === "warrior" ? 1 : 0)
  ) {
    scareAwayMobs();
  }
  changeToNormalStrategies();

  // switch (character.ctype) {
  //   case "warrior":
  //     break;
  //   case "":
  //     break;
  // }

  return target;
}
