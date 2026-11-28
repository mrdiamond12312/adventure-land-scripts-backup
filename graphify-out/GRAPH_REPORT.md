# Graph Report - adventure-land-scripts-backup  (2026-11-28)

## Corpus Check
- 67 files · ~192,397 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 2 file(s) not represented in the graph (top: (none) 2)

## Summary
- 1713 nodes · 3393 edges · 70 communities (55 shown, 15 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 137 edges (avg confidence: 0.83)
- Token cost: 392,176 input · 0 output

## Graph Freshness
- Built from commit: `0536a4d0`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Merchant Bank Storage
- dungeon_fighter_strat.57.js
- Combat Calc & Roles
- Cave Run Strategy
- Events & Warrior Gear
- Merchant Duties & Ent Lure
- Crypt Fight
- Daily Event Bosses
- Realm Data & Home Window
- Pathing & Taut Path
- Mage Gear & Skills
- Upgrade Grace Planning
- Kiting & Targeting
- Exchange & Repo Docs
- Core Config Helpers
- Merchant Home & Stand
- Upgrade & Compound
- basic_function_loop.45.js
- Live Events & Witch Gather
- Trips, Info & Impact Notes
- StrategicSmartMove Class
- Impact Swap & Leases
- Cavalry Oneeye Tagging
- Priest Skills
- Party Plan & Deploy
- Rogue Fight Model
- Ranger Skills
- Lucky Slot Finder
- Server Hop Planning
- Grow Spawn Tracker
- merchant_gear.43.js
- Projectiles & Heal Targets
- Warrior Cleave
- Rogue Skills
- Crafting
- Mitigation & Gear Scoring
- Respawn & Midas Loot
- Crypt Backup Copy
- Dungeon Strat Chain
- Debug Checks
- Priest Gear
- Temporal Surge
- Item Stats Projection
- Equip Batching
- Home Server Settling
- Special Mob Strategy
- Ranger Gear & Cupid
- Frenzy Amulet Scoring
- Hop Rules & Lineup
- Farming Strategy
- Merchant Scouting
- Pull Target Ranking
- Realm Fatigue Notes
- Hop Candidate Priority
- Bank Sort Utility
- Fight Target Chain
- Store & Roaming NPCs
- Manual Cave Report
- Action Loop Timing
- Manual Base Script
- Manual Follow Script
- basic_warrior.9.js

## God Nodes (most connected - your core abstractions)
1. `StrategicSmartMove` - 32 edges
2. `useCryptStrategy()` - 27 edges
3. `runBankStoreRoutine()` - 17 edges
4. `getImpactSwapIns()` - 17 edges
5. `fightCaveRun()` - 17 edges
6. `calculateDamage()` - 16 edges
7. `caveLog()` - 16 edges
8. `maybeImpactSwap()` - 15 edges
9. `item_info()` - 15 edges
10. `planGraceStep()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Lantern shield's shelter as a swap-in skill (useShelter)` --references--> `useShelter()`  [EXTRACTED]
  REFERENCE.md → strategic_fn.11.js
- `Per-skill loops (runSkillLoop canUse/cast/whileMoving)` --references--> `runSkillLoop()`  [EXTRACTED]
  README.md → basic_function_loop.45.js
- `One impact swap for every class on slot leases (maybeImpactSwap)` --references--> `maybeImpactSwap()`  [EXTRACTED]
  REFERENCE.md → strategic_fn.11.js
- `Warp vest (useWarp)` --references--> `useWarp()`  [EXTRACTED]
  REFERENCE.md → merchant_gear.43.js
- `Handing a seasonal boss to leeches (getBaitedBoss)` --references--> `getBaitedBoss()`  [EXTRACTED]
  REFERENCE.md → strategic_fn.11.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Dual-environment script loading** — claude_load_code, claude_caracal_load_scripts, claude_parent_caracal_environment_switch, claude_keep_loader_branches_in_sync, claude_code_slot_loading_model [EXTRACTED 1.00]
- **Fighter targeting chain strats** — cave_fighter_strat_15, daily_event_fighter_strat_26, crypt_fighter_strat_16, spider_den_fighter_strat_58, tomb_fighter_strat_59, dark_mage_fighter_strat_61, special_mob_fighter_strat_28, farming_fighter_strat_27 [EXTRACTED 1.00]
- **Logic moved from basic_* into shared files** — readme_per_tick_gear_selection, readme_skill_loops, readme_movement_rewrite, readme_pull_strategy_monster_stacking, readme_server_hopping [EXTRACTED 1.00]
- **Impact-time weapon swaps (candy, paleclaw, piercing, leases)** — reference_candy_cane_swap, reference_rogue_cane_quickstab, reference_paleclaw_warrior, reference_piercing_swap, reference_impact_swap_leases [EXTRACTED 1.00]
- **Keyed dungeon runs (crypt, spider den, tomb, dark mage)** — reference_keyed_dungeons, reference_crypt_strategy, reference_crypt_ripening, reference_field_generator, reference_dungeon_per_file, reference_dungeon_kill_log [EXTRACTED 1.00]
- **Witch's Cipher gathering, brewing and hop flow** — reference_witch_gathering, reference_witch_brewing, reference_witch_first_stalled_board, reference_early_hop, reference_hop_rules [EXTRACTED 1.00]

## Communities (70 total, 15 thin omitted)

### Community 0 - "Merchant Bank Storage"
Cohesion: 0.06
Nodes (70): assignDrainSlots(), BAG_SUPPLY_TYPES, BAG_WORK_TYPES, BANK_FLOORS, bankLoop(), bankStoreRoutine(), buildStackDrain(), countSharedEmptySlots() (+62 more)

### Community 1 - "dungeon_fighter_strat.57.js"
Cohesion: 0.06
Nodes (70): approachDungeon(), bossAgeAt(), bossLevelAt(), burnDps(), canAbsorbInDungeon(), canFightDungeonGroup(), canHoldDungeonBosses(), canKeepAway() (+62 more)

### Community 2 - "Combat Calc & Roles"
Cohesion: 0.04
Nodes (62): adaptStrategyToParty(), assignRoles(), averageCritFactor(), avgDmgTaken(), avgPartyDmgTaken(), BOOSTERS, calculateDamage(), castMpCost() (+54 more)

### Community 3 - "Cave Run Strategy"
Cohesion: 0.07
Nodes (67): approachCave(), blinkToDarkMageRange(), buyFromCaveShop(), canResumeCaveRun(), CAVE_ITEMS_TO_SKIP, CAVE_OPTIONS_TO_REFUSE, CAVE_PARTY, CAVE_ROGUE_RESCUES (+59 more)

### Community 4 - "Events & Warrior Gear"
Cohesion: 0.07
Nodes (43): acquireEventDuty(), bossConfigs, canSnipe(), fightCurrentEvent(), getCoveringHealer(), getEventHpRatio(), getEventToJoin(), getPredictedHp() (+35 more)

### Community 5 - "Merchant Duties & Ent Lure"
Cohesion: 0.05
Nodes (46): isOwnedCharacter(), Cross-character coordination over code-messages (cm), DISMANTLE_LIST, equipBroom(), goFishing(), goMining(), isGatherPreempted(), walkAndGather() (+38 more)

### Community 6 - "Crypt Fight"
Cohesion: 0.10
Nodes (60): baitCryptSupporter(), byCryptBossOrder(), byCryptFightOrder(), canAbsorbInCrypt(), canHoldCryptBosses(), closeCryptRun(), CRYPT, CRYPT_JUNCTION (+52 more)

### Community 7 - "Daily Event Bosses"
Cohesion: 0.05
Nodes (52): ABTESTING_PATROL, ABTESTING_ROLE_WEIGHT, bossTracks, CRABXX_FETCH_MOVE_OPTIONS, EVENT_FIGHTS, fetchCrabxx(), fightAbtesting(), fightCrabxx() (+44 more)

### Community 8 - "Realm Data & Home Window"
Cohesion: 0.07
Nodes (35): fitsBeforeHomeWindow(), getEarlyHopTarget(), getFighterSnipeSighting(), getForeignEventStayMs(), getHomeRealmStatus(), getHomeSettleEvents(), getLiveWitchRounds(), getRealmData() (+27 more)

### Community 9 - "Pathing & Taut Path"
Cohesion: 0.05
Nodes (30): ALIA_FROM_POSITION, ALIA_POSITION, CRYPT_DOOR, mageBlink(), oldAdvanceSmartMove(), resetSmartMove(), Fighter exception escape scripts (jail, stuck, path_not_found), Cancellable smart-move sessions with blink/magiport (+22 more)

### Community 10 - "Mage Gear & Skills"
Cohesion: 0.08
Nodes (41): aimAt(), getEnergizeBuffee(), getMageCast(), getReflectionBuffee(), inRange(), mainLoop(), planFight(), startSkillLoops() (+33 more)

### Community 11 - "Upgrade Grace Planning"
Cohesion: 0.10
Nodes (37): bankRequests, compoundHoldSince, countPrimlings(), estimateGraceNum(), FAILSTACK_POOL, findFodderSlot(), getBaseUpgradeChance(), getClimbCost() (+29 more)

### Community 12 - "Kiting & Targeting"
Cohesion: 0.09
Nodes (35): advanceOrbitAngle(), applyMicroRotation(), arrivedDragBossIds, BOSS_DRAG_ROUTES, canStackWith(), dragToSpot(), faceTarget(), getBossDragRoute() (+27 more)

### Community 13 - "Exchange & Repo Docs"
Cohesion: 0.10
Nodes (24): Adventure Land - The Code MMORPG, adventureland_mongodb server repo, parent.caracAL.load_scripts, caracAL runner (Node/Electron headless), graphify usage rules, load_code (native in-game loader), canPullFromBank(), canSpareExchange() (+16 more)

### Community 14 - "Core Config Helpers"
Cohesion: 0.06
Nodes (19): CAVE_SIDES_TO_LEAVE, CODE_SLOTS, DEFAULT_HOME_SERVER, get_tracktrix_data(), getAlliedNames(), getCavePartyInView(), getMaxScore(), getMyCharacters() (+11 more)

### Community 15 - "Merchant Home & Stand"
Cohesion: 0.09
Nodes (30): canUseNpcsRemotely(), claimStandSpot(), distanceToSpot(), DUTY, findStandSpot(), fishingLocation, FIXED_MAIN_NPCS, getMluckTarget() (+22 more)

### Community 16 - "Upgrade & Compound"
Cohesion: 0.13
Nodes (35): activateMassProduction(), canSpareCompound(), canSpareUpgrade(), compoundInv(), countCompoundableCopies(), countKeyAtOrAbove(), ensureOffering(), ensureScroll() (+27 more)

### Community 17 - "basic_function_loop.45.js"
Cohesion: 0.09
Nodes (22): isHandsOffMob(), getKissTarget(), getLoopInterval(), hasCosmeticSkill(), INTERVAL_BREAKPOINTS, kissedAt, leadSkillTimeout(), ms_to_next_skill() (+14 more)

### Community 18 - "Live Events & Witch Gather"
Cohesion: 0.06
Nodes (43): canAnniversaryVisit(), canBrewWitchCipher(), canWitchDayBrewOn(), doorWalkRetryAt, getAnniversaryEvent(), getDoorFront(), getFighterWitchPlan(), getKnockLimitKey() (+35 more)

### Community 19 - "Trips, Info & Impact Notes"
Cohesion: 0.08
Nodes (14): abandonTrip(), advanceSmartMove(), isOnTrip(), isTripHeld(), lockInventory(), sortInv(), unlockInventory(), characterInfoCache (+6 more)

### Community 21 - "Impact Swap & Leases"
Cohesion: 0.14
Nodes (31): buildEquipPromises(), canSwapUntilImpact(), canWieldTwoHanded(), classWeaponModifier(), countWaitingGear(), damageTypeOf(), dropEquipLease(), findInvBooster() (+23 more)

### Community 22 - "Cavalry Oneeye Tagging"
Cohesion: 0.17
Nodes (27): assertCavalryAlive(), callCavalry(), canHoldCavalryMob(), cavalryCentreGap(), cavalryCooldownMs(), cavalryOneeyeLoop(), clearCavalryCallGap(), getCavalryCandidates() (+19 more)

### Community 23 - "Priest Skills"
Cohesion: 0.15
Nodes (21): ABSORB_GAMBLE_MOBS, curseMpFloor(), curseValue(), getAbsorbGambleTarget(), getAbsorbTarget(), getCurseTarget(), getHealee(), getNextAction() (+13 more)

### Community 24 - "Party Plan & Deploy"
Cohesion: 0.14
Nodes (21): deployCharacterOnce(), deployCharacters(), DYNAMIC_PARTY_PRESETS, dynamicParty(), fitPartyRoster(), followPartyPlan(), getPartyPlan(), getPresetMembers() (+13 more)

### Community 25 - "Rogue Fight Model"
Cohesion: 0.11
Nodes (15): calculateRogueItems(), calculateRogueItemsCached(), fitsRogueHand(), followUpFor(), isRogueBurnTarget(), lastRogueGear, lastRoguePicks, meetsRequirements() (+7 more)

### Community 26 - "Ranger Skills"
Cohesion: 0.19
Nodes (25): aimAt(), firePlan(), getActionPlan(), getCupidPlan(), getEmergencyHealee(), getHuntersMarkTarget(), getPotentialTargets(), getRangerCast() (+17 more)

### Community 27 - "Lucky Slot Finder"
Cohesion: 0.15
Nodes (23): exportLuckySlotTally(), findProbeItemSlot(), getLeakSafeProduction(), getLuckySlotExport(), getLuckySlotPosterior(), getLuckyUpgradeSlot(), getNextProbeSlot(), getUpgradeDurationMs() (+15 more)

### Community 28 - "Server Hop Planning"
Cohesion: 0.11
Nodes (18): Server hopping for bosses, FATIGUE_EXEMPT_BOSSES, getExemptHopTarget(), HOP_BOSSES, HOP_REGIONS, HOP_RULES, hopAlone(), hopAloneTo() (+10 more)

### Community 29 - "Grow Spawn Tracker"
Cohesion: 0.18
Nodes (20): classifyBurst(), getAccountedPermanents(), getGroupLive(), getGrowthGroupOf(), getGrowthGroups(), getSwingKills(), getWasteCause(), growthDamageRank() (+12 more)

### Community 30 - "merchant_gear.43.js"
Cohesion: 0.21
Nodes (14): calculateMerchantEquipments(), canWarpTo(), findSpareWarpVest(), getAttackWeaponReach(), getBestQuiver(), getCarriedItems(), getMaxAttackWeaponRange(), getMerchantAmulet() (+6 more)

### Community 31 - "Projectiles & Heal Targets"
Cohesion: 0.13
Nodes (11): calculateHeal(), getBaitedBoss(), getHealPower(), getNearestBaitBoss(), getPlayersToHeal(), isBossLeech(), isBossOutsider(), isHoldingBait() (+3 more)

### Community 32 - "Warrior Cleave"
Cohesion: 0.18
Nodes (21): calculateWarriorItems(), canAffordSwap(), CLEAVE_SLOTS, getCleaveWeapon(), getPaleclawTailMs(), getSafeCleaveWeapon(), getWarriorAmulet(), getWarriorChest() (+13 more)

### Community 33 - "Rogue Skills"
Cohesion: 0.21
Nodes (19): aimAt(), castFollowUp(), damageCastMpFloor(), damageCastMpReserve(), damagePerMp(), getDamageSkills(), getFollowUp(), getFollowUpAttackSkill() (+11 more)

### Community 34 - "Crafting"
Cohesion: 0.18
Nodes (17): BUYABLE, countCraftStock(), countCraftStockNeeded(), countInventoryAtLevel(), countItemsAtLevel(), countSpareAtLevel(), craft(), craftLevelTargets (+9 more)

### Community 35 - "Mitigation & Gear Scoring"
Cohesion: 0.14
Nodes (21): burnIntensityCap(), canOneShotWithWeapon(), effectiveAttackWith(), explosionScore(), fightBurnDps(), fireballDamage(), fitsSlot(), getGearCopies() (+13 more)

### Community 36 - "Respawn & Midas Loot"
Cohesion: 0.20
Nodes (16): commitHarakiri(), desiredPotions, handle_death(), isChestInMidasReach(), isMonsterTargetingUs(), lootBeforeTrip(), lootCaveChests(), MIDAS_GEAR (+8 more)

### Community 37 - "Crypt Backup Copy"
Cohesion: 0.18
Nodes (16): CRYPT_JUNCTION, CRYPT_STARTING_LOCATION, DEFEATABLE_BOSSES, getNearestJunction(), handleBossPhase(), handleClassSkills(), handleCombatReactions(), handlePriestSkills() (+8 more)

### Community 38 - "Dungeon Strat Chain"
Cohesion: 0.18
Nodes (10): Fighter targeting chain (selectFightTarget order), useDarkMageStrategy(), isDungeonBossOnUs(), planSpiderDenFight(), SPIDER_DEN, useSpiderDenStrategy(), planTombFights(), planTombTick() (+2 more)

### Community 39 - "Debug Checks"
Cohesion: 0.21
Nodes (8): checkAttacks(), checkBossDamage(), checkEnergize(), checkFrequency(), checkPiercingSwap(), checkShotGaps(), debugChecks, runDebugCheck()

### Community 40 - "Priest Gear"
Cohesion: 0.29
Nodes (12): calculatePriestItems(), getPriestAmulet(), getPriestGearPicks(), getPriestMainhand(), getPriestOffhand(), getPriestOrb(), isEnemyPlayer(), isPartyQuickKilling() (+4 more)

### Community 41 - "Temporal Surge"
Cohesion: 0.19
Nodes (13): awaitTemporalSurgeTimes(), drainPendingSurges(), dropPendingSurge(), estimateRespawnMs(), hasTemporalOrb(), isAssignedAsTanker(), isWorthSurging(), monsterRespawnMs() (+5 more)

### Community 42 - "Item Stats Projection"
Cohesion: 0.22
Nodes (13): dexFrequency(), findOwnedItems(), gearStatDelta(), getMaxBlastRadius(), getOwnedItemInfo(), getWornGear(), hasLuck(), item_info() (+5 more)

### Community 43 - "Equip Batching"
Cohesion: 0.18
Nodes (6): Per-tick gear selection from whole inventory, equipBatch(), getEquipLeases(), isSlotLeased(), leasedPenaltyMs(), scareAwayMobs()

### Community 44 - "Home Server Settling"
Cohesion: 0.22
Nodes (8): getBeanSpot(), getHomeServer(), getHomeSetRetryDelay(), isAtHomeServer(), isHomeUnset(), settleHome(), travelling(), useHomeSettingStrategy()

### Community 45 - "Special Mob Strategy"
Cohesion: 0.33
Nodes (10): CONTESTED_SPECIAL_MOB_IDS, forgetSpecialMobSighting(), getScoutReports(), getSpecialMobInVision(), getSpecialMobSighting(), isLeftToOthers(), isTakenBySomeoneElse(), reportSpecialMobInSight() (+2 more)

### Community 48 - "Ranger Gear & Cupid"
Cohesion: 0.36
Nodes (8): calculateRangerItems(), chooseBowForSplashing(), equipRangerItems(), getCupidHealees(), isNegligibleMob(), isSafeToShoot(), RANGER_INV_ITEMS, Ranger cupid party healing

### Community 49 - "Frenzy Amulet Scoring"
Cohesion: 0.25
Nodes (9): conditionFrequencyScale(), frenzyFrequency(), gearAbilityWith(), impactProcShots(), impactSwapRoom(), pickAmuletWithFrenzy(), poisonFrequencyScale(), shotCycleMs() (+1 more)

### Community 52 - "Farming Strategy"
Cohesion: 0.43
Nodes (7): getFarmSpot(), getFarmTarget(), getOwnTarget(), isFarmMob(), isPartyEngaged(), lastEngagementAt, useFarmingStrategy()

### Community 53 - "Merchant Scouting"
Cohesion: 0.48
Nodes (6): isSightedSince(), merchantScoutingLoop(), MINI_BOSSES_TO_SCOUT, SCOUT_CONFIG, scoutSweep(), updateScoutInfo()

### Community 54 - "Pull Target Ranking"
Cohesion: 0.29
Nodes (7): getHpAfterPending(), hasUntargetedMonsterAround(), haveFormidableMonsterAroundTarget(), mobsListAroundTarget(), numberOfMonsterAroundTarget(), overkillRank(), sortPullTargets()

### Community 56 - "Hop Candidate Priority"
Cohesion: 0.33
Nodes (6): byHopPriority(), getRaceCandidates(), hopPriority(), isHopCandidate(), isWorthHopping(), trackedBossTypes()

### Community 57 - "Bank Sort Utility"
Cohesion: 0.60
Nodes (4): getPacksOnThisFloor(), order, sleep(), sort_all_bank()

### Community 59 - "Store & Roaming NPCs"
Cohesion: 0.50
Nodes (5): getCurrentServer(), getRoamingNpcSpot(), noteRoamingNpcs(), readStore(), updateStoreEntry()

### Community 60 - "Manual Cave Report"
Cohesion: 0.70
Nodes (4): reportCave(), reportCaveEntities(), reportLoop(), reportMap()

### Community 72 - "basic_warrior.9.js"
Cohesion: 0.17
Nodes (11): aimAt(), getOffTankTauntTarget(), getTauntTarget(), getWarriorCast(), getWarriorHeldMobs(), IMPACT_SWAP_WEAPON_ALLOW_LIST, inRange(), mainLoop() (+3 more)

## Knowledge Gaps
- **8 isolated node(s):** `adventureland_mongodb server repo`, `graphify usage rules`, `Leader sends party invites (partyMems[0])`, `Per-skill loops (runSkillLoop canUse/cast/whileMoving)`, `Server hopping for bosses` (+3 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 366 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `The crypt run is judged, not listed (crypt_fighter_strat.16.js)` connect `dungeon_fighter_strat.57.js` to `Crypt Fight`, `Daily Event Bosses`, `basic_warrior.9.js`, `Dungeon Strat Chain`, `Kiting & Targeting`, `Trips, Info & Impact Notes`?**
  _High betweenness centrality (0.122) - this node is a cross-community bridge._
- **What connects `adventureland_mongodb server repo`, `graphify usage rules`, `Leader sends party invites (partyMems[0])` to the rest of the system?**
  _8 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Merchant Bank Storage` be split into smaller, more focused modules?**
  _Cohesion score 0.06101914962674456 - nodes in this community are weakly interconnected._
- **Why does `Native town() settles on landing (useTownWithRetry)` connect `Pathing & Taut Path` to `Merchant Home & Stand`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Should `dungeon_fighter_strat.57.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05927405927405927 - nodes in this community are weakly interconnected._
- **Should `Combat Calc & Roles` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `Cave Run Strategy` be split into smaller, more focused modules?**
  _Cohesion score 0.0733099209833187 - nodes in this community are weakly interconnected._