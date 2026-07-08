# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Automation ("bot") scripts for [Adventure Land — The Code MMORPG](https://adventure.land/), a game whose
official "CODE" editor lets players control a character with JavaScript running in-browser. The server-side
game logic these scripts play against lives at https://github.com/kaansoral/adventureland_mongodb (useful
for checking exact game mechanics/constants, e.g. `G` data or skill formulas, but is not part of this repo).

This repo is one git submodule inside a larger local project, `caracAL`, which is a Node/Electron-based
runner that can load and execute these same scripts headlessly (outside the real browser CODE editor) against
multiple accounts/characters at once. Do not assume access to or edit anything outside this folder — this
CLAUDE.md only covers the script sources here.

There is no build, lint, or test tooling in this folder — no `package.json`, bundler, or test runner. Files
are plain scripts written directly against the Adventure Land in-game API (`character`, `parent`, `G`,
`smart_move`, `use_skill`, `send_cm`, etc.) and, when run under `caracAL`, against that runner's shims.
Verifying a change means reading it carefully and/or running it against the game (via `caracAL` or by pasting
into a character's CODE slot) — there's nothing to `npm test`.

## Loading model — read this first

Every file's filename ends in `.<N>.js` where `N` is a **CODE slot number** (an Adventure Land CODE editor
slot). This is not decorative — `N` is how other scripts reference and load this file, both in-game and in
`caracAL`.

Scripts don't `require()`/`import` each other (`require("../config")` in `basic_function.7.js` is the one
exception, guarded in a `try/catch` since it only resolves under the `caracAL` runner, not in-browser).
Instead, every file that needs another file's functions/globals loads it dynamically at the top of the file,
in one of two equivalent forms depending on environment:

```js
if (parent.caracAL) {
  parent.caracAL.load_scripts([
    "adventure-land-scripts-backup/basic_function.7.js",
    "adventure-land-scripts-backup/other_class_msg_listener.8.js",
  ]).then(() => {
    mainLoop(); // kick off after dependencies are actually loaded
  });
} else {
  load_code(7); // native in-game CODE call, by slot number
  load_code(8);
}
```

`load_code`/`load_scripts` execute the target file's top-level code into the *same* global scope — so
functions and `var`/`let` globals defined in a loaded file become directly available, unqualified, in the
loading file (e.g. `getTarget()`, `rangeRate`, `partyMems` are defined once in `basic_function.7.js` and used
everywhere else with no import). When editing a shared file, remember every loader transitively gets your
change; when adding a new shared helper, add it where the files that need it already load from, don't invent
a new load edge unless you also add the `load_scripts`/`load_code` call at every call site.

Because `caracAL` and the real in-game editor resolve slot numbers differently, **always keep both branches
of the `if (parent.caracAL) { load_scripts(...) } else { load_code(...) }` pattern in sync** — same set of
files/slots in both.

## File tree & dependency graph

Entry-point scripts are the ones actually pasted into a character's CODE slot in-game; everything else is a
shared library pulled in transitively.

```
basic_function.7.js          [SHARED — the core library]
  loaded by every fighter entry script AND merchant_crafting.10.js;
  itself loads, based on class/config:
    strategic_fn.11.js           combat math: damage/heal calc, gear selection, cleave/blast targeting
    normal_strategy.12.js        \_ farming strategy variants, swapped via
    pull_strategy.13.js          /  changeToPullStrategies()/changeToNormalStrategies()
    server_hop.14.js             server-hopping automation (only if caracALconfig enables the character)
    crypt_strategy.16.js         crypt-specific movement/strategy
    strategic_smart_move.21.js   \_ pathing layered on top of
    advance_smart_move.20.js     /  the native smart_move

other_class_msg_listener.8.js [SHARED] cross-class code-message (cm) listener, loaded alongside basic_function.7.js
                               by every fighter entry script

Fighter entry scripts (one pasted per character's CODE slot):
  basic_warrior.9.js    basic_priest.2.js    basic_mage.4.js
  basic_archer.3.js     basic_ranger.32.js   basic_rogue.31.js
  solo_ranger.15.js     (solo/no-party variant of ranger)
  each: loads 7 + 8, then defines its own fight()/mainLoop() and class-specific skill rotation

Merchant entry script:
  basic_merchant.5.js    loads merchant_crafting.10.js + merchant_service.19.js, then
                          syncBankData() -> bankLoop() -> lureMechaGnome()
    merchant_crafting.10.js  upgrading/compounding/crafting logic (also loads basic_function.7.js)
    merchant_service.19.js   duty fulfillment for fighters' cm requests (potions, elixir, item pickup),
                              crypt-opening, mob luring/dragging helpers

Standalone / auxiliary (not wired into the load graph above, used directly or ad hoc):
  basic_with_regen.s.1.js   minimal regen-only script (note the "s.1" slot naming, distinct from "N")
  bank_sort.49.js           bank inventory sorting utility
  sort_inv.6.js             character inventory sorting utility
  crypt_strategy.16 - Copy.js  backup/scratch copy of crypt_strategy.16.js — not loaded by anything
  archive.60.js             graveyard of commented-out/retired snippets, kept for reference only
```

## Conventions

- **Config lives at the top of `basic_function.7.js`.** Party roster (`partyMems`), per-character role
  constants (`MAGE`, `WARRIOR`, `PRIEST`, `RANGER`, `TANKER`, `HEALER`), the `CODE_SLOTS` map (character name
  → home server + slot), farming location (`map`/`mapX`/`mapY`), `mobsToFarm`, and `desiredElixir` are all
  hand-edited here before (re)deploying scripts to a party. Several alternate map/location blocks are kept
  commented out immediately below the active one — follow that pattern (comment out the old location, don't
  delete it) when switching farming spots.
- **Cross-character coordination happens over code-messages (`cm`)**, via `send_cm(targetName, { msg, ...})`
  / the `on_cm`-style listener in `other_class_msg_listener.8.js`. Message `msg` types already in use include
  `buff_mluck`, `inv_full`, `buy_mana`, `buy_hp`, `elixir`, `xptome`, `dc-harakiri` — reuse these rather than
  inventing near-duplicates when a fighter needs something from the merchant.
- **`parent.caracAL` is the environment switch.** Nearly every cross-file load, and some behavioral branches
  (e.g. server hopping only runs `if (!character.controller)` under native CODE), check
  `if (parent.caracAL) { ... } else { ... }` to pick between the `caracAL` runner's API and the native
  in-browser CODE API (`load_code`, ...). Preserve this branching in new code that needs to run in both
  environments — don't hard-code one path.
- **Filenames are `<descriptive_name>.<slot_number>.js`.** When adding a new shared/loadable script, pick an
  unused slot number consistent with `CODE_SLOTS`/existing `load_code` call sites, and update every loader
  that should pull it in (both the `load_scripts` array and the `load_code` fallback).
- Strategy swapping uses feature-flag-style globals rather than branching call sites: e.g.
  `currentStrategy` is reassigned by `changeToPullStrategies()` / `changeToNormalStrategies()`
  (`basic_function.7.js`), and callers just invoke `currentStrategy()`.
