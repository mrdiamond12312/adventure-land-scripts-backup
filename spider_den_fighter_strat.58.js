// The Spider Den: three stationary queens that all join once one is hit

const SPIDER_DEN = {
  scareAddsAt: 3,
};

/** @returns {Object[]} the queens by dps shed per second of killing, none if unholdable */
function planSpiderDenFight(judged, fight) {
  const worth = ({ boss, killS }) => dungeonBossDps(boss, fight) / killS;
  const queens = [...judged].sort((lhs, rhs) => worth(rhs) - worth(lhs));
  return canFightDungeonGroup(queens, fight) ? queens : [];
}

async function useSpiderDenStrategy() {
  if (!isOurDungeonRun("spider")) return undefined;
  const dungeon = DUNGEONS.spider;
  if (character.map !== dungeon.map) return approachDungeon(dungeon);
  const stale = leaveStaleDungeonInstance(dungeon);
  if (stale) return stale;

  const fight = getDungeonFight();
  const bosses = noteDungeonBosses(dungeon);
  if (!fight.isReady) return waitForDungeonParty(dungeon);

  const judged = judgeDungeonBosses(dungeon, fight);
  if (!judged.length) {
    dungeonLog(dungeon.id, "cleared");
    closeDungeonRun(dungeon.id);
    return undefined;
  }

  const isBossOnUs = judged.some(isDungeonBossOnUs);
  const queens = planSpiderDenFight(judged, fight);
  if (!queens.length) return giveUpDungeonFight(dungeon, isBossOnUs);

  if (!isAssignedAsTanker()) {
    const adds = listOfMonsterAttacking(character).filter(
      (mob) => !bosses.includes(mob),
    );
    if (adds.length >= SPIDER_DEN.scareAddsAt) {
      dungeonLog(dungeon.id, `scaring off ${adds.length} spiders`);
      await scareAwayMobs();
    }
  }

  const add = !isBossOnUs && getDungeonAdd(bosses);
  if (add) {
    changeToNormalStrategies();
    return engage(add);
  }

  const queen = queens.find(isDungeonBossOnUs) ?? queens[0];
  if (!queen.entity) return walkToDungeonBoss(dungeon, queen);

  changeToPullStrategies();
  return engageDungeonBoss(dungeon, queen.entity, fight);
}
