// The Dark Mage's lair: one mage through four phases

async function useDarkMageStrategy() {
  if (!isOurDungeonRun("darkMage")) return undefined;
  const dungeon = DUNGEONS.darkMage;
  if (character.map !== dungeon.map) return approachDungeon(dungeon);
  const stale = leaveStaleDungeonInstance(dungeon);
  if (stale) return stale;

  const fight = getDungeonFight();
  const bosses = noteDungeonBosses(dungeon);
  if (!fight.isReady) return waitForDungeonParty(dungeon);

  const [phase] = judgeDungeonBosses(dungeon, fight);
  if (!phase) {
    dungeonLog(dungeon.id, "cleared");
    closeDungeonRun(dungeon.id);
    return undefined;
  }
  if (!canFightDungeonGroup([phase], fight))
    return giveUpDungeonFight(dungeon, isDungeonBossOnUs(phase));

  const add = !isDungeonBossOnUs(phase) && getDungeonAdd(bosses);
  if (add) {
    changeToNormalStrategies();
    return engage(add);
  }

  if (!phase.entity) return walkToDungeonBoss(dungeon, phase);

  changeToNormalStrategies();
  return engageDungeonBoss(dungeon, phase.entity, fight);
}
