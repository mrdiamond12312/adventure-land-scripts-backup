// The Tomb: four protectors, each in its own room

const TOMB = {
  order: [["gbluepro"], ["gredpro", "ggreenpro"], ["gpurplepro"]],
  tagReach: 250,
};

/** @returns {Object[][]} the fights left, a pair split if unholdable */
function planTombFights(judged, fight) {
  return TOMB.order
    .map((types) =>
      types.flatMap((mtype) => judged.filter((entry) => entry.mtype === mtype)),
    )
    .filter((group) => group.length)
    .flatMap((group) =>
      canFightDungeonGroup(group, fight)
        ? [group]
        : group
            .filter((entry) => canFightDungeonGroup([entry], fight))
            .map((entry) => [entry]),
    );
}

/** @returns {{entry: Object, dragTo?: Object}} the protector to hit, and where to drag it */
function planTombTick(group, fight) {
  const onUs = group.filter(isDungeonBossOnUs);
  if (!onUs.length) return { entry: group[0] };

  const idle = group.filter((entry) => !isDungeonBossOnUs(entry));
  const near = idle.find(
    ({ entity }) => entity && distance(entity, fight.holder) < TOMB.tagReach,
  );
  if (near && isAssignedAsTanker()) return { entry: near };

  const far = idle.find((entry) => entry !== near);
  const dragTo =
    far &&
    (far.entity
      ? { map: character.map, x: far.entity.x, y: far.entity.y }
      : far.spot);
  return { entry: onUs[0], dragTo };
}

async function useTombStrategy() {
  if (!isOurDungeonRun("tomb")) return undefined;
  const dungeon = DUNGEONS.tomb;
  if (character.map !== dungeon.map) return approachDungeon(dungeon);

  const fight = getDungeonFight();
  const bosses = noteDungeonBosses(dungeon);
  if (!fight.isReady) return leaveDungeonFight(dungeon);

  const judged = judgeDungeonBosses(dungeon, fight);
  if (!judged.length) {
    dungeonLog(dungeon.id, "cleared");
    closeDungeonRun(dungeon.id);
    return undefined;
  }

  const onUs = judged.filter(isDungeonBossOnUs);
  const group = planTombFights(judged, fight).find((candidate) =>
    onUs.every((entry) =>
      candidate.some(({ mtype }) => mtype === entry.mtype),
    ),
  );
  if (!group) return giveUpDungeonFight(dungeon, onUs.length > 0);

  const add = !onUs.length && getDungeonAdd(bosses);
  if (add) {
    changeToNormalStrategies();
    return engage(add);
  }

  const { entry, dragTo } = planTombTick(group, fight);
  if (!entry.entity) return walkToDungeonBoss(dungeon, entry);

  changeToNormalStrategies();
  return engageDungeonBoss(dungeon, entry.entity, fight, dragTo);
}
