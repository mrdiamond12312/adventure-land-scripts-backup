# REFERENCE.md

Design notes on non-obvious behavior in this repo — the "why", not the "what" (the code already
says what). Add to this file when a piece of logic embeds a strategy/decision that isn't obvious
from reading it cold.

## Kiting strategy (`hitAndRun`, basic_function.7.js)

`hitAndRun` is the self-rescheduling movement loop every fighter runs while in combat. Baseline
behavior plus three deliberate overrides:

- **Baseline**: circle-strafe the current target at attack range, so damage keeps flowing while
  staying mobile instead of tanking hits standing still. Kicks itself out of the orbit (flips
  direction, nudges the angle) if it detects it's stuck.

- **franky / crabxx (bosses)**: the tanker abandons normal kiting and anchors the fight to one
  fixed spot on the map instead — a map corner for franky, the crabxx spawn center for crabxx.
  Trades tanker mobility for a predictable, stationary position the rest of the party can farm
  around.

- **Warrior, no threat nearby**: if nothing is currently aggroed on the warrior and no other
  players are close, it just stops and faces the target instead of needlessly orbiting — no
  point kiting when nothing is chasing you.

- **Tanker + farmed mobs (`mobsToFarm`, e.g. `ent`, `plantoid`)**: the goal is to drag the mob
  back to the default farm spot (`mapX`/`mapY`) rather than fight it wherever it spawned.
  - While the mob is still far from the spot, the tanker holds a position between the mob and
    home, but that hold distance shrinks the faster the mob is relative to the tanker
    (`speedRate` = mob speed/charge over character speed) — holding a fixed offset from
    something that outpaces you is futile, so it camps closer to home instead the more it's
    outpaced.
  - Once the *mob itself* gets close enough to the spot, the tanker switches back to plain
    orbiting — just centered on the spot instead of on the mob. Job (dragging it home) done.

The tanker is specifically the one responsible for making all of this happen, since the strategy
hinges on where the tanker chooses to stand — everyone else just kites the tanker's target
normally via `getTarget()`.

## Merchant duty lock (`onDuty`, basic_merchant.5.js and friends)

`onDuty` is a single cooperative mutex shared by every merchant routine that moves the character
(cm-request deliveries, `bankLoop`, `lureMechaGnome`, `dragEnt`, `openCryptInstance`, the inv-full
emergency banking). The rules, established after debugging ent drags getting hijacked mid-route:

- **Whoever sets `onDuty = true` must reset it in a `finally`.** A duty that throws between
  acquire and release leaks the lock: everything else blocks until the watchdog fires, or —
  worse — the watchdog frees it mid-duty and another routine smart-moves the merchant away from
  an in-progress job. Both failure modes have actually happened; this rule is why every setter
  is paired with a `finally` reset.
- **Never touch `onDuty` you didn't take.** No unconditional resets outside the owning routine
  (an old `finally { onDuty = false }` in `moveHome` released *other* routines' locks mid-duty
  and was removed). Signal through a dedicated flag instead — e.g. `invJammed`, set when an
  exchange fails with `inventory_full`, which asks the emergency banking to run without
  squatting on the duty lock.
- **The watchdog is a leak-recovery safety net, not a scheduler,** and a `finally` is not enough
  to retire it. `finally` only runs if every `await` inside settles, and several never have to:
  raw `move()` (the `smartMove` walk loop, `_blinkCheck`, `_magiportCheck`, `walkEntsToSpawn`),
  native `smart_move()` (`transport`'s walk-up-to-the-door, `useTownWithRetry`'s fallback) and
  `town()` are all runner-settled with no timeout. A `stop()`, a magiport landing or a teleport
  mid-walk can leave them pending forever, and then the holder's `finally` never runs at all —
  that is the lureMechaGnome hang below, and `walkEntsToSpawn` still has the shape (`arrived` is
  only set if every `move()` settles, and line 498 swallows the rejection).
- **The watchdog measures the *continuous* hold, and live owners renew it.** `dutyHeldSince`
  (basic_merchant.5.js) is zeroed on any tick that sees `onDuty` false, so it can only ever
  describe one unbroken hold; anything still holding after `DUTY_STALE_MS` is presumed parked and
  the lock is reclaimed. The event loop is the one owner that legitimately holds for many minutes
  — sometimes standing still, so no movement flag proves it alive — so `acquireEventDuty` calls
  `renewDuty()` on every tick it re-enters holding the duty. Nothing else renews: cm deliveries,
  bank trips, lures and drags are all bounded well under the window, and a lure that outlives it
  is exactly the hang worth reclaiming. This replaced a flag exemption list
  (`isLuringMobs`/`isDraggingMobs`), which had it backwards — it protected the two holders whose
  known hang it needed to rescue, and left the event fight, which it then unlocked mid-boss.
- **`acquireEventDuty` re-asserts `onDuty` instead of trusting `holdsEventDuty`.** The duty spans
  ticks, so a reclaim (or any future outside reset) would otherwise leave the merchant fighting
  with the lock free: `bankLoop` still holds off on `isFightingBoss`, but the cm handler, `craft`,
  `dismantleSomething` and `exchangeSomething` gate on `onDuty` alone and would start an NPC trip
  mid-fight — two `smartMove`s then preempt each other every tick (see "smartMove sessions").
- Routines that can smart-move but run outside the lock (`goFishing`, `goMining`,
  `exchangeSomething`'s bank-retrieval/npc-travel paths) must check `onDuty` before moving.
  Exchanging items already in inventory is allowed while on duty — with a computer that needs
  no movement.

Same discipline applies to `isAdvanceSmartMoving` in strategic_smart_move.21.js: every path out
of `smartMove()` after the flag is set must go through `cleanUp()` (guaranteed via
`try/finally`), because nothing watchdogs that flag — leaking it true silently freezes every
routine that guards on it.

And to `isDoingSomethingMagical` in the same file: the walk loop busy-waits on it
(`sleep/continue`), so the blink and magiport branches must reset it in a `finally` — an
unhandled rejection there (e.g. `move()` interrupted by the magiport itself landing) otherwise
parks `smartMove()` forever, which in turn holds whatever duty flags the caller took
(observed as lureMechaGnome stuck with `onDuty`/`isLuringMobs` true).

## The merchant cm handler's trust boundary (`merchant_service.19.js`)

Adventure Land's own MCP guidance is explicit that a cm is untrusted input — the sender is
whoever felt like typing our name — so each duty has to decide for itself whether a stranger may
trigger it. Two lists, checked *before* `onDuty` is taken:

- **`OPEN_DUTIES` (`buy_potions`, `buff_mluck`) — anyone.** Deliberate. Handing a passer-by a
  stack of potions or an mluck is the point; it costs us a walk and some gold we have plenty of.
  Same spirit as the fighter listener's `magiport` case, which is likewise open to anyone.
- **`OWNED_DUTIES` (`inv_full`, `elixir`, `xptome`) — `isOwnedCharacter` only.** These move *our*
  items: `inv_full` makes the merchant collect a character's whole inventory, and the two stock
  duties spend bank items and gold on a named recipient.

`isOwnedCharacter` (basic_function.7.js) tests `CODE_SLOTS`, not `partyMems`/`getMyCharacters()`
— see "Two party rosters" below, this is a third and wider question. An off-roster character of
ours filling its bags still deserves a pickup; it just has to be ours. `elixir`/`xptome` keep
their inner `partyMems` check on top, because those are roster-specific stock.

**Gating ahead of the lock is the load-bearing half.** The old handler took `onDuty` for *every*
incoming cm and only then looked at `message.msg`. Two consequences: the fighters' own `"inv_ok"`
reply (a bare string, so `message.msg` is `undefined`) grabbed and dropped the duty lock on every
inventory handover; and anyone at all could send `{msg:"inv_full", map, x, y}` and park the
merchant on a cross-map `advanceSmartMove` — holding the lock against banking, crafting and
lures for the whole trip, then `await sleep(5000)`. The watchdog would eventually reclaim it, but
only after `DUTY_STALE_MS`. Neither is reachable now that an unlisted `msg` returns before the
acquire.

The `default:` branch is kept even though the gate makes it unreachable for unknown messages: it
still fires if a duty is added to one of the lists and the `case` is forgotten.

### Duties stop at the action's reach, not at the requester's coordinates (2026-09-08)

Every duty used to `advanceSmartMove(message)` all the way to the `x`/`y` the fighter sent. A
fighter is *farming* — by the time the merchant crosses two maps it is nowhere near that spot, so
the merchant walked the final stretch to an empty patch of ground and then acted at a target that
had drifted. `moveInReachOf(name, message, range)` keeps the cm coordinates as the route but ends
it as soon as `get_entity(name)` is within reach:

- **`buff_mluck`** → `G.skills.mluck.range` (320, a flat skill range, not a weapon range).
- **`inv_full`, `buy_potions`, `elixir`, `xptome`** → `DELIVERY_RANGE` (400, what the server allows
  `send_item`/`send_gold`; `runner_functions.js` checks nothing client-side, it just emits `send`).

Both are then taken at `REQUESTEE_DRIFT_SLACK` (0.75), because the requester keeps moving during
the last seconds of our walk and stopping at the exact edge means arriving out of range.

**The hook is `stopWatcher`**, an option `smartMove` already documented and nobody passed. It has
to be that and not an external `stop()`: `smartMove`'s segment loop keeps issuing `unsafeMove` for
the remaining segments, so only the watcher branch — which also clears `isSmartMoving` — actually
ends the walk. The native `oldAdvanceSmartMove` has no watcher, so `advanceSmartMove` now runs the
predicate on a 250ms interval and calls `stop("move")` for that branch; the option name means the
same thing in both environments. `stop("move")` rejects the underlying `smart_move`, which is why
`moveInReachOf` swallows a rejection whenever we ended up in reach anyway.

`get_entity` returning nothing means the requester is off-screen or gone, so the watcher stays
false and we walk the whole route, as before. `buff_mluck` re-reads the entity after arriving for
the same reason: without it a requester who wandered off left `use_skill("mluck", undefined)` to
fall back on `get_target()`.

## Realm fatigue and home-drop hopping (`server_hop_utilities.25.js`)

**The mechanic** (`G.conditions.realmfatigue`, and the `events-and-home` guide). At your home
realm your contribution against cooperative monsters grows **5x** faster before rewards are
shared, and selected monsters carry an extra drop table. If another **non-merchant** character on
the account visited a different server in the previous 30 minutes, you get `realmfatigue` on
entry: 30 minutes (`duration: 1800000`, `persistent`), during which normal rewards continue but
the home multiplier and the home-only drops do not. **Switching again renews it.** Merchants are
ignored.

Our hop routine moves the whole squad at once, so every hop re-arms the condition for all of us —
the mechanic is aimed squarely at what `server_hop.14.js` does. Being *settled* at home is the
asset, and it costs 30 uninterrupted minutes to buy.

**Which monsters actually care** — `G.drops.monsters_home_server`, read live rather than copied,
so a patch that adds one is picked up for free. As of data version 6732 it is `crabxx`,
`icegolem`, `dragold`, `franky`, `mrpumpkin`, `mrgreen`, `phoenix`, `rharpy`. Six of those are
already hop targets; `grinch`, `pinkgoo`, `snowman` and `wabbit` have no home table, which makes
them the *cheap* ones to chase. Chasing one of the six abroad is the worst trade available: it
renews the fatigue **and** lands us where its best table cannot roll.

**Reading other realms without logging into them (`ServerRealmData`).** An unauthenticated
socket.io v4 connection to any realm is enough. On connect it answers `welcome`, whose `S` has
the same shape as `server.status`; it then pushes **`server_info`** carrying the whole `S` again
roughly every 24 seconds, for as long as the socket lives. Measured on EUPVP with a snowman up:

```
[  1.0s] welcome      S: {schedule, snowman:{live,hp,max_hp,x,y}}
[  4.0s] server_info  {schedule, snowman:{... x:1172.9, y:-804.8}}
[ 28.3s] server_info  {schedule, snowman:{... x:1028.8, y:-809.9}}
[ 52.0s] server_info  {schedule, snowman:{... x: 884.6, y:-815.1}}
```

So the sockets are **held open**, not reopened per query — `welcome` fires once per connection,
and a connect/disconnect probe would be pure churn for one stale snapshot. `_absorb` replaces a
realm's cached `S` wholesale on every pulse, because that is what the pulse carries.
`get_servers()` supplies `address`/`path`. `query({types, avoidServers, requireTarget,
maxHpFraction})` returns live special monsters across every realm still inside `REALM_STALE_MS`,
each row carrying its realm alongside the status fields.

**Our own realm is fed *into* the distributor, not spliced in beside it.** `_syncLocalRealm`
absorbs `server.status` under the current realm's key at the top of `query()` and `status()`. We
are connected to that realm, so the live global beats its own socket copy, which can be a pulse
old — but the fix belongs in the one object that owns realm state, not in each caller. That makes
`query()` uniformly correct for all eight realms and collapses three call sites: the hop loop is
now a bare `query().filter().sort()`, `getHomeRealmStatus` lost its `isAtHomeServer()` special
case, and `collectSightings()` disappeared entirely. It also means a missing `parent.io` degrades
gracefully — the local realm still populates from `server.status`, so the at-home policies keep
working even with no sockets at all.

**This replaced aldata as the hop candidate source.** `server_hop.14.js` no longer fetches
`aldata.earthiverse.ca` every 10s. Two workarounds died with the fetch — `estimatedRespawn`/`id` presence checks, since
`query` only ever returns `live` entries, and the `FLICKERING_BOSSES` patch for grinch and
pinkgoo, which existed because the API was flaky about them. Reading each realm's own
`server_info` has no such gap. The only remaining earthiverse call is the bank-data *push* in
merchant_bank.17.js, which is unrelated.

Sockets cost eight per holder and every CODE frame is separate, so `shouldOwnRealmSockets` keeps
them on **the first character `caracALconfig` enables** — deliberately the same set
basic_function.7.js loads this file for, so the owner always exists and always runs the hop loop.
Keying it off `partyMems[0]` would have been wrong: that character need not be an enabled hopper,
and with aldata gone a hopper without realm data cannot hop at all. Non-owners get `undefined`
from `getRealmData()` and skip the decision entirely rather than hopping home spuriously —
which is consistent with `hopToServer`, since under caracAL it shuts down every sibling and
redeploys the group, so only one character was ever really driving. Under native CODE each
character owns its own sockets.

**Predicting the next window.** `server.status.schedule` is `{time_offset, dailies, nightlies,
night}`; `dailies`/`nightlies` are hours on that realm's own clock, which is UTC shifted by
`time_offset`. The offset is **per region** — measured EU `+1`, US `-5`, ASIA `+7`, with
`dailies: [13, 20]` and `nightlies: [23]` everywhere — which is exactly why the home realm has to
be watched rather than reading the schedule off whatever realm we happen to be standing on.
`msUntilNextScheduledEvent` works in the shifted frame and checks today and tomorrow, so it never
returns a past boundary.

The schedule says *when*, not *which*: `G.events` marks `crabxx` daily and `franky`/`icegolem`
nightly, and all three carry home tables, so a window is worth being home for. `dragold`,
`mrpumpkin` and `mrgreen` are seasonal and absent from `G.events` — they are caught by the live
`S` scan instead, not the clock.

**The two policies**, both behind `FATIGUE_AWARE_HOPPING`:

- `shouldHoldAtHome()` — refuse to leave home when a home-table boss is live or `spawn`-scheduled
  here, or when the next window is within `HOME_HOLD_LEAD_MS`.
- `shouldReturnHomeToSettle()` — while away, go home once the next home window is within
  `HOME_RETURN_LEAD_MS` (fatigue + 2 min slack). It deliberately does **nothing** below
  `REALM_FATIGUE_MS`: under 30 minutes it is already too late to settle, so burning the trip buys
  a fatigued arrival and we may as well keep racing.
**Guard order in the hop tick is load-bearing.** `shouldReturnHomeToSettle` runs *before*
`hasSoftenedBossHere`/`hasEventWorthStayingFor`, and getting this backwards silently defeats the
whole feature: the settle band is only `HOME_SETTLE_MARGIN_MS` wide and it expires, so a boss
softened on the realm we happen to be standing on would hold us there through the entire window
and we would arrive home fatigued with nothing to show. A foreign boss pays no home drops; the
scheduled home one does. Only an open `cryptInstance` outranks the settle hop — that is paid-for
content we would forfeit. The at-home path is unaffected either way, since
`shouldReturnHomeToSettle` returns false the moment `isAtHomeServer()` is true.

- `homeDropRank()` reweights the candidate sort. A home-table boss on our own realm jumps ahead of
  the HP race entirely; a home-table boss abroad drops to last **after** HP, replacing the old
  plain home tie-break which only ever broke exact HP ties.

**Where home actually is.** `HOME_SERVER` lives in slot 25 with `getCurrentServer`/`getHomeServer`/
`isAtHomeServer`, moved out of slot 14 so the dependency runs one way (14 consults 25, 25 loads
first). It is a hand-maintained mirror of what Bean was told — **CODE cannot read the real home
realm**; there is no `character.home`, nothing in `runner_functions.js`, and `set_home()` returns
nothing useful. Every policy here is only as correct as that constant, so it is the first thing to
check if the guards misfire.

## TODO: the merchant tick wants to be per-concern loops (`basic_merchant.5.js`)

Not done — recorded so the next person doesn't have to rediscover the shape.

The 750ms `setInterval` in basic_merchant.5.js has no overlap lock, and its body awaits
`withTimeout(Promise.allSettled([...twenty crafts, compound, upgrade, exchange, dismantle,
sells...]), 300000)`. Two problems, the same two that `runSkillLoop` was built to solve for the
fighters (see "Splitting a class into attack loop + per-skill loops"):

- **Everything runs at the pace of the slowest member.** One craft that has to walk to the
  craftsman holds the entire `allSettled`, so compounding, selling and equip all wait on it —
  exactly the `fight()` bundling problem, one layer up.
- **A slow pass overlaps itself.** At 750ms against a ceiling of five minutes, hundreds of
  invocations can be in flight at once. Most sub-routines bail early on their own guards
  (`onDuty`, `character.q.*`, `isSortingInventory`, `pendingItemMutations`), which is why this has
  been survivable rather than catastrophic, but those guards are each protecting one routine — no
  one is bounding the total.

**The shape to move to**, mirroring `runSkillLoop`: one self-rescheduling loop per concern, each
with its own cadence and its own lock released in a `finally` —

- `craftLoop` — the craft table, slow cadence (they mostly no-op on ingredients anyway).
- `improveLoop` — `compoundInv` + `upgradeInv`, which already hold `pendingItemMutations`.
- `disposalLoop` — `sell`, `dismantleSomething`, `exchangeSomething`, `holidayExchange`.
- `upkeepLoop` — stand open/close, `equipBatch`, `sortInv`, potion top-up, `scareAwayMobs`.
- Leave the gathering/`moveHome`/emergency-banking tail where it is; it is already sequential and
  duty-aware.

The generic driver already exists and is class-agnostic — `runSkillLoop` with a made-up `skill`
name and a `floorMs` is exactly the "fixed-interval, awaited, non-overlapping" primitive these
need (that is how the fighters' `"gear"` and `"strategy"` loops work). Reuse it rather than
writing a fifth bespoke `setInterval`.

## smartMove sessions and magiport (`strategic_smart_move.21.js`)

Findings from the "bots ask for magiport though the mage isn't near the destination" debugging
session (2026-07-19):

- **The magiport eligibility check must compare maps explicitly** (`mageInfo.map ===
  toPosition.map`), not lean on `distance()` cross-map behavior alone — `mageLocation`
  (localStorage, written by basic_mage.4.js) is a plain snapshot, and if `map` is ever missing
  from either side, `distance()` silently degrades to raw coordinate math, matching a mage on a
  completely different map whose x/y happen to line up. advance_smart_move.20.js always had this
  guard; the strategic rewrite lost it. Known remaining hole: crypt *instances* share
  `map: "crypt"`, and `mageLocation` doesn't record `in`, so cross-instance false positives are
  still possible around crypts.
- **`cleanUp(session)` is session-guarded** for every teardown that a *finished* session runs
  (`finally` blocks, magiport landing) — an old session's deferred `finally` used to clear the
  timers of the newer smartMove that had already taken over, flip `isSmartMoving` off, and
  `stop()` its movement. Only the "a new smartMove is starting" call at the top of `smartMove()`
  cleans unconditionally.
- **Magiport is verified, not fire-and-forget**: after `send_cm(MAGE, "magiport")` + 1.5s, the
  session only ends if the character actually arrived (same map, within 300 of destination);
  otherwise the walk continues and `_magiportCheck` keeps retrying — a lost cm / busy mage used
  to strand the character mid-route with the whole session torn down.
- The main walk loop's per-segment errors are deliberately caught-and-abort, **not** re-pathed:
  after magiport/transport/door the server can lag and the transport promise may never resolve,
  so "re-path from current position on mismatch" was considered and rejected (the commented-out
  map assertion in the walk loop is a leftover of that).

## Gnome luring: why the merchant must not scare (`lureMechaGnome`, merchant_luring.24.js)

`isLuringMobs` exists to suppress `scareAwayMobs()` — scare is the one skill that undoes a lure,
and the merchant is always *able* to scare: `calculateMerchantEquipments` keeps jacko on the orb
except while the luck set is up, and `scareAwayMobs` re-equips it itself anyway. There are two independent scare sources, and
the flag only covers one of them:

- The merchant's own 750ms loop, gated by `if (!isLuringMobs) scareAwayMobs()`. `isDraggingMobs`
  needs no separate gate because `dragEnt` sets both flags.
- `smartMove`'s internal 1s scare interval, which is **opt-out per call** (`useScare` defaults to
  `true`) and lives from before the walk starts until `cleanUp()` at the end of the move. The flag
  is invisible to it, so every leg walked while luring must opt out by hand.

  **The pre-magiport scare (debugged 2026-08-02).** Symptom: the gnomes are shed seconds before
  the magiport lands. `{ map: "cyberland" }` with no x/y resolves to `G.maps.cyberland.spawns[0]`,
  so "travel to cyberland" ends with an in-map walk *among the gnomes* — and that leg was still
  on the default `useScare: true`, so the first gnome to aggro was scared off ~1s later, while the
  merchant was still waiting on the mage. It now passes `useScare: false`, which also matches what
  the flag already means for the rest of the lure: the 750ms loop's scare is suppressed for the
  whole duration, so the trip was never scare-protected by anything else anyway.
  `dragEnt`'s `advanceSmartMove("ent")` still runs on the default — harmless there, since the drag
  picks and aggroes its ent *after* that walk finishes, but it is the same untouched hole.

**The magiport-landing race (debugged 2026-07-25).** Symptom: the merchant aggroes the pack, gets
magiported home, and immediately scares it off. Cause was neither `useScare` nor a leaked
`onDuty`, but the handoff wait ending instantly. A magiport landing arrives *before* the local
entity list repopulates, so `get_player(partner)` briefly sees nobody; the handoff predicate
treats "no partner nearby" as "nothing to hand off to, done", and `waitUntil` evaluates its
predicate once *before* its first `sleep` — so it resolved on tick 0, `finally` cleared
`isLuringMobs`, and the very next 750ms tick scared the gnomes that were still targeting the
merchant. Fixed by waiting (≤3s) for a partner to actually appear before the handoff check runs.
General rule: any `waitUntil` predicate with an "abort because the world looks empty" escape is
unsafe immediately after a map change or magiport — give the entity list time to settle first.

Residual, deliberate: if the 10s handoff wait times out with gnomes still on the merchant, the
lure gives up, `isLuringMobs` drops, and the merchant scares them off rather than tanking them
indefinitely.

## Ent luring (`dragEnt`, merchant_luring.24.js)

Self-rescheduling loop on the merchant, same shape as `lureMechaGnome`. Goes and aggroes a wild
`ent` with a dartgun (long range, low commitment), then walks it home along a fixed waypoint path
so the tanker can pick it up at the farm spot (see above) instead of the whole party having to
travel out to it. A run can bring back up to `MAX_CONCURRENT_ENT` of them (see below).

Guards before/during a run:
- Only runs at all while farming `desertland` (`map === ENT_LURE_MAP`).
- Skips if already busy (`onDuty`/`isLuringMobs`/smart-moving/chilling), a live server event is
  running, or the field report says the party already has `getMaxEntAtSpawn()` ents engaged at
  spawn (`hasMaxEntsEngagedAtSpawn`, see "Field reports must fail closed") — avoids double-luring.
- Requires the party's own `PRIEST` to be an online sibling (`isPriestOnline()`), checked both
  before starting and repeatedly mid-lure — if `dynamicParty()` swaps PRIEST out for ROGUE while
  an ent is being dragged, the lure aborts cleanly rather than bringing home an unhealed tank.
  `isMyPriestOnline()` branches on environment: `parent.caracAL.siblings` under the runner,
  `get_active_characters()[PRIEST]` in-browser (both only see characters under the *same*
  controller — a priest logged in elsewhere reads as offline, deliberately). The in-browser
  branch exists because `parent.caracAL.siblings` is a guaranteed TypeError there, which used
  to kill the loop (see below).

### Which ent to grab (`getFurthestEntFromFirstAnchor`)

The run used to take `get_nearest_monster({ type: "ent" })`, which grabs whichever ent happens to
be closest on arrival — usually one sitting right on `ENT_FIRST_ANCHOR`, the first waypoint. Walking
that one home means the rest of the path back out of the spawn passes *through* the ents we didn't
take, collecting them accidentally. Picking the ent **furthest** from `ENT_FIRST_ANCHOR` means the
walk back moves away from the remaining pack instead of into it. Ents already aggroed on someone
else are skipped so we don't steal another player's mob.

### Dragging more than one (`walkEntsToSpawn`, `MAX_CONCURRENT_ENT`)

The walk tracks an array of ids rather than a single one — a full round trip is expensive, so the
merchant tops the train up to `MAX_CONCURRENT_ENT` (2) opportunistically while walking rather than
making a second trip. Per tick, with one attack available:

- **Re-aggroing a slipped ent always wins over picking up a new one.** Losing the ent already half
  way home is strictly worse than not adding a second.
- A pickup candidate must be untargeted, inside the same aggro band as the re-aggro check
  (`isInEntAggroBand`), *and* within `ENT_PICKUP_TOLERANCE` of the mean distance from us to the
  ents already being dragged. The average is what keeps the train together: scare is an area
  effect on a ~5s cooldown, so a *level* pack closes in at once and a single cast covers all of
  it, while a strung-out one trips the scare on the leading ent and lets the trailing one arrive
  into a cooldown and hit for free.
  **Currently set to 999, i.e. deliberately disabled** — the loose version is being trialled
  (2026-07-29). The guard was kept and the constant widened precisely so the fix is one number:
  drop it back to ~10 if the merchant starts eating hits mid-drag.
- The cap counts *live* tracked ents, not ids ever added, so a despawn mid-drag frees a slot.
- Scare fires if **any** tracked ent is inside the buffer; the handoff check requires **every**
  tracked ent to have a target that isn't us before the run resolves.
- **Handoff is checked every tick, not only on arrival** (2026-08-06). It used to sit inside the
  `arrived` branch, so once the fighters took the aggro near the farm spot the merchant still
  walked out the remaining waypoints for no reason. Once nobody's ent is ours the drag is over
  wherever we happen to be standing — the only thing arrival still gates is the 10s grace period
  for holding aggro when *nobody* has picked the train up yet. The `finally` also `stop("move")`s,
  because `aborted` is only read between legs and would otherwise let the current leg finish.

`positionAtEntAimPoint`/`aggroEnt` still operate on the seed ent only — the extra ents are picked
up during the walk, not at the aim point.

### Both ent caps are a question, not a constant (`getMaxEntAtSpawn`/`getMaxConcurrentEnt`)

`MAX_ENT` (3) and `MAX_CONCURRENT_ENT` (2) are what the party can hold *with an outsider tank* —
one of `trustedPartners` sharing the field. On our own, the same numbers are what gets the party
killed, so both collapse to `SOLO_MAX_ENT` (1): one ent at spawn, one ent per run.

The signal is **a partner standing with the field observer**, not a name in the party list. Being
partied with someone farming elsewhere tanks nothing for us, so `publishEntFieldReport` — already
the only script that has eyes on the farm spot — also reports `trustedPartnerNearby` (a live,
non-rip partner within `ENT_FIELD_PARTNER_RANGE` of the reporter), and the merchant reads it off
the same report it already reads the ent count from. That also means the caps inherit the report's
fail-closed rule: a stale report reads as *no partner*, i.e. the solo caps, matching
`hasMaxEntsEngagedAtSpawn`'s "assume the field is full rather than lure blind".

Both are asked per tick rather than resolved once per run, so a partner logging off mid-drag stops
the train from being topped up. It cannot *shrink* a train already aggroed — there is no way to
drop an ent but scare, which the walk is already doing for damage.

`trustedPartners` moved to the config block in basic_function.7.js when the fighters started
needing it for the report. It must live in exactly one file: slot 7 and slot 24 are evaluated into
the same global scope on the merchant, so a second `const` of that name is a redeclaration error
that takes the whole merchant down.

## Self-rescheduling loop discipline (`dragEnt`/`lureMechaGnome`, merchant_luring.24.js)

These loops keep themselves alive via `setTimeout(self, delay)`. Debugging "dragEnt stopped but
lureMechaGnome kept going" (2026-07-17) established the failure taxonomy:

- **Any throw on a code path that doesn't reach the reschedule kills the loop permanently and
  silently** (async function → unhandled rejection, no crash, no retry). The original layout had
  the guard *outside* the `try`, so a throw while merely *evaluating* the guard (e.g. the old
  unguarded `parent.caracAL.siblings` in-browser, or a corrupt `get("mageLocation")`) was fatal.
  The guard now lives inside the `try` so `finally` always reschedules. Diagnosis shortcut: if
  the loop is dead but flags read `false`, it died on an unprotected path; if flags read `true`,
  it's hung inside an iteration on a never-settling await.
- **The reschedule must be the last statement of `finally`** — anything before it that can throw
  (the `set("luringMobType", undefined)` call is the suspect) kills the loop *after* clearing the
  flags, producing exactly the "sibling loop healthy, this loop dead" symptom.
- **Load-order race (caracAL only)**: gone as of 2026-08-02, `load_scripts` is synchronous — see
  "Script loading is synchronous in both environments" below. It is worth knowing this failure
  mode existed: a loop that never started looks exactly like a loop whose reschedule died.
- **KNOWN ISSUE (open as of 2026-07-17)**: moving the guard inside `try` means a guard-*blocked*
  tick now also runs `finally`, which unconditionally clears `onDuty`/`isLuringMobs`/
  `isDraggingMobs` and `luringMobType` — flags that tick never acquired and that the cm duty
  handler or the sibling lure may own at that moment (violates the "never touch `onDuty` you
  didn't take" rule above). Fix: track an `acquiredLocks` boolean set after passing the guard and
  only clear the flags in `finally` when it's set (the reschedule itself stays unconditional).
  `dragEnt` has the guard-inside-try change; `lureMechaGnome` still has its guard outside the
  `try` and needs the same treatment, with the same lock-ownership care.

### Death mid-lure used to freeze `dragEnt` permanently (fixed 2026-08-06)

`walkEntsToSpawn` always checked `character.rip`, but the two phases before it did not, and a
corpse can never satisfy either loop's exit condition: `positionAtEntAimPoint` loops until the
character reaches its stand point (a corpse never moves) and `aggroEnt` loops until an ent targets
us (a corpse can't attack). Since neither phase reached `dragEnt`'s `finally`, the loop never
rescheduled *and* kept `onDuty`/`isLuringMobs`/`isDraggingMobs`/`luringMobType` held — only
`onDuty` is ever recovered, by the 5-minute duty watchdog in `basic_merchant.5.js`.

The abort condition is **death or priest offline only — deliberately no time deadline**, a real
lure can legitimately run ten minutes. `assertEntLureAlive()` is polled by every ent-lure loop
(including `walkEntsToSpawn`'s `step`, replacing its silent `rip` resolve, so death is logged
rather than looking like a completed run).

Polling alone isn't enough, because a guard only runs if the loop's awaits settle:

- `untilDoneOrDead` wraps every await that can outlive a death: the in-loop `move`/`smart_move`
  calls and the cross-map `advanceSmartMove("ent")`. None of them check `rip` internally, and a
  move issued while dead can stay pending forever, which would stop the guard from ever being
  reached again. It races the call against a `character.rip` poll, tracks completion so the poll
  timer stops instead of recursing for the life of the session, and keeps a no-op `catch` on the
  tracked promise so a rejection arriving after the race was abandoned isn't an unhandled one.
- **No timeout on those moves.** A first attempt bounded them at 2s; a single leg with two ents
  chasing legitimately takes anywhere from seconds to minutes, and the timeout just made the loop
  reissue `move()` on top of itself. Death is the abort condition, not elapsed time.
- `walkEntsToSpawn`'s `step()` body is wrapped in `try/catch` → `reject`, because it schedules its
  next tick as its last line: any unexpected throw above that left the wrapping promise unsettled
  (hang + leaked locks).

Still open: a failed waypoint `move()` in `walkPromise` silently strands the step loop holding
aggro — it now ends when the merchant dies or the priest drops, but not on a stuck walk.

## Equip batching vs `penalty_cd` (`equipBatch`, strategic_fn.11.js)

Every equip/`shift` command adds `EQUIP_PENALTY_MS` (120ms) of server-side `penalty_cd`, which
also delays the next attack. `equipBatch` therefore slices the suggested-items batch to whatever
fits in the time left before the next attack, minus:

- the `penalty_cd` already running,
- one extra `EQUIP_PENALTY_MS` when a booster `shift` was dispatched this call (`shift` is
  penalized like an equip; `unequip` is *not*, so the doublehand offhand-unequip is deliberately
  not counted),
- `ping / 2` — the penalty clock starts when the *server* receives the command, so the one-way
  trip is dead time the local calculation would otherwise miss. Capped at 100ms so a laggy
  connection still gets to equip at least something instead of starving forever.

Sliced-off items aren't lost — the next `equipBatch` tick picks them up.

`midasLooting`'s own `penalty_cd` bail is scoped to `MIDAS_CHARACTER` for the same reason in
reverse: only its first branch spends penalty, by swapping into the midas set. The other two
branches just call `open_chest`/`loot()`, which cost nothing. Unscoped, the guard starved the
merchant specifically — his gear table flips on `shouldHoldAttackWeapon()`, so killing the mob
that dropped the chest is itself what re-equips the broom, and the resulting ~240-480ms of
penalty covers exactly the window where the chest exists.

Booster handling: a caller-suggested booster wins outright; the luck/xp auto-swap only runs when
no booster was suggested (previously a suggested-but-already-equipped booster fell through and
got swapped away). `suggestedItems.booster` is always deleted afterward because "booster" is not
a real equipment slot — leaking it into the slot loop would try to `equip()` it.

Options (second arg, replacing the old `forced` boolean): `preventPenaltizeNextAttack` (default
true) is the old force switch — false skips the `penalty_cd`/`cc`/`isLooting` bail, the batch
slicing and the booster-shift budget check. `preventKeySnatch` (default true) false ignores the
`isEquipingItems` latch. `penaltyModifier` rewrites the assumed `penalty_cd` before budgeting,
for equips already dispatched but not yet reflected in `character.s` (e.g. `(x) => x + 120` when
firing right after a stomp/cleave swap). `fallback` maps a slot to an inventory slot number to
use when `findMaxLevelItem` comes up empty. Old `equipBatch(x, true)` call sites are now
`equipBatch(x, { preventPenaltizeNextAttack: false, preventKeySnatch: false })`.

## Restoring gear before the swap resolves (`warriorCleave` / `warriorStomp`)

Cleave and stomp only need their swap weapon equipped *server-side when the skill runs*, and
cleave procs sugarcane off whatever is on at that moment — the same trick the candy-cane swap
uses. So the restore `equipBatch` is fired synchronously right after `use_skill`, in the same
promise array, instead of waiting for the skill (or even the swap) to resolve.

That means `character.slots`/`character.items` still describe the *pre-swap* gear when the
restore is built, which is what the `fallback`/`penaltyModifier` options exist for
(`buildWarriorRestoreFallback`):

- the displaced mainhand will land in the inventory slot the swap weapon came from
  (`cleaveWeapon.num` / `findMaxLevelItem("basher")`), so that's `fallback.mainhand` whenever the
  restore wants the weapon that's still showing as equipped;
- `unequip("offhand")` drops the offhand into the first empty `character.items` slot, so that's
  `fallback.offhand`;
- `penaltyModifier` adds `EQUIP_PENALTY_MS` per equip the swap already dispatched, since the
  server-side `penalty_cd` from them hasn't been echoed back yet. `preventPenaltizeNextAttack`
  stays on, so if that predicted penalty leaves no budget the restore is simply skipped and the
  existing `setTimeout(currentStrategy, penalty_cd)` backstop picks it up.

Only `preventKeySnatch` is turned off — the restore runs inside the swap's own
`isEquipingItems` window on purpose.

Flag ownership: `isEquipingItems` follows the same "never release a lock you didn't take" rule
as the merchant's `onDuty` — `warriorStomp` used to clear it unconditionally despite never
setting it (it only calls `equipBatch` with the force options, which manages the flag itself), which could
unlock a concurrent `equipBatch` mid-flight; `warriorCleave` only clears it when its aggro
branch actually claimed it. `equipBatch` itself follows the rule too: it records whether the
latch was free on entry and only clears it in that case, so a `preventKeySnatch: false` call
nested inside someone else's swap can't unlock it early.

## Attack cooldown reduction after `attack()` (`reduceCd`, basic_warrior.9.js)

Findings from the "warrior attacks slower than his frequency" session (2026-07-24):

- **`next_skill.attack` is set ~1 ping *after* the `attack()` call, not synchronously.**
  `attack()` only `socket.emit("attack")`; the server replies with a `skill_timeout` event and
  the client sets `next_skill.attack = now + ms` (or `1000/frequency` if the server omits `ms`)
  in that handler. So the `.then()` on the attack promise fires right as the fresh cooldown lands
  — which is the correct place to `reduce_cooldown`, and why a probe reads `ms_to_next("attack")`
  ≈ `cycle − reduction` immediately after.
- **Reduce by ~full RTT (`character.ping * 0.95`), not `ping/2` and not `Math.min(...parent.pings)`.**
  `character.ping` is the full round trip. The two one-way `ping/2` legs cancel (you lose `ping/2`
  waiting for `skill_timeout`, but gain `ping/2` because your next attack packet reaches the
  server that much before the client-side timer says it can) → net acceptable re-fire is at
  `t0 + cooldown`, i.e. a full-ping-early send. `Math.min(...parent.pings)` (your *best-ever* ping)
  under-compensates: whenever live ping rises above that floor the packet lands late. So the attack
  `.then` uses `reduceCd("attack", false)` (the `character.ping * 0.95` branch, same "full
  reduction" warcry/taunt use). Trade-off: over-reducing risks a `"cooldown"` rejection handled in
  `attackErrorHandler`; there was headroom because no such rejections were occurring.

- **Anything sharing the attack cooldown must reduce the `"attack"` key, not its own name.** The
  priest's heal `.then` used `reduceCd("heal")`, which writes to `parent.next_skill.heal` — a timer
  the server never sets (heal's `skill_timeout` is registered under `attack`, see "heal *shares* the
  attack cooldown" below) and that `ms_to_next_skill` reports as 0 for. So the shave landed nowhere
  and every heal cycle ran a full ping longer than every attack cycle — the priest looked like he
  hesitated before healing while his attacks kept pace. Now `reduceCd("attack", false)`, matching
  every other class's shared-cooldown action.

- **The candy swap re-bases the attack cooldown server-side and WIPES the client-side reduction —
  so the ping shave has to be re-applied in the swap-back, not (only) the attack `.then`.** Server
  mechanic (from the server source): every equip runs `calculate_player_stats`, and when
  `attack_ms` changes it emits `skill_timeout {name:"attack", ms: new_attack_ms − mssince(last.attack),
  reason:"attack_ms"}`. So the cooldown is *not* frozen at attack time — it floats with the weapon
  you currently hold, always measured from your last attack. Damage, by contrast, is locked to the
  weapon equipped when the attack is processed (that's what makes "hit big, swap" work). For the
  candy-swap warrior this means: attack fires (fireblade CD) → `.then` shaves ping → ~150ms later
  the swap-back to fireblade emits an `attack_ms` correction that resets `next_skill.attack` to the
  full `fireblade_ms − elapsed`, silently reverting the ping shave → `dt`-between-attacks ends up at
  the *full* cycle (measured: `dt≈692` vs `expected=686`, not `expected − ping ≈ 603`). Fix:
  `reduceCd("attack", false)` is re-applied in `maybeCandySwap`'s `swapBackAfterHit`, chained
  *after* the re-equip resolves (i.e. after the server's authoritative correction lands). This also
  makes `attackSpeedCompensate` redundant for the candy case — the server already re-bases on the
  swap itself, and the client compensate is overwritten (it read `refunded=false` every tick).

## `strategic_fn.11.js` math conventions

- `calculateDamage()` already multiplies by `fromEntity.frequency` — it returns DPS, not
  per-hit damage. Don't multiply by frequency again at call sites (an old cleave path
  double-counted it). Per-hit damage = pass `{ ...entity, frequency: 1 }` (see
  `ProjectileManagement._calculateSingleHitDamage`).
- Healer sustain is always compared in per-second units via `healerHps()`
  (`heal || attack * 0.5`, times frequency); mob pressure via `totalMobDps()` (sum of
  `calculateDamage` times the ≥3-mob `mobbingMultiplier`). Cleave's safety check previously
  compared per-hit heal against DPS, making it far more conservative than intended.
- `item_info()` (basic_function.7.js) returns a *fresh* object per call (spread of `G.items`
  data + computed properties, including `.id`) — safe to annotate, but nothing memoizes across
  calls, so derived fields like `explosion_delta` must be computed where the object is built
  (see `resolveBowInfo`).
- `BLAST_RADIUS` is computed once at load on purpose: it's the *max* blast the character could
  field from anything in slots/inventory, not the currently-equipped blast.

## Splitting a class into attack loop + per-skill loops (`runSkillLoop`)

**The problem.** The original per-class `fight()` bundled the attack *and* every skill into one
`promisesToAwait` array and did `await Promise.allSettled(promisesToAwait)`. The main loop's
`setTimeout(mainLoop, getLoopInterval())` sits in a `finally`, so it can't reschedule until that
`await` resolves — i.e. until the **slowest** promise settles. `getLoopInterval()` *wants* to
re-fire the attack the instant `ms_to_next_skill("attack")` elapses, but a single skill whose
server round-trip exceeds the attack cooldown holds the whole loop and the attack lands late. Done
per class (mage, priest, warrior so far; archer/ranger/rogue still to do).

**The fix — one loop per skill, keyed on that skill's own cooldown.** `runSkillLoop({ skill,
canUse, cast, floorMs, timeoutMs })` (basic_function.7.js) drives a single skill, independent of
the attack loop and of every other skill:
- Reschedules on `Math.max(ms_to_next_skill(skill), floorMs)` — wakes exactly when the skill is
  ready again. `floorMs` guards two cases: (a) the skill is off-cooldown but `canUse` is false
  (no valid target) → `ms_to_next_skill` returns 0 → without a floor it busy-loops at 0 ms;
  (b) a **non-cooldown** action like gear — pass a made-up `skill` name (`"gear"`), for which
  `ms_to_next_skill` returns 0, so `floorMs` alone sets the cadence.
- `cast()` is **awaited** before rescheduling. This is load-bearing: `use_skill`/`attack`/
  `equipBatch` only set `next_skill`/cooldown once they resolve, so awaiting is what makes the
  `finally` read a real `> 0` cooldown. Skip the await and it re-fires the skill while the first
  cast is still in flight = double-cast. `cast` must **return a Promise** (implicit-return arrow
  forwarding `use_skill(...).then().catch()`); the arrow itself need not be `async`.

**What stays in `fight()` vs. moves to its own loop:**
- Stays: the `attack()` itself, plus anything that must be *timed with the shot* or *shares the
  attack cooldown*. E.g. mage self-energize (feeds the next shot) is pushed onto the attack's
  `promisesToAwait` and awaited together — safe because it's one same-ping cast, so it resolves
  ~when the attack does and barely moves the reschedule.
- Moves out: every skill with an **independent** cooldown (mage energize-ally/reflection; priest
  curse/darkblessing/partyheal/absorb/zapperzap), and **gear** (fixed-interval `"gear"` loop).

**`currentStrategy` extraction — skills yes, gear no (revised).** The first pass moved the whole
`case "<ctype>":` branch (gear *and* skills) out of `pull_strategy.13.js` /
`normal_strategy.12.js` into the class's own loops. That was wrong for **gear**: which gear you
wear is farming *policy*, and policy belongs with the strategy that selects it, so a pull strategy
and a normal strategy can dress the same class differently. Gear was moved back for every class;
what leaves the strategy files is only the **skills**. Every class now runs the warrior's shape:

```js
runSkillLoop({ skill: "strategy", floorMs: 100, canUse: () => true,
               cast: () => currentStrategy(get_target()) });
```

Leave a NOTE breadcrumb in both strategy files listing which skills left, so the `case` reads as
deliberate rather than half-migrated.

This works because `calculateMageItems` / `calculatePriestItems` **ignore their `target` argument**
and re-derive from `get_target()` internally — so a fixed-cadence loop passing a single target
loses nothing. `calculateRangerItems` does *not*: it reads the whole shot list (`cluster_count`,
`cooperative`) to choose poucher vs. firebow, which is why the ranger needed the plan object below
rather than a bare `get_target()`.

**Wiring.** Define `startSkillLoops()` (kicks off one `runSkillLoop` per skill) and call it
alongside `mainLoop()` in *both* the `parent.caracAL` `.then()` and the native
`if (!parent.caracAL)` branch. Extracted `canUse`/`cast` conditions must be verbatim copies of the
old inline guards — the reschedule keying replaces the old `is_on_cooldown`/`ms_to_next_skill===0`
checks, so those can drop, but nothing else should change.

### Healing classes (priest): heal *shares* the attack cooldown

`use_skill("heal")` consumes the same cooldown as `attack()`, so heal and attack are mutually
exclusive — one or the other per tick — and **heal cannot go on its own `runSkillLoop`** (two
loops keyed on the same cooldown would steal it from each other). Heal stays in `fight()`, which
becomes an explicit *decide-then-act*:

1. Pick the mob attack target (taunt/poison) as before.
2. `healee` = first buffee within heal range; `actionTarget = healee ?? mobTarget`.
3. `change_target(actionTarget)` **unconditionally** (even on cooldown) — this is the signal the
   gear loop reads.
4. When `isAttackReady`: `healee ? heal(healee) : attack(mobTarget)`.
5. If no in-range healee, move toward the nearest prioritized buffee (movement doesn't spend the
   cooldown, so an in-range mob still gets attacked in step 4).

**Gear follows `get_target()`, not a parallel healee computation.** Because `fight()` points the
target at the healee (a *player*) when healing, the gear loop just does
`calculatePriestItems(get_target())`; `isPriestInHealGraceWindow` sees a non-monster and swaps to
healing gear (`lmace`/`jacko`), else attack gear. This keeps "who I heal" and "what gear I wear"
from ever disagreeing. Consequence: gear now tracks *in-range* heal intent, not "any wounded ally"
— approaching an out-of-range buffee shows mob gear until you're actually in heal range (the
heal-grace window smooths the ~one-tick swap lag).

`fight()` must also run **every** main-loop tick (not only when a mob target exists) and **before**
the smart-move guard, so the priest keeps healing with no mob in reach and while smart-moving to
the farm spot — target selection, attack, and farm-movement stay gated on `!isMovingControlled`,
but heal does not.

### Warrior: reactive skills as loops, strategic skills stay in `currentStrategy`

The split is deliberately *by intent*, not by "is it a cooldown skill":

- **Reactive skills → their own `runSkillLoop`** in `startSkillLoops`: `warcry`, `hardshell`,
  `stomp`, `scare`, and a **defensive-only** `taunt`. `getTauntTarget()` returns *only* the
  ally-rescue target (peel a mob off a party member, or grab a weak current target attacking one) —
  it does **not** do the strategic pull-taunt.
- **Strategic/proactive skills stay in `pull_strategy.13.js` / `normal_strategy.12.js`**: gear plus
  the pull-only `agitate` and pull-`taunt`. They're driven on a fixed ~100ms cadence by a
  `runSkillLoop({ skill: "strategy", floorMs: 100, canUse: () => true, cast: () =>
  currentStrategy(get_target()) })` — i.e. the "gear loop" was generalised to just call
  `currentStrategy`, so all strategy-owned skills tick together off the attack loop. This keeps the
  farming/pulling policy in one place (the strategy files) instead of scattering it into the class
  file.

Consequence worth knowing: the defensive-taunt loop (keyed on `"taunt"`) and the strategy loop's
pull-taunt **share the `taunt` cooldown**. That's intentional — ally-rescue is meant to win when
both want to fire, and it usually does because it runs on the taunt-cooldown cadence while the pull
side re-checks `!is_on_cooldown("taunt")` before firing. They can still race on a given tick; if
that ever matters, the pull path is the one to gate harder. `warcry` is gated on a live
`get_targeted_monster()` so it doesn't drain mp buffing while travelling. `cleave` was already its
own `cleaveLoop`, untouched.

### Ranger: one plan drives both the gear and the shot

The ranger has two mutually exclusive modes — heal allies with `cupid`, or shoot mobs with a bow —
and *both* need the same information, so a single decide step produces it once:

`getPotentialTargets()` (annotated candidate mobs) → `getShotPlan()` / `getCupidPlan()` →
`getActionPlan()`, returning `{ mode, skill, target, gearTargets, shotTargets }`. `fight()` is then
only `change_target` + `firePlan()`, and the strategy loop equips `plan.gearTargets`. Gear and shot
can never disagree because they read one object.

- **`gearTargets` ≠ `shotTargets`.** On 5shot the gear decision reads the *weak* mobs while cupid
  shoots the wider `potentialTargets.slice(0, 5)`. Preserved from the pre-split code.
- **Mode is decided by what is *equipped*, not by who needs healing:** `getActionPlan` only returns
  a cupid plan once `isCupidEquipped()`. Healees pending + bow in hand ⇒ keep shooting mobs. The
  swap itself is `currentStrategy`'s job (`calculateRangerItems` returns `cupid` as mainhand
  whenever `getCupidHealees()` is non-empty). Without this the ranger stalls: it would refuse to
  shoot because it "should be healing", while nothing ever put the cupid in its hand.
- **Cupid heals whatever it hits**, so a bow-mode shot fired while cupid is still equipped *feeds
  the mob*. `firePlan` pushes `currentStrategy(plan.gearTargets)` alongside the shot in that state,
  so the swap-back is in flight with the shot — the same trick the pre-split `isCupid` branches used.
  **That swap is a no-op while healees exist**, because `calculateRangerItems` returns `cupid` as
  mainhand in exactly that case — so the shot lands as a heal on the mob. `fight()` must therefore
  go through `getActionPlan`, not `getShotPlan` directly: with cupid in hand and healees pending it
  yields a *cupid* plan (heal the allies) instead of a bow-mode shot whose swap can never fire.
- **Supershot doubles as an emergency heal** — it inherits cupid's heal-on-hit and outranges it, so
  with cupid equipped it targets the lowest-hp ally in *supershot* range (`getEmergencyHealee`).
  With a bow it targets mobs, and only ones **out of bow range** — anything closer is already being
  shot by the normal attack, so spending a long cooldown on it is waste.
- **`cast` re-checks `isCupidEquipped()`** before firing supershot: the gear loop can flip the
  mainhand between `canUse` and `cast`, and a stale plan would heal a mob or shoot an ally.
- **An empty mainhand is self-locking.** No weapon → no `character.range` → nothing passes
  `inRange` → no plan → the gear loop's `if (!pendingPlan) return false` → never equips. Two
  guards: `calculateRangerItems` falls back to `fireBow` when `character.slots.mainhand?.name` is
  `undefined` (an empty slot has no current name to "keep"), and the strategy loop treats *no plan*
  as permission to equip.

### Rogue: gear only in the cooldown gap

`currentStrategy` is gated on `!isAttackReady()`, not the usual `canUse: () => true`. The rogue's
dagger cycle is short and every `equipBatch` re-bases `next_skill.attack`, so a fixed-cadence swap
lands mid-window and eats shots. This is the pre-split behaviour restored (`if (!isAttackReady)
promisesToAwait.push(currentStrategy(target))`).

`fuaLoop` split into an `rspeed` loop and a follow-up-attack loop **keyed on `"quickstab"`** —
quickstab and quickpunch share that cooldown, so one key paces either weapon
(`getFollowUpAttackSkill()` picks by `wtype`).

### Merchant: `mluck` and `drop_egg` (2026-09-08)

The merchant gets the same `startSkillLoops()` treatment as the fighters, replacing a bare
5-minute `setInterval(() => use_skill("mluck", character))`. Self is just `candidates[0]` in the
same scan now, so the merchant tops itself up on the same rule as everyone else.

**Two different questions, one loop.** `getMluckTarget()` scans `parent.entities` for characters
in range (`is_in_range(entity, "mluck")`, a flat 320 from `G.skills`, and it also covers
`visible`) and splits on `isOwnedCharacter`:

- **Ours** — refresh at `ms < MLUCK_REFRESH_MS` (30 min of the buff's 3600000 duration). Deliberately
  *not* `buff.f !== character.name`: another merchant's luck is the same +12, so a bot lucked by a
  passer-by is left alone until it decays. Worth revisiting if the caster's 2% duplicate-loot roll
  turns out to matter more than the wasted casts.
- **Strangers** — cast unless `buff.strong`, which cannot be overwritten, so an attempt is pure
  waste. `mluckAimedAt` throttles the rest to one attempt per 15s **per aim, not per success**:
  the timestamp is written in `cast` before `use_skill`, so a rejected cast still counts. Without
  that the loop would re-pick the same unlucky stranger every 250ms.

Ours sort ahead of strangers, then by lowest remaining `ms`.

**Emotes are real skills.** `drop_egg` is a `G.skills` entry (`type: "skill"`, `emote: "drop_egg"`,
`cooldown: 2000`) — one of 16 — with no class, level, or mp gate. So it goes through
`use_skill("drop_egg")` and `is_on_cooldown`/`ms_to_next_skill` pace it like any other loop; the old
`parent.socket.emit("emotion", {name})` is not needed. It keeps the `character.moving` gate from the
commented-out interval it replaced, which is what leaves an egg trail rather than a pile.

## Skill loops must opt in to running while smart-moving (`whileMoving`)

**The regression.** Skills used to live inside `fight()`, which `mainLoop` skipped by throwing
`{ cause: "smart_move" }` before target selection. Moving them to `runSkillLoop` silently removed
that guard — every detached skill started firing mid-path (scares, taunts, curses, gear swaps
during a `smart_move`).

The guard belongs in `runSkillLoop` itself, defaulting to **blocked**, with an opt-in:

```js
const isMovingControlled = (smart.moving || isAdvanceSmartMoving) && !smartmoveDebug;
if (!character.rip && (whileMoving || !isMovingControlled) && canUse()) ...
```

Which skills opt in is decided by **where the code used to live**, not by taste:
- ran from their own loop, or from `priestBuff()` *before* `mainLoop`'s smart-move throw →
  `whileMoving: true` (priest `partyheal`/`absorb`/`zapperzap`, rogue `rspeed`)
- lived inside `fight()` / `currentStrategy` → default (blocked)

Deliberate divergence: rogue `quickstab` used to run while moving (it was in `fuaLoop`) and is now
blocked anyway.

## `smartmoveDebug` must be passed as an option, not just set (debugged 2026-08-25)

`smartmoveDebug` is the exemption from that `isMovingControlled` gate: the three kite-internal
smart moves in basic_function.7.js (the franky/nerfedmummy corner anchor in `resolveKiteTarget`,
the tanker's path-around-an-obstacle in `resolveDestination`, the stuck-while-kiting nudge) are
*repositioning inside a fight*, not travel, so the main loop and the skill loops must keep running
through them.

Setting the global before the call only works on the native path. `StrategicSmartMove.smartMove`
(the `parent.caracAL` path) assigns `smartmoveDebug = options.smartmoveDebug` — default `false` —
right before it starts walking, so a caller that set the global by hand had it clobbered one line
later. Symptom: the priest tanking franky walked it to the corner with target selection skipped
for the whole trip, so `useEventStrategy`'s per-tick `scareAwayMobs()` never ran, and the
trip's own `useScare: false` meant nothing scared either — the tank ate the entire lure. Callers
now pass `smartmoveDebug: true` in the options *and* set the global (the native
`oldAdvanceSmartMove` ignores the option), and reset it in a `finally`: `smartMove` throws on an
unfindable path, which used to skip the reset and leave every later travel move un-gated.

## `canUse` stashes what `cast` uses

`runSkillLoop` calls `canUse()` immediately before `cast()`, so `cast` must **never** recompute the
target — that re-runs the whole scan a second time every tick. Compute once in `canUse`, stash in a
closure `let pending*` declared at the top of `startSkillLoops`, read it in `cast`:

```js
canUse: () => { pendingCurseTarget = getCurseTarget(); return pendingCurseTarget != null; },
cast: () => use_skill("curse", pendingCurseTarget).then(() => reduceCd("curse")),
```

Closure-scoped, not module-scoped — every file lands in the same global scope via `load_code`.
Worst offender was priest `zapperzap` (`floorMs: 50`, multi-pass scan + sort = ~40 redundant
scans/second). Order cheap guards (`mp`, `is_on_cooldown`, `isCupidEquipped`) *before* the scan so
it is often skipped entirely rather than merely computed once.

## Candy-cane swap timing (`maybeCandySwap`, basic_warrior.9.js)

Swap to candy canes so they are equipped when the projectile *lands*, then swap back. Three timing
facts, each of which broke it once:

1. **The projectile does not spawn when `attack()` is called** — it spawns when the attack reaches
   the server, one one-way trip later. The hit is at `ping/2 + eta`; sending the swap-back at `eta`
   had it arriving at `eta + ping/2`, i.e. *level with the hit*. Hence
   `swapBackAt = now + etaMs + equipLatencyMs`.
2. **The hold must be anchored to when the canes land, not when the equip is sent.** Scheduling the
   timer next to `equip_batch(...)` spends a ping-sized chunk of the ETA before the canes are in
   hand; chain it off the equip promise (`candyEquip.then(swapBackAfterHit)`).
3. **Both ends need bounding.** Skip entirely when `etaMs <= equipLatencyMs` (the canes cannot land
   before the hit — pure loss: two equips plus a cooldown re-base). And clamp the hold with
   `swapBackDeadline = now + characterAtkCycleMs - equipLatencyMs - CANDY_MIN_HOLD_MS`, or the
   minimum-dwell floor can push the restore past the next attack and fire it holding candy canes.

Do **not** wait for the server's `"hit"` event instead: it costs ping/2 inbound plus ping/2 for the
swap command, leaving the canes on ~1 ping past the landing.

Contention note: `maybeCandySwap` requires `!isEquipingItems` and takes the lock before equipping,
so a free-running `strategy` loop mid-`equipBatch` silently *cancels* the swap for that shot — and
`equipBatch`'s penalty budget is widest right after a shot, exactly the candy window. The warrior
tolerates this (`canUse: () => true`); the rogue does not (see above).

## Field reports must fail closed (`entFieldReport`)

**The bug.** The merchant's ent-lure gate read the mage's report with the freshness test *inside*
the positive condition:

```js
return !!(mageInfo && Date.now() - mageInfo.time < 15_000 && mageInfo.count >= MAX_ENT);
```

Mage offline ⇒ the age test is false ⇒ the whole expression is false ⇒ the gate reads it as "under
the cap, lure another one". Stale data became *permission*. Any "is it safe to act" predicate built
on a peer's snapshot must branch on staleness separately and return the **blocking** value:

```js
if (!report || Date.now() - report.time >= ENT_FIELD_STALE_MS) return true; // assume full
```

**Ownership.** The count was written only by `basic_mage.4.js`, behind a `max_mp > magiport * 1.5`
guard — so swapping the mage out of the party meant nobody ever wrote it again. It now lives in
`publishEntFieldReport()` (basic_function.7.js), called from the mage's and ranger's `mainLoop`
(per-tick, not an interval — 2s was too stale). Any class can report; `mageLocation` stays
mage-only because its other consumers (`advance_smart_move.20.js`, `strategic_smart_move.21.js`)
genuinely need magiport.

The reporter must **be able to see the field**: it returns early unless the character is on `map`
and within `ENT_FIELD_REPORT_RANGE` of `{mapX, mapY}`. A distant fighter would otherwise report `0`
ents and hand the merchant the same false green light in a new form.

## Two party rosters, one definition each (`getMyCharacters`/`getAlliedNames`)

There are two different questions and they had been spelled out by hand, differently, at a dozen
call sites:

- **`getMyCharacters()` — `[...partyMems, partyMerchant]`, our own characters.** `partyMems` alone
  is the *fighting roster*; the merchant is a member of the party too (`deployCharacters` invites
  exactly this list every 10s). Use it for "is this one of mine".
- **`getAlliedNames()` — ours plus `parent.party_list`, as a `Set`, self included.** Use it for
  "is this mob being held by someone on our side", where an outsider sharing the party counts.

**The bug that prompted it (debugged 2026-08-25): the warrior never agitated.**
`wontStealOrBreakCoop` derived its outsiders as `parent.party_list.filter(name =>
!partyMems.includes(name))`, so our **own merchant** read as an outsider. The merchant stands at
the farm spot with dragged ents attached to it more or less permanently, which made
`mobsTargetingExternalParty` true on nearly every tick; the only escape clause is being more than
300px from the farm spot, which the tanker never is. Joining `trustedPartners`' party sharpened it
— their mobs are on our field by design — but the merchant alone was already enough to hold
agitate off for good. The same `partyMems` test inside the cooperative clause had the same hole.

Two callers keep `parent.party_list` deliberately: the priest's `shouldPartyHeal`, because
`partyheal` only reaches actual party members, and the party-management interval, which is what
maintains the list in the first place.

**What the pull is judged on is `mobsInAgitateRange`, not everything in view.** `mobsList` is every
monster the client can see (~a screen wide); agitate has a radius. `formidableMonsterAppeared` used
the former, so a single mob over `MAX_MOB_DPS` — or a `porcupine` — anywhere on screen disabled the
pull even though agitate could never reach it. It and `currentAggroDamage` now share one in-range
scan. The counts that stay screen-wide are the ones about mobs *already* on us
(`havePulledEnoughMobs`, the per-damage-type courage tallies): a mob chasing us counts against our
load wherever it currently stands.

Still deliberate, and still the first thing to check if agitate stays quiet at an ent farm: the
cooperative clause refuses when *any* untargeted coop mob is in range. `ent` is cooperative, so a
fresh one standing at the spawn blocks the pull — waking an unowned ent by accident is exactly what
`dragEnt` exists to do on purpose. `mobsTargetingExternalParty` also still scans every monster on
screen rather than the ones agitate could reach.

## Splash safety: one scan, three thresholds (`hasUntargetedMonsterAround`)

An unaggroed mob inside a blast radius is a mob you are about to *wake*. Three call sites wanted
that same predicate at different thresholds, and had grown three copies:

- `numberOfMonsterAroundTarget` — returns `0` for non-melee classes when any untargeted mob is in
  radius, which is why `cluster_count` (and therefore `canSplash`) was already splash-safe.
- `haveFormidableMonsterAroundTarget` — the same scan narrowed to `> FORMIDABLE_MOB_DAMAGE`.
- `isSafeToShoot` (ranger) — gates 5shot/3shot/single on the blast being clean.

All three now delegate to `hasUntargetedMonsterAround(target, blastRadius, counts)`, where `counts`
is a predicate deciding which bystanders are worth worrying about — `haveFormidableMonsterAroundTarget`
passes the `> FORMIDABLE_MOB_DAMAGE` test, `isSafeToShoot` passes `!isNegligibleMob`, and the
default counts every mob. Note `mobsListAroundTarget` **cannot** serve here: it filters on
`entity.target`, dropping exactly the untargeted mobs being looked for.

**Waking a harmless mob is not a reason to hold fire.** `isNegligibleMob` lets the shot through when
the bystander is a `1hp` mob, barely scratches us, or dies to the splash outright — otherwise the
ranger stands around whenever a single trash mob drifts into the blast.

**Watchout abilities override "negligible".** A mob whose `abilities` include anything in
`WATCHOUT_ABILITIES` (`burn`, `stone`) is never a harmless bystander: burn keeps ticking after the
mob dies and stone locks the party down, so the damage numbers `isNegligibleMob` weighs say nothing
about the real cost. `isSafeToShoot` therefore refuses the target itself while it has no `.target`
(nobody holds it, so the shot is what wakes it) and counts any untargeted watchout mob in the blast
via `hasWatchoutAbility`. Once something else holds the aggro the mob is already awake and the check
stops applying — the same `.target` convention the tanker's `taunt` and `agitate` gates use.

**Filter the volley, not the candidate list.** `getPotentialTargets` annotates each candidate with
`safe_to_shoot` and keeps the unsafe ones in the list; the 5shot/3shot slices filter on that flag so
one dirty blast costs a mob rather than the whole volley. Pre-filtering the candidate list instead
would deadlock the gear layer: `calculateRangerItems` only learns the blast is dirty because an
unsafe mob reaches it as `gearTargets` (through the single-shot fallback, which still calls
`isSafeToShoot` directly since its target may come from `get_targeted_monster` and carry a stale
flag). With no unsafe target ever reaching it, a ranger holding the poucher would find zero targets
and stand there instead of swapping down to `t2quiver`.

**Judge gear against the radius you would have, not the one you have.** `calculateRangerItems` uses
`character.explosion / 3.6 || BLAST_RADIUS`; testing the *current* explosion makes a ranger holding
no splash weapon read "safe" → equip poucher → now unsafe → unequip, every 100ms. When the blast is
unsafe the poucher is also filtered out of the `rangedWeapons` one-shot search (the side door that
`canSplash` does not cover) and the offhand is forced to `t2quiver`.

## `withTimeout` bounds the wait, never the operation (`equipBatch`)

`withTimeout` is `Promise.race([promise, sleep])`. When the sleep wins, the raced promise is still
pending — JS has no cancellation. So a timeout at the *call site* protects the caller's tick and
nothing else, which is why the ranger could stop equipping entirely while every loop kept running
and no error was logged: one `equip()` whose server response never arrived left `Promise.all`
pending forever, its `.finally` never released `isEquipingItems`, and every later `equipBatch` hit
that latch in the top guard and returned `false`. Only a script restart cleared it.

Any module-scope latch guarding an in-flight request must release itself: `equipBatch` now sets the
flag, delegates the actual equips to `buildEquipPromises`, and releases in a `finally` that also
covers a synchronous throw, with `withTimeout(..., EQUIP_TIMEOUT_MS)` bounding the wait *inside* the
latch. `Promise.allSettled` rather than `Promise.all`, so one rejected equip no longer rejects the
whole batch — no caller reads the resolved value.

## The native branch must exclude caracAL, not just `enabled` (debugged 2026-09-06)

Both `parent.caracAL` forks in basic_function.7.js were written as

```js
if (parent.caracAL && caracALconfig.characters[character.name].enabled) { ... }
else if (!character.controller) { ...native CODE path... }
```

which is wrong the moment a character runs **under caracAL with `enabled: false`**. It fails the
first test, falls into the `else`, and starts behaving like a browser tab. Today only
`MerchantMooh` is enabled — it is the root that deploys the other three — so all three fighters
were taking the native path.

**The symptom was an `already_running` flood.** Every fighter ran `deployCharacters`' native
branch every 30s and called `start_character(id, CODE_SLOTS[id].script)` for all of
`getMyCharacters()`, because `get_active_characters()` does not report caracAL peers, so nothing
survived the `!loadedCharacters[id]` filter. Three fighters x three peers = nine rejections a
cycle, each printed by caracAL's unhandled-rejection handler.

Worth knowing where that string comes from, because it is easy to blame the game: `already_running`
appears nowhere in the shipped `runner_functions.js`, and the deployed `start_character` contract
says it *resolves* "immediately when it already has a local runner" and that "repeated calls for
the same local character share its startup or reuse its active runner instead of creating
duplicates". The real runner never rejects for this. It is caracAL's `start_character_runner`
shim, reached through the public `start_character` wrapper.

The fix on both branches is `else if (!parent.caracAL && !character.controller)`. The second
fork mattered too: the fighters were calling `load_code(25)`/`load_code(14)`, the native slot
loader, under caracAL — either a silent no-op or three extra server-hop loops.

**The trap when reading this code**: `enabled` gates *server hopping and deployment authority*,
not *whether caracAL is running the character*. A disabled character is still a caracAL
character. Any new `parent.caracAL && ...enabled` fork needs the same `!parent.caracAL` on its
`else`, or it hands caracAL characters the browser code path.

## Script loading is synchronous in both environments (2026-08-02)

caracAL's `load_scripts` is now synchronous, matching the native `load_code`, and a failed load
reloads the character rather than rejecting a promise. Every file pulled in — transitively — has
finished evaluating by the time the call returns, so there is no readiness handshake: entry scripts
load their dependencies at the top and start their loops unconditionally at the bottom of the file
(after every `const` in that file has been initialised — starting them at the top would hit the TDZ
on module-scope config declared further down).

This retired `pendingScriptLoads`/`dependenciesLoaded` and the `if (!parent.caracAL)` guards around
loop starts; there is now exactly one start site per loop per entry script.

**The bug it retired**, and why it survived so long: `basic_merchant.5.js` was the only entry script
that never loaded `basic_function.7.js` itself — it loaded 10 and 19, and file 10 *fire-and-forgot*
file 7. So `load_scripts([10, 19])` could resolve while file 7 was still in flight, making
`.then(() => dependenciesLoaded)` a **ReferenceError on an undeclared `var`**. The chain rejected
with no `.catch`, so `syncBankData`/`bankLoop`/`lureMechaGnome`/`dragEnt` never started — silently,
and only on the races file 7 lost. Diagnosing it burned a session on `dragEnt` itself, because the
symptom (all lure flags `false`, no lure ever) is identical to a dead reschedule. Rule of thumb:
before debugging a self-rescheduling loop, prove it started at least once.

## Merchant event participation (`merchantAttackLoop`, merchant_frenzinesss.100.js)

Written 2026-08-02. The merchant tags event bosses purely for a loot share, so the risk budget is
the inverse of a fighter's: it never needs the kill, so any tick that looks unsafe is skipped
rather than fought through.

- **It only shoots what somebody else is tanking.** `isSafeToHit` requires `target.target` to be
  set and to not be us — an *untargeted* boss is the dangerous case, because our hit is what
  aggroes it. `isEventTanked` prefers the local entity's `target` over `server.status[name].target`
  (the S copy lags, and is absent entirely before the boss is rendered). The exceptions are listed
  in `UNTANKED_OK` (snowman/wabbit/pinkgoo) — harmless enough to hit solo, and gated on nothing
  but their own `shouldAttack`.
- **There is no dps test anywhere any more (removed 2026-08-02).** `isHitAffordable` compared
  `calculateDamage(target, character)` against `max_hp * EVENT_MAX_DPS_RATIO` and ran on the boss
  *as well as* the tank check — inside `isSafeToHit`, again standalone in `fightCurrentEvent`, and
  a third time in five of the `shouldAttack`s. An event boss out-dpses the merchant's entire hp
  bar many times over (crabxx ≈ 100k vs ≈ 8k hp), so it could never pass: `attack` was unreachable
  for every tanked boss, and the merchant travelled to the event, geared up, then idled at the
  stand forever — which reads exactly like a hang. Safety is now positional and structural, the
  same shape the fighters use: shoot only what someone else holds (`isSafeToHit`), kite at
  `EVENT_RANGE_RATE` of dartgun range, and pull out on the hp band below. Residual risk taken
  knowingly: if a boss switches to the merchant, its dps arrives before the next tick can react.
- **The retreat floor is healer-dependent** (`getCoveringHealer`). Alone, the merchant bails at
  80% and won't re-engage until 95% — it has no way back up but `potionLoop`. With our own healer
  alive and inside its *own* range (`HEALER`, not `PRIEST`: `dynamicParty` swaps a ranger into the
  role for several events), hp is rented rather than spent, so the band drops to 40%/60%. The
  `party_heal` cm is only worth sending in the uncovered case — a healer already in range is
  healing us anyway.
- **Aggro on us is not by itself a reason to stop shooting (fixed 2026-08-02).** `keepMerchantSafe`
  used to end with `!monstersOnMe().length`, i.e. any single mob holding our aggro parked the
  fight. At crabxx that is permanent: the boss spawns young crabx onto whoever is nearest far
  faster than scare comes off cooldown, so `isSafeToFight` was false on nearly every tick and
  `attack` was never reached — the merchant sat next to a cracked crabxx with the stand still open
  from the `"1hp"` phase, kiting the adds around at `EVENT_RETREAT_RANGE_RATE`. It still scares
  what it can, but only the hp band stops the fight now.
- **The snipe takes anything under `SNIPE_MAX_PREDICTED_HP` in reach**, full stop — no tank check,
  no dps check. A mob that close to death is worth the shot whoever owns it, and the loot/xp is
  free; `getSnipeTarget` is deliberately just type/range/predicted-hp.
- **Positioning is `hitAndRun`, not a second mover.** The loop used to walk itself with bespoke
  `move()` steps; it now hands the boss to `change_target` and writes `rangeRate`, and the shared
  kite loop does the rest. `hitAndRun()` is therefore started for *every* class, with an
  `isMerchant() && !shouldMerchantKite()` gate inside it (guarded by `typeof`, since fighters never
  load slot 100) so there is exactly one loop that can be enabled rather than a second one spawned
  per fight. **`shouldMerchantKite` checks the weapon, not just the flag**: orbit radius is
  `character.range * rangeRate`, so kiting on the broom would hold a melee-length orbit around a
  boss. For the same reason the attack loop stops dead right after `equipBatch` until
  `character.slots.mainhand` actually reads `ATTACK_WEAPON` — `isFightingBoss` goes true when the
  duty is taken, which is well before the swap lands. It also returns false when the current
  target is under `SNIPE_MAX_PREDICTED_HP`: something that is dying anyway is not worth orbiting,
  and moving for it walks us out of position for the boss.
- **Two tick rates, not five**: `EVENT_TICK` while actually shooting a boss, `EVENT_IDLE_TICK` for
  every branch that is waiting on something else (travel, gear swap, no event, nothing in range).
  Consequences worth remembering: **backing off is a `rangeRate` change**
  (`EVENT_RETREAT_RANGE_RATE`), never a `move()` of our own — two writers on position fight each
  other; `releaseEventDuty` restores `basicRangeRate`; and travel still belongs to
  `advanceSmartMove`, which `hitAndRun` sits out (`smart.moving || isAdvanceSmartMoving`). The
  loop only calls the pathfinder past `EVENT_APPROACH_MULTIPLIER` of our reach — inside that, the
  kite closes the gap. The merchant still has no `currentStrategy`: basic_function.7.js skips
  slots 12/13 for `ctype === "merchant"`. Shedding aggro is `scareAwayMobs()`, as everywhere else.
- **Sniping is not part of the event half.** `fightCurrentEvent` owns joining/gearing/shooting a
  boss and reports back whether it spent the shot; `merchantAttackLoop` snipes on any tick it
  didn't, event or not — a nearly-dead mob in reach is free, and waiting on a tank or walking in
  are exactly the ticks with a spare attack. It can't steal the boss' cooldown because it only
  runs on the `attacked: false` path.
  **The reach it scans with is computed, not read** (`getAttackWeaponReach`, merchant_luring.24.js
  — shared with `dragEnt`, which used to inline `character.range + character.xrange * 0.8`).
  `character.range` is the *broom's* outside a fight (`calculateMerchantEquipments` only hands over
  the dartgun while `isFightingBoss` or `isDraggingMobs`), so a live check would never see a mob
  worth swapping for — chicken and egg. `getMaxAttackWeaponRange` measures what we *could* field
  instead, like `BLAST_RADIUS`, but name-locked to `ATTACK_WEAPON` plus `getBestQuiver`: the
  merchant hauls the fighters' loot, so a by-wtype sweep would set the reach off a crossbow he
  can't hold. Unlike `BLAST_RADIUS` it can't be a load-time `const` — the dartgun normally starts
  in the bank, so it's remembered in `maxAttackWeaponRange` (refreshed to the real
  `character.range` whenever the gun is in hand) and reads 0, snipe off, until one has been seen.
  `getBestQuiver` is also what `calculateMerchantEquipments` and `ensureDartgun` pick the offhand
  with, so the reach we measured and the quiver we equip can't disagree. The swap itself goes
  through `calculateMerchantEquipments` like every other one, which branches on
  `shouldHoldAttackWeapon()` — deliberately a *question* (`isDraggingMobs || isFightingBoss ||
  a snipe target is in reach`) and not a second flag. `isFightingBoss` can't be borrowed for it,
  since `releaseEventDuty` clears that every eventless tick; and a flag of its own would be a
  second piece of state for one loop, with a lifetime to leak. Asking instead means the broom
  comes back on its own the moment nothing is in reach, via whoever next runs the calc (the main
  loop's `character.moving && character.stand` branch, or `advanceSmartMove`'s direct equip).
- **The merchant wears the luck set too**, off the same `shouldWearLuckGear()` the fighters use.
  That is why `calculateMerchantEquipments` now lives in strategic_fn.11.js beside the other
  `calculate*Items` (and in `calculateBestItems`) rather than in basic_merchant.5.js — slot 11 is
  loaded for merchants, 12/13 are not. The gear/range primitives it needs (`ATTACK_*`,
  `getCarriedItems`, `getBestQuiver`, `getMaxAttackWeaponRange`, `getAttackWeaponReach`) moved
  there with it, next to `findMaxLevelItem`/`getMaxBlastRadius` where gear selection already
  lives, so the direction is 11 → 19 → 100 throughout and only *state flags* are read the other
  way — the same shape as `calculateWarriorItems` reading `currentStrategy`.
  `getMerchantOffhand` drops the quiver for
  `mshield` while it's up — the range loss is deliberate, since what makes us lucky is a mob that
  is nearly dead anyway — plus `rabbitsfoot`/`spookyamulet`. Losing `jacko` off the orb is safe:
  `scareAwayMobs` re-equips it itself before casting.
- **The bank trip stocks every branch, not the current one.** A swap happens mid-lure or mid-boss,
  where walking to the bank for the missing piece is not an option, so `retrieveMerchantGear`
  (merchant_bank.17.js, run from `bankLoop` while the duty is held) pulls one copy of the whole
  table. The union comes from `getMerchantGearNames`, which *evaluates*
  `calculateMerchantEquipments` over all eight states rather than listing names — which is why the
  three branch inputs became an explicit `state` parameter (`getMerchantGearState` supplies the
  live one). A hand-kept list would drift the first time a slot changed. Per name it takes the
  **locked copy first**, level only breaking ties — a lock is a deliberate "this one is the
  merchant's", while the highest level may well be upgrade fodder in flight. That is also why it
  retrieves by pack/slot instead of `retrieveBankItem`'s name+level search, which would hand back
  a same-level unlocked twin. Retrieval alone isn't
  enough: `bankStoreRoutine` would ship the spares straight back on the next pass, since a bagged
  `broom`/`jacko` reads as high-level and equipable. `getMerchantGearKeepIndices` pins the
  *highest level copy of each* by inventory index — by name would starve the upgrade rotation of
  `dexearring`/`solitaire`/`pants` fodder, and the store passes work off names, so the index set
  has to be threaded through `storeMatchingItemsOnFloor` and the backward pass too. Indices stay
  valid mid-routine because storing leaves a hole rather than compacting. `ensureDartgun` stays as
  the just-in-time path for the one piece a drag cannot start without.
- **A low-level copy is only kept out of the bank while something can eat it** (`isFodder` in
  `bankStoreRoutine`). `isHighLevel` alone used to decide it, which stranded compoundables: a lone
  `talkingskull +0` under a `+2` in the bank reads as fodder, but `upgradeInv` skips it (a
  compoundable has no `upgrade`), `compoundInv` needs three at that level side by side, and
  `filterCompoundableSets` only ever pulls complete sets *from the bank* — so nothing could consume
  it and it held a bag slot forever. The question to ask is therefore per mechanism: three unlocked
  copies at that exact level for a compound (`countInventoryAtLevel`), nothing but the item itself
  for an upgrade. Upgradables are unaffected, and the `IGNORE`/craft-target gates still run first —
  `bow` stays in the bag because it is `BUYABLE` (so `IGNORE`), and `vitring` because
  `craft("armorring")` registers a climb target for it.
- **A pick that yields nothing must not spend the retrieve call.** `retrievedBankItemToUpgrade`
  ranks by raw copy count, but count is not the same question as *retrievable*: locked copies, the
  `KEEP_THRESHOLD` tail and `filterCompoundableSets`' set-of-3 grouping each empty a pile that
  looked big — nine `+0` and one `+8` under a keep of 8 leaves two `+0`s and no set. The old code
  pushed the id onto `RETRIEVE_HISTORY` *before* computing the items, so a pile in that state
  burned a rotation slot every visit and starved the rest. `selectRetrievableItems` answers the
  real question for one id, and the rotation now walks the count-ordered candidates until one
  actually yields. Its clamp matters too: `slice(0, length - keep)` goes *negative* for a pile
  under its threshold, and a negative end counts from the end — so a pile of 5 with a keep of 8
  used to hand back 2 instead of nothing.
- **A compound set is three slots, not three neighbours** (`findCompoundSet`). `compound()` takes
  arbitrary inventory slots; the old `items[i+1]`/`items[i+2]` scan required them side by side and
  `break`-ed at the first empty slot, so nothing past a hole was even examined. Storing leaves
  exactly such a hole, and a retrieved set fills it plus slots at the end — the copies were there
  and the compound still never fired. The scan skips locked items now too, which the adjacency
  check never did: with merchant gear pinned by `.l`, a locked piece was compoundable fodder.
  This is the other half of letting a stranded ingredient rejoin the pile: `bankStoreRoutine` only
  pins a craft ingredient while `isFodder` says the climb can happen, and
  `retrievedBankItemToUpgrade` hands the call back to the count rotation when the targeted climb
  yields nothing — otherwise a single under-level copy in the bank matched `targetedItemId` every
  cycle and stalled every retrieval.
- **The home/boss ping-pong (debugged 2026-08-02).** Symptom: at snowman with `fullguardx` up,
  the merchant walked home and back, repeatedly. `fullguardx` was only the trigger — with nothing
  to shoot, the merchant idles at the event, so the 750ms main loop's `compoundInv`/`upgradeInv`
  get their turn and set `character.q.upgrade`. That was in `isMerchantBusy`, which released the
  duty; `onDuty` false hands the merchant back to the main loop, which calls `moveHome()`; the
  quest flag then clears, the event is still live, and the loop walks straight back out. Fix is
  the split between `isMerchantBusy` (soft — reasons not to *set off*) and `mustAbandonFight`
  (hard — rip/inventory only, the sole reasons to walk away from a boss already committed to).
  General rule for this loop: **anything that can toggle on its own must not be able to release
  the duty**, or the main loop's movement and ours take turns undoing each other. Same reasoning
  removed `character.c.mining`/`c.fishing` from `isMerchantBusy` and put `getEventToJoin()` in
  front of `goMining`/`goFishing`/`moveHome` in the main loop: a live event outranks chilling, and
  a skipped rod cast is back off cooldown long before the next boss spawns.
- **Banking and fighting are mutually exclusive, in both directions.** The startup bank walk wins
  first: `hasVisitedBank` (merchant_bank.17.js, set at the end of `bankLoop`'s first run) is in
  `isMerchantBusy`, so no event can start before the cache the rest of the merchant reads even
  exists. After that the fight wins: `bankLoop` waits while `isFightingBoss`, and the main loop's
  emergency `bankStoreRoutine` skips too. A full inventory (or `invJammed`) is therefore a
  `mustAbandonFight` reason: there is nothing left to gain from the fight, and **releasing the duty
  is precisely what unblocks the banking** — the two guards are a handoff, not a deadlock.
- **The stand stays open at events.** `idleAtEvent` opens it whenever the attack gate rejects the
  target (a `fullguardx` snowman is the common case — unlike the fighters, the merchant does *not*
  fall back to shooting arcticbees, it just waits the phase out). Nothing closes it again: a
  merchant moves at speed 10 with a stand open, which is fine for orbiting a boss, so the attack
  path doesn't `close_stand()` and `hitAndRun` isn't gated on it. The main loop's
  close-the-stand-when-moving rule is skipped while `isFightingBoss` for the same reason.
- **Duty ownership is held across ticks, not per tick.** `acquireEventDuty`/`releaseEventDuty` set
  `holdsEventDuty` so the loop only ever clears an `onDuty` it took (the rule in "Merchant duty
  lock"). Releasing it every tick would let the 750ms main loop `moveHome()` mid-fight.
  `isFightingBoss` is the separate cosmetic flag: it swaps gear to dartgun/armorring and suppresses
  `open_stand()` in basic_merchant.5.js.
- **Concurrent bosses: lowest hp share wins** (`getEventHpRatio`/`getEventToJoin`), the same
  measure `useEventStrategy` sorts on — mrgreen/mrpumpkin in particular overlap. The
  local entity's hp beats the `server.status` copy once we're on the map, and an event reporting no hp
  reads as full so it never jumps the queue by accident. Unlike the fighters, though, re-picking
  costs the merchant a **whole map trip**, so `currentEventName` only loses its slot when another
  boss is `EVENT_SWITCH_MARGIN` (15pp) lower — two bosses melting in lockstep would otherwise
  leave the merchant commuting instead of shooting. `releaseEventDuty` clears the commitment.
- **The home\boss ping-pong, second cause (debugged 2026-08-03).** Same symptom at franky, one
  layer earlier than the `isMerchantBusy` fix above: `shouldJoin` for the tanked bosses is
  `isEventTanked`, which reads the boss' *momentary* `target`. A boss between targets — franky
  retargets constantly, and its adds pull aggro — reads untanked for a tick, `getEventToJoin()`
  returns undefined, `fightCurrentEvent` releases the duty, and the main loop walks home before
  the next tick re-acquires. The `?? eventInfo.target` fallback doesn't save it: the `server.status`
  entry has no `target` field. Fix: `getEventToJoin` re-adds `currentEventName` to the joinable
  list while `isEventStillLive`, so only the boss actually ending (or `mustAbandonFight`) unseats
  us. The general rule is the one above, applied to the *join* decision and not just the blockers:
  anything that toggles on its own must not be able to release the duty.
- **Idle sniping** (`getSnipeTarget`/`snipeNearbyWeakMob`): with no event to join, anything under
  `SNIPE_MAX_PREDICTED_HP` already inside `is_in_range(entity, "attack")` gets a shot. It takes no
  duty and never moves — a free kill costs the merchant only the shot, and chasing would put it
  where nothing else expects it to be. `getPredictedHp` subtracts what is already in the air (the
  `PROJECTILE_MANAGER` measure `getCrabsForCrabxx` annotates crabs with), so the merchant doesn't
  waste its shot on a mob the party has already killed. The idle branch ticks at attack speed
  while a candidate is visible and drops back to `EVENT_IDLE_TICK` otherwise.
- **The "about to die" kite cutoff is a snipe rule, and must not read the boss** (debugged
  2026-08-06). `shouldMerchantKite` drops the orbit once `get_target()` is under
  `SNIPE_MAX_PREDICTED_HP` — right for a trash mob that dies before we finish walking, wrong for
  the boss, which `fightCurrentEvent` has already made the target. `hitAndRun` then goes idle and
  nothing closes the gap between `reach` and `reach * EVENT_APPROACH_MULTIPLIER` (the pathfinder
  only engages past the latter), so a *roaming* boss drifts a few pixels out of range and the
  merchant stops shooting until it dies. Stationary bosses hide the bug; snowman is where it
  shows. Hence the `target.mtype !== currentEventName` exemption.
- **`1hp` is clamped in the projectile manager, not at the call sites.**
  `_calculateSingleHitDamage` caps at 1 for a `1hp` target, so every consumer of
  `getIncomingNumber` (the merchant's `getPredictedHp`, `getCrabsForCrabxx`, the priest's healee
  prediction, `suicide`) is right by default. Without it, `calculateDamage` reports the full
  swing: three party projectiles at a shelled snowman or crabxx read as thousands of damage in
  the air, driving predicted hp negative at *full* boss hp — the cutoff above then fires the
  whole fight, not just at the end. The clamp lands at registration, so a projectile fired while
  the shell was up stays worth 1 even if the shell breaks first; flight time is well under a
  second, so it is not worth re-reading on every query.
- **The loop does not loot.** `midasLooting`'s third branch already covers the merchant: with no
  `partyMems` entity in vision `bestLooter()` returns undefined, which is what qualifies him to
  `loot()` — no midas gear involved. The `lootIfSolo` that used to live here keyed off
  `parent.party_list`, so a merchant partied with fighters two maps away never looted; what
  actually blocked the branch was the `penalty_cd` guard, see "Equip batching vs `penalty_cd`".
- The loop is self-rescheduling with the reschedule as the last statement of `finally`, per
  "Self-rescheduling loop discipline". A guard-blocked tick releases duty (it owns the check) and
  just waits `EVENT_IDLE_TICK`.

## Fighter targeting is a strategy chain (`selectFightTarget`, basic_function.7.js)

`fighterStrategies` is walked in priority order — `useEventStrategy` (daily_event_fighter_strat.26.js),
`useCryptStrategy` (crypt_fighter_strat.16.js), `useFarmingStrategy` (farming_fighter_strat.27.js) —
and the first one to return `true` owns the tick, exactly like `merchantStrategies`. Events outrank
the crypt: a crypt key keeps until tomorrow, a live boss does not.

**Why a boolean and not the target.** A strategy that spends its tick *travelling* has no target but
still has to stop the ones below it from running. The old `changeToDailyEventTargets` returned
`undefined` for both "nothing here" and "I am on my way to the boss", so the entry script read the
second as the first and smart-moved back to the farming spot — the two moves fought each other, and
a live-but-out-of-sight boss could never be reached. The pick therefore travels out of band:
`commitTarget()` stores it in `fighterTarget` (and only re-`change_target`s when it actually
changed), `selectFightTarget()` hands it back, and "owns the tick" stays a separate answer from
"has something to hit".

**Each strategy carries its own move.** Walking into the crypt belongs to the crypt strategy,
regrouping on `mapX`/`mapY` to the farming one, chasing an announced boss spot to the event one. The
entry scripts keep only `const target = await selectFightTarget(); if (target) await fight(target);`
— the per-class copies of the "no target, so move somewhere" block are gone, and with them the
drift between them (warrior wanted leader *and* far, everyone else leader *or* far).

**Off the spot, only `mobsToFarm` holds us (`isFarmMob`).** A boss dies and the field it drew stays
full of mobs, so plain targeting kept finding something to splash and the party farmed the event site
instead of the spot — indefinitely, since each kill woke the next. Past `FARM_SPOT_SLACK` the target
therefore has to be one we came for (`mobsToFarm`, or the character's own `ownTargets`); anything else
is left standing and the walk home starts on that tick. Tying it to where we are rather than to the
event that took us there keeps the crypt reachable: a crypt run is a strategy above farming, not a
debt farming has to spend before it can start.

**One empty tick is not idle (`FARM_REGROUP_IDLE_MS`).** `getFarmTarget()` goes empty for entirely
normal reasons — the mob just died, it walked out of vision, or a follower's aggroed mob sits outside
its own `range + xrange` mid-pull. Acting on a single such tick started a walk home, and the walk is
the expensive half: `isAdvanceSmartMoving` short-circuits mainLoop until it lands, so one unlucky
frame abandoned a live fight (a warrior still on a megatron, but every class hits this). The strategy
therefore stamps `lastEngagementAt` whenever it has a target or `isPartyEngaged()` — a monster in
vision holding any ally, or a `mobsToFarm` mob standing right here — and regroups only after that has
been quiet for 5s. Distance is the wrong signal for this: "do not leave when far from home" is exactly
backwards, since far from home is when coming back matters most. `FARM_SPOT_SLACK` still decides
*whether* a follower has drifted, not *when* it is safe to act.

**Any class can farm its own spot.** `ownMap`/`ownMapX`/`ownMapY`/`ownTargets` default to `undefined`
in farming_fighter_strat.27.js and fall back to the party's `map`/`mapX`/`mapY` and `getTarget()`, so an
entry script overrides them by declaring them at its top and everyone else pays nothing. They were
`rangerMap`/`rangerTarget` plus a copy of the shortlist scan in each ranger file, which is why
basic_ranger.32.js never got either. The trip needs no `scareAwayMobs()` loop of its own: both
`advanceSmartMove` implementations already scare for the whole move unless passed `useScare: false`.

**Goobrawl holds the map.** The brawl is empty between waves, so the branch owns the tick on
`server.status.goobrawl` alone rather than on a goo being in sight — leaving for the farming spot
mid-brawl costs the whole event.

## Crabxx targeting keys off the shell, not the crabx (`useEventStrategy`)

`crabxx` carries `"1hp"` while its shell is up: every hit lands for exactly 1, whoever throws it.
Target selection therefore branches on that flag first — shell down means the boss outranks any
crabx for every class; only while it's up do the old per-class rules apply (warrior takes the
best-clustered crabx for cleave, everyone else the best crabx, falling back to the boss only if
something else is already holding it). The previous "are there crabx around" heuristic is what
this replaced: it could leave the party chipping 1s off a cracked boss because adds happened to
be nearby, or ignore a cracked boss when they weren't.

The merchant reads the same flag from the other end (`bossConfigs.crabxx.shouldAttack`,
merchant_frenzinesss.100.js) — it parks with the stand open while `"1hp"` is set rather than
spending shots for 1 damage each.

## `homeLocation` is a Merrit parcel spot, not just a parking space (2026-09-08)

Merrit (`G.npcs.citizen22`, `citizen_behavior: "market_patron"`) patrols the Mainland square and
leaves a `marketparcel` — plus a small SHELL roll — to anyone holding an open, stocked stand he walks
past. So the merchant's idle spot is load-bearing, and every constraint lives in
`G.npcs.citizen22.market`: inside one of the two `areas`, within `handoff` (32px) of his route
through `stops`, more than `npc_clearance` (40) from a stationary NPC, `stand_clearance` (10) from
another stand and out of the `front_clearance` box in front of one, parked for `settle_ms` (2 min)
within `anchor_tolerance` (4px), with a real listing and a free inventory slot. One parcel per
account per `hour_ms`.

**Park by a `stop`, not by a line between two.** The 32px handoff is against wherever he actually
walks, and his pathing between stops is not in `G` — only the seven stops themselves are, each held
for `delay` (5s). A spot measured against interpolated stop-to-stop segments assumes a straight-line
walk the data never promises; a spot within ~20px of a real stop is safe under any pathing. Every
entry in `MERRIT_SPOTS` is picked that way, which is why none of them are the square's centre —
stop `[0,0]` is the one with a fixed NPC inside the 40px clearance.

**The spot list is a rotation, not a constant.** `stand_clearance`/`front_clearance` are contested —
another player's stand parked on our spot silently costs us every parcel — so `getStandSpot()` walks
`MERRIT_SPOTS` in order and takes the first that `isSpotTaken()` clears, with `homeLocation`
(the first entry) as both the preferred spot and the fallback. It is deliberately re-evaluated on
every `moveHome`, so a neighbour arriving moves us on and a neighbour leaving brings us back; the
order being fixed is what keeps that from oscillating. Off `main` there is nothing to see, so it
returns `homeLocation` and re-decides on arrival.

`moveHome`'s arrival slack had to come down from 150px to `STAND_ANCHOR_SLACK` (24) for any of this
to mean anything — 150px of drift is five times the handoff, so the careful spot was decoration.
That is safe because `advanceSmartMove`'s `exact: true` appends a literal `move` to the coordinates
(strategic_smart_move.21.js), so the merchant lands on the spot rather than near it.

`parent.character.merrit` is the authority when it still goes wrong — `.reasons[]` carries the
server's own codes (`area`, `closed`, `listing`, `inventory`, `warming`, `cooldown`, `npc`,
`stand_close`, `stand_front`, `unreachable`), refreshed by
`socket.emit("interaction", {type: "merrit_info"})`. A receipt also fires the CODE event
`character.on("merrit", ...)` with `{item: "marketparcel", quantity: 1, shells}`.

The parcel itself is an ordinary `e: 1` gem with no `quest` field, so it exchanges like `gem0` — from
a computer, no NPC trip — which is why its `EXCHANGE_QUEUE` entry needs no `npc`. Exchanging rolls
`G.drops.marketparcel`: mostly `scroll0`/`cscroll0`/`seashell`/`leather`, with `offeringp` at 0.4%
and five 0.022% Merrit exclusives (`duskweavehood`, `caravanbrigandine`, `mirrorsteelgauntlet`,
`ironheelboots`, `tollkeeperspike`).

## The anniversary visit is a ticket, not a boss (2026-09-07)

`server.status.anniversary` features one player per 30-minute round and hands everyone else a
five-minute `anniversary_visit` condition. Spending it is `use_skill("ikissyou", state.id)` within
`G.skills.ikissyou.range` (80) of them — no attack, no monster, so it can't be a `bossConfigs` entry
or a target. Both hooks therefore commit *no target* — the fighter one owns the tick with
`return true` so nothing walks back to the farming spot behind it — and both are placed **last**:
any live boss outranks it, including one the merchant already committed to
(`getEventToJoin()` keeps `currentEventName` while it lives, which is what the merchant's guard
reads).

**The condition is the "have we kissed yet" flag.** The kiss consumes it, so `canAnniversaryVisit()`
is both the eligibility test and the done test — no separate bookkeeping, and nothing to reset
between rounds. It mirrors the client's `anniversary_can_visit()` field for field, and every one of
those fields earns its place: `ticket.round == state.round` stops a ticket carrying into the next
round, and `ticket.realm == \`${server.region} ${server.id}\`` (**with the space** — unlike
`getCurrentRealm()`'s `${region}${id}`) stops a hop from making a foreign ticket look spendable.
`state.available === false` means the host walked somewhere unreachable; the round's timer keeps
running, so the check is skip-this-tick, not give-up.

**The destination is a player, so it moves.** `state.x`/`state.y` is only where the round announced
them, and a pathfind plans against wherever they stood when it started — arriving is not the same as
being in range. So `visitAnniversaryPlayer` **holds until the kiss lands** rather than taking one
approach per tick: a single pass ends at the spot the host has just walked off, and the caller would
set off again from scratch next tick, forever. Each pass re-reads the entity and picks a half: off
screen, `advanceSmartMove` to the announced spot; on screen, the repo's `can_move_to` → `move` /
else pathfind idiom against the live `real_x`/`real_y`.

The loop needs no give-up timer of its own — the ticket is the timer, since `hasAnniversaryVisitToMake()`
heads every pass and goes false on a landed kiss, a five-minute expiry, and a host who steps out of
reach alike. What it does need is for **every branch to await**: standing inside
`ANNIVERSARY_SEARCH_RADIUS` of the announced spot with nobody in sight, and waiting out the 10s
`ikissyou` cooldown, both poll on `ANNIVERSARY_RETRY_MS` instead of re-pathing to a place we are
already standing. `character.rip` is the other exit: dying mid-chase would otherwise keep walking a
corpse. Note the cost of holding — a priest on a chase is not healing, which is the other reason
the hook sits behind every boss.

The `use_skill` call is not the confirmation — a rejected one just leaves the ticket standing and the
next tick retries. `is_on_cooldown("ikissyou")` (10s) is what stops a fast loop from spamming sends
into the window between the kiss and the condition clearing.

The merchant's `visitAnniversary` takes the plain `onDuty` lock rather than `acquireEventDuty()`:
the duty is what makes `goMining`/`goFishing`/`moveHome` yield for the walk, while the event duty
would also set `isFightingBoss` and swap in the dartgun for a trip with nothing to shoot.

## One definition of a weak mob

The thresholds live in basic_function.7.js next to the other config (`HARMLESS_MOB_DAMAGE`,
`FORMIDABLE_MOB_DAMAGE`, `TRIVIAL_MOB_MAX_HP`, `SHOT_DAMAGE_MARGIN`); the predicates live in
strategic_fn.11.js. Three distinct questions were previously answered by ad-hoc arithmetic in the
ranger, priest, mage and gear code:

- `isDyingToOurShot(mob, multiplier)` — does it die to one shot of this scaling? The multiplier is
  what supershot (1.5) and splash (`explosion / 100`) pass in.
- `isHarmlessMob(mob)` — is it too puny to plan around at all (`1hp`, trivial max_hp, negligible dps)?
- `isWeakMob(mob, multiplier)` — a free target: dying to our shot, or already someone else's problem.

Note the damage thresholds are **dps**, not per-hit: `calculateDamage` multiplies by `frequency`.
Mixing in a per-hit number (the ranger's old `character.attack * 0.6`, still in basic_archer.3.js)
is comparing different units.

Weakness that is genuinely class-specific stays local: `MAGE_WEAK_MOB_TYPES` /
`WARRIOR_WEAK_MOB_TYPES` are named event mobs, not a computed property. The mage's pinkie swap no
longer guesses from `max_hp` either — it asks `canOneShotWithWeapon` with the pinkie actually
carried, the same question the ranger asks when picking a bow.

## Levelled craft ingredients (`CRAFT_LEVEL_TARGETS`, merchant_craft.18.js)

A `G.craft` recipe entry is `[quantity, name, level?]`. The third element was ignored: `craft()`
matched ingredients by name only and filtered bank slots to `!item.level`, so a recipe like
t2quiver's `[1, "alloyquiver", 5]` could never be satisfied — the `+5` was invisible on both sides
of the check.

Meanwhile `upgradeInv`/`compoundInv` have no notion of a wanted level. They push toward the highest
level they can reach and skip everything in `IGNORE` (which swallows all of `BUYABLE`), so the two
halves worked against each other: the ingredient the craft needed was either never lifted, or lifted
straight past the level the recipe pinned.

`CRAFT_LEVEL_TARGETS` (`name -> { [level]: quantity }`) is the handshake between them. Keying by
level rather than holding one `{ level, quantity }` pair is load-bearing in two ways.

It keeps sibling recipes apart. `threadneedle` wants `blade +5`, `brinefang` wants `+7`, `wblade`
wants `+9`; a single pair taking the deepest of the three would strand threadneedle behind a climb it
never needed. Each level stands on its own, and `getCraftTargetLevel` (the deepest key) is what caps
the climb.

And it makes level 0 expressible, which is what protects the plain items. `[1, "staff"]` in the
pickaxe recipe registers `staff: { 0: 1 }`; add `gstaff` and it becomes `staff: { 0: 1, 8: 1 }` —
`countCraftStockNeeded` sums to two staves, `countSpareAtLevel` reserves the plain one, and the climb
buys and consumes the other. Reservations are why `upgradeInv` and `compoundInv` check
`countSpareAtLevel` before spending a copy: an item at a level someone is holding is not fuel.

`craft()` is the only writer:

- ingredient already on hand at that level → pull the exact-level copies from the bank, craft fires.
  The entry is deliberately *not* released: having reached the level, it becomes the reservation that
  stops a deeper climb of the same item from eating it;
- not on hand but reachable → the registration stands, and the craft fails *this tick* while the
  upgrade and compound routines do the climbing;
- not reachable → `releaseCraftLevel` drops that one level (siblings survive), craft fails for good.

`hasFlatIngredient` counts inventory at level 0 only, matching the filter the bank side always had.
The asymmetry it replaces was unreachable before targets existed — nothing was ever above `+0` while
`IGNORE` held — but with a climb in flight, an unfiltered count let `craft("pickaxe")` hand a
half-climbed `staff +5` to `auto_craft`.

Everything else reads the map: upgrade/compound bypass `IGNORE` for a targeted name, stop at
`target.level` instead of chasing max, and take priority over the ordinary lowest-level pick;
`retrievedBankItemToUpgrade` pulls targeted stock ahead of its count-based rotation and ignores
`KEEP_THRESHOLD` for it; a level-0 reservation alone never bypasses `IGNORE` (`isCraftTargeted` asks
for a level above 0) — it only withholds copies from being consumed; `bankStoreRoutine` won't ship a half-climbed ingredient back to the bank;
the `SALE_ABLE` sweep won't sell one (`shield` is in both `BUYABLE` and `SALE_ABLE`, so a bought
target would otherwise be sold back the same tick).

### Reachability is measured in level-0 equivalents

`countCraftStock` weighs a compound item as `3 ** level`, because a compound eats three items per
level — one `+2` really is worth nine `+0`. Upgrades consume one item per attempt, so there every
copy counts as one. `countCraftStockNeeded` mirrors it. The subtraction of the two is the shortfall,
and the shortfall is what decides feasibility: covered by stock, or buyable within `MAX_CRAFT_BUY`
(27, i.e. a compound pyramid three levels deep), or the target is released.

This is why a deep compound target self-releases rather than draining gold: `3 ** 5 = 243` is past
the cap on the first check, before a single purchase.

Upgrades get no such pricing, deliberately. One owned copy is one attempt's worth whatever the target
level, so `wblade`'s `[1, "blade", 9]` stays feasible off a single vendor blade and the merchant
re-buys after every break. That is the intended trade: the scroll grade tracks the item's grade, not
its level, so a grade-0 blade climbs on `scroll0` the whole way and the retry costs ~1k gold a go.
What it does spend is upgrade tempo — targeted items outrank everything in `upgradeInv`, so a deep
climb starves ordinary upgrading until the craft lands or the target is released.

Counting deliberately reads `BANK_CACHE` directly (`forEachOwnedItem`) instead of going through
`getItemBankSlots`, whose rare-grade filter drops grade >= 2 items whenever gold is under
`IGNORE_RARE_GOLD_THRESHOLD`. `worldrootcrook`'s `harbringer +8` is exactly that case: the filter
would hide the finished ingredient sitting in the bank, and the merchant would register a target and
start climbing a second one. `getItemBankSlots` grew an `includeRare` flag for the target paths that
still use it.

### `craftQuantity` is a ceiling, not a demand (`getCoveredCraftQuantity`, 2026-08-25)

The call sites size a batch off free inventory space — `craft("firestars", character.esize - 6, …)`
— meaning *at most this many*, so the merchant can't craft itself out of slots. The ingredient
check reads it as a demand instead: it asks for `quantity * craftQuantity` of everything and is
all-or-nothing. Two throwing stars and a batch of six therefore crafted **nothing**, silently,
rather than the two that were possible — the more free space the merchant had, the less it could
craft.

`craft()` now clamps the batch to `getCoveredCraftQuantity` before the checks run: the floor of
owned-over-required across the recipe's flat ingredients. Buyable entries are skipped (a vendor
tops those up, bounded by `MAX_CRAFT_BUY`), and so are levelled ones — registering a target for an
ingredient we *don't* have yet is exactly what starts the climb, so letting one bound the batch
would stall it. For the same reason a covered quantity of 0 leaves `craftQuantity` alone and falls
through to the old path: the checks still run, the climbs still register, the craft still fails
this tick.

Counting goes through `countItemsAtLevel` (inventory + `BANK_CACHE`, no rare filter), and
`hasFlatIngredient`'s bank count now passes `includeRare` to match. The two must agree — a clamp
that sees a rare bank ingredient while the check that follows it does not would arrive at a batch
size the craft then refuses. The reasoning is the one already recorded above for
`forEachOwnedItem`: an ingredient we own is stock, not loot to be shielded while gold is low.

`craftQuantity < 1` replaced `!craftQuantity` as the guard. A merchant with fewer free slots than
the offset passes a negative batch, which slipped past the falsy check, ran the whole ingredient
machinery — registering targets, buying base items — and then crafted zero times through a `for`
loop that never entered.

### Sorting must not run between picking a slot and spending it (`pendingItemMutations`)

`upgradeInv` picks `itemIndex` from a scan, then awaits `ensureScroll` (which can retrieve from
the bank or `buy`) and `ensureOffering`, and only then calls `upgrade(itemIndex, ...)`.
`compoundInv` has the same gap between `findCompoundSet` and `compound(...)`. Meanwhile `sortInv`
issues real `swap()` calls that permute slots, and it is dispatched from the same unlocked 750ms
tick — so it can start during those awaits and move the item out from under the pending call.

The rejection is mostly silent rather than destructive: the server revalidates item details and
answers `mismatch` or `no_item` (see the `upgrade` contract), and both call sites end in
`.catch(() => {})`. So the observable symptom was upgrade/compound throughput quietly stalling,
with nothing in the logs.

`isSortingInventory` alone doesn't close it — it only stops `sortInv` re-entering *itself*, and
the dangerous window is `sortInv` starting *after* the slots were picked. The fix is a pair:

- `upgradeInv`/`compoundInv` refuse to start while `isSortingInventory`, and each wraps its body
  (`findAndUpgrade`/`findAndCompound`) in `pendingItemMutations++` / `finally --`.
- `sortInv` refuses to start while `pendingItemMutations` is non-zero.

**A count, not a flag.** The two run concurrently by design — they are dispatched together in the
tick's `Promise.allSettled`, and they never contend for the same item because an item is either
compoundable or upgradeable, not both. A boolean would have serialised them for no reason.

The bodies had to be split into separate `findAnd*` functions so the `try/finally` wraps every
exit from a loop full of `continue`/`break`/`return`, and the inner `return await` is load-bearing
— returning the promise unawaited would drop the count before the mutation settled.

### Targeted climbs never burn a primling

`isRareItem` is forced false for a targeted item in both `upgradeInv` and `compoundInv`. A break on
the way to a craft ingredient costs one more base item — which the next tick re-buys or re-registers
— whereas an offering spent to protect it is gone either way. The same reasoning suppresses the
post-upgrade `storeToBankFloor`: a targeted item mid-climb belongs in the inventory, and its
`ITEMS_HIGHEST_LEVEL` entry is often absent (it was `IGNORE`d until the target existed), which would
have made `e.level >= (highest ?? 0) - 1` true for every single level.

### `KEEP_THRESHOLD` is not a rare-item rule (`compoundInv`, debugged 2026-09-07)

Symptom: `cloverstud: 16` in `KEEP_THRESHOLD`, an empty bank, five `+0` studs in the bag — and the
merchant compounded three of them. `compoundInv` hung its threshold check off `isRareItem`, which is
`item.level >= grades[0]`; `cloverstud` grades are `[1,5,6,7]`, so a `+0` copy is grade 0 and the
whole check was skipped. Every compoundable is grade 0 at `+0`, so the tail was only ever protected
once a pile had already climbed a level — the opposite of what a keep threshold is for.

`isRareItem` answers "is this worth a primling", nothing more, and it is *also* forced false for a
targeted climb. Gating the threshold on it therefore conflated three questions. The check now keys
off `!targeted`, matching `upgradeInv`'s `haveEnoughToSpare`, which never had the rare condition.

The `+ 3` is the difference from the upgrade side: an upgrade risks one copy, a compound spends
three for one, so the pile has to clear the threshold *by a set* or the compound lands under it.
(The old `getKeepThreshold(itemName) + 3 ?? 5` fallback was dead — `+` binds tighter than `??`, and
`getKeepThreshold` already defaults to 2.)

### `map` before `every`

`craft()` builds `isEnoughIngredients` with `.map(...).every(Boolean)` rather than `.every(...)`.
A short-circuit at the first unsatisfied ingredient would skip the level check on every later one,
so their targets would never be registered and their climb would never start.
