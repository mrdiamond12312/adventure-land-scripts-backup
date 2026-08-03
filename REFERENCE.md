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
- **The 5-minute watchdog interval is a leak-recovery safety net, not a scheduler.** It only
  exists for the case where a reset was somehow still missed, and it deliberately skips the
  reset while `isLuringMobs`/`isDraggingMobs` is set — lures/drags move with plain `move()`, so
  `smart.moving`/`isAdvanceSmartMoving` read false during them and the duty lock is the *only*
  thing keeping `bankLoop` and friends from smart-moving away mid-drag.
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

## Gnome luring: why the merchant must not scare (`lureMechaGnome`, merchant_service.19.js)

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

## Ent luring (`dragEnt`, merchant_service.19.js)

Self-rescheduling loop on the merchant, same shape as `lureMechaGnome`. Goes and aggroes a wild
`ent` with a dartgun (long range, low commitment), then walks it home along a fixed waypoint path
so the tanker can pick it up at the farm spot (see above) instead of the whole party having to
travel out to it. A run can bring back up to `MAX_CONCURRENT_ENT` of them (see below).

Guards before/during a run:
- Only runs at all while farming `desertland` (`map === ENT_LURE_MAP`).
- Skips if already busy (`onDuty`/`isLuringMobs`/smart-moving/chilling), a live server event is
  running, or the field report says `MAX_ENT` ents are already engaged with the party at spawn
  (`hasMaxEntsEngagedAtSpawn`, see "Field reports must fail closed") — avoids double-luring.
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
- Scare fires if **any** tracked ent is inside the buffer; the handoff/arrival check requires
  **every** tracked ent handed off (or the 10s deadline) before the run resolves.

`positionAtEntAimPoint`/`aggroEnt` still operate on the seed ent only — the extra ents are picked
up during the walk, not at the aim point.

## Self-rescheduling loop discipline (`dragEnt`/`lureMechaGnome`, merchant_service.19.js)

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

Unrelated hang risks noted but not yet addressed: `aggroEnt`/`positionAtEntAimPoint` have no
deadline and no `character.rip` check (can spin forever chasing an ent that targets someone
else, or after the merchant dies); `walkEntsToSpawn`'s inner `step()` schedules its next tick as
its last line, so an unexpected throw mid-step leaves the wrapping promise unsettled (hang +
leaked locks); a failed waypoint `move()` in `walkPromise` silently strands the step loop
holding aggro with no overall lure timeout.

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
  aggroes it. `isEventTanked` prefers the local entity's `target` over `parent.S[name].target`
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
  **The reach it scans with is computed, not read** (`getAttackWeaponReach`, merchant_service.19.js
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
  first: `hasVisitedBank` (merchant_crafting.10.js, set at the end of `bankLoop`'s first run) is in
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
  measure `changeToDailyEventTargets` sorts on — mrgreen/mrpumpkin in particular overlap. The
  local entity's hp beats the `parent.S` copy once we're on the map, and an event reporting no hp
  reads as full so it never jumps the queue by accident. Unlike the fighters, though, re-picking
  costs the merchant a **whole map trip**, so `currentEventName` only loses its slot when another
  boss is `EVENT_SWITCH_MARGIN` (15pp) lower — two bosses melting in lockstep would otherwise
  leave the merchant commuting instead of shooting. `releaseEventDuty` clears the commitment.
- **The home\boss ping-pong, second cause (debugged 2026-08-03).** Same symptom at franky, one
  layer earlier than the `isMerchantBusy` fix above: `shouldJoin` for the tanked bosses is
  `isEventTanked`, which reads the boss' *momentary* `target`. A boss between targets — franky
  retargets constantly, and its adds pull aggro — reads untanked for a tick, `getEventToJoin()`
  returns undefined, `fightCurrentEvent` releases the duty, and the main loop walks home before
  the next tick re-acquires. The `?? eventInfo.target` fallback doesn't save it: the `parent.S`
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
- **`lootIfSolo`** runs every tick, floored at `LOOT_INTERVAL`. `midasLooting` (basic_function.7.js)
  is a party arrangement — it defers to whoever carries handofmidas and never has the merchant
  open anything — so a partyless merchant would otherwise leave its own chests on the ground.
- The loop is self-rescheduling with the reschedule as the last statement of `finally`, per
  "Self-rescheduling loop discipline". A guard-blocked tick releases duty (it owns the check) and
  just waits `EVENT_IDLE_TICK`.

## Crabxx targeting keys off the shell, not the crabx (`changeToDailyEventTargets`)

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
Mixing in a per-hit number (the ranger's old `character.attack * 0.6`, still in basic_archer.3.js
and solo_ranger.15.js) is comparing different units.

Weakness that is genuinely class-specific stays local: `MAGE_WEAK_MOB_TYPES` /
`WARRIOR_WEAK_MOB_TYPES` are named event mobs, not a computed property. The mage's pinkie swap no
longer guesses from `max_hp` either — it asks `canOneShotWithWeapon` with the pinkie actually
carried, the same question the ranger asks when picking a bow.
