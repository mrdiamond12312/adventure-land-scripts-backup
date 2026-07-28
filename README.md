https://github.com/user-attachments/assets/402680b8-5bb8-4e6a-95fb-9ea3e0189850

# Adventure Land's Scripts

This repository is a backup of my automation scripts for fighters and merchants of [Adventure Land - The Code MMORPG](https://adventure.land/)

## How Fighters work

- Accepting party invitation from leader
- Finding desired target (declared in `basic_function`)
- `smart_move` to target farming location if not in sight
- Select a target nearby through `getTarget()` -- this will choose the leader's target if he's in sight
- Attack and use skills (specific for each class in `basic_*`)
- Buff potions (hp and mana)
- Equip elixir (set your desired elixir in `basic_function`)
- Buff the team (for Priest)
- Kiting (please set `rangeRate` for each class in their file to set the distance of kiting)
- Sending requirements and needs to merchant (through code-message (cm in short) in `basic_function`)
- Listening for cm
- Go to bosses and events and fight it if any exists

## How Merchant works

- Listening for cm (if the inventory is full or the merchant has another ongoing duty, these cm will be ignored)

  - To buy potion/desired elixir and deliver it to fighters
  - To collect items from fighters if they're out of space in inventory
  - To buff `mcluck`

- Automating (This won't be counted as duty; the cm listener is now the top priority)

  - Move back to town and open the vendor if there's no action at the moment (current location at `main` near the compounding bench for the convenience of doing other things at the `main` map)
  - Exchange exchangables at Xyn
  - Selling items from the `sellAble` array defined in `basic_function`
  - Upgrade upgradables to +8, and if their tier is below `rare` or 2
  - Compound compoundables to +3, and if their tier is below `rare` or 2
  - [22/12/2024] The merchant will now go to the `bank` when the code is engaged, and every 2 minutes later, to cache the bank and save the highest level of every item that exists in `character.bank[slots]` and `character.items`, with its repetition for that level, to decide whether or not to upgrade/compound items with level > 8 or tier >= 2, only if there are more than 300000000 gold in the account
  - [22/12/2024] As the merchant goes to the bank, it also checks and takes out a number of the same item, which has the most count, sorted from the lowest level of that item, to upgrade/compound. These items will be stored back at the bank on the next visit to the bank

- Automating (This will be counted as duty for efficiency)

  - Auto mining (smart move to `mine` map) -- ignore if no `pickaxe` in inventory
  - Auto fishing (smart move to `main` near the sea) -- ignore if no `rod` in inventory
  - Auto exchange `gemsfragment` (smart move to `mine` near the jeweler)

- `holidayseason` or xmas event automating (These scripts haven't been completely tested and are very inefficient but are still good to use; these are not counted as duty)

  - `smart_move` to desired NPC to exchange `mistletoe`, `candycane`, `ornament`
  - `smart_move` to Leo in `main` to exchange the 9 pieces for `xbox`

## What has changed since the first version [28/07/2026]

The loop above is still the skeleton, but most of the decisions moved out of the `basic_*` files and
into shared ones, so the classes stopped keeping their own copies of the same logic

- Farming strategies can be swapped at runtime -- `currentStrategy` gets reassigned by
  `changeToPullStrategies()` / `changeToNormalStrategies()` in `basic_function`, and everyone just calls
  `currentStrategy()`

  - `normal_strategy` -- fight whatever is in front of you
  - `pull_strategy` -- monster stacking. The tanker `agitate`/`taunt`s mobs into one pile, but only while
    the healer can keep up with the damage, and it will not pull anything that `burn`s or `stone`s
  - `crypt_strategy` -- crypt runs, moving junction by junction and remembering what is already dead

- Gears are picked every tick from the whole inventory instead of holding one weapon (`strategic_fn`) --
  luck gear when a monster is nearly dead, exp gear when it is worth it, splash weapons only when the
  blast is clean, blaster/cleave swaps for the warrior. All swaps go through `equipBatch` so they do not
  waste the `penalty_cd`
- Area attacks check what they would *wake up* first (`hasUntargetedMonsterAround`). A monster nobody is
  holding yet is a monster you are about to aggro, and the ones that `burn` or `stone` never count as
  harmless
- Skills run on their own loops now (`runSkillLoop`) instead of one big `fight()` per class -- `canUse`
  decides and `cast` acts, and a skill can opt in to firing while smart moving with `whileMoving`
- Movement was rewritten (`strategic_smart_move` / `advance_smart_move`) -- it tracks the move as a
  session it can cancel, uses the mage for `blink`/magiport when he is online, and recovers from the
  stuck cases the escape scripts below only patched over
- The ranger can hold `cupid` and heal the party with it, without fighting itself over the mainhand while
  there are still monsters to shoot
- Server hopping (`server_hop`) -- checks `parent.S` and the aldata API for a boss worth going to, loots
  first, hops, then comes back home
- The merchant does field work too (`merchant_service`) -- opening crypt instances, luring the mecha
  gnome, and dragging ents back to where the party farms with a dartgun
- Everything runs both in the in-game CODE editor and headless under `caracAL` (`parent.caracAL`), which
  can run the whole party from one place

## Extra scripts for Leaders (`partyMems[0]` in `basic_function` files)

- Send party invites to other members in `partyMems`

## Some exception escape scripts for fighters (these will be executed every 1s)

- Leave the `jail` (sometimes you get in jail if a ping spike happens; this will interact with the jailor in this map you got sent into)
- `smart_move` to target if out of range (sometimes you get stuck when kiting; this will help)
- Teleport to the primary point of the map when stuck in some obstacle, which makes `smart_move` return `path_not_found`

## Reading the code

- `CLAUDE.md` -- my conventions for refactoring and testing here: how files load each other (every file
  is named `<name>.<CODE slot>.js` and pulls its dependencies in with `load_code` /
  `caracAL.load_scripts`), what depends on what, and where the config is allowed to live. There is no
  build or test runner in this repo, so testing a change means reading it and running it in the game
- `REFERENCE.md` -- why the odd-looking parts are the way they are: kiting math, the merchant duty lock,
  cooldown compensation, equip batching, splash safety, the shape of each class's skill loops

> [!NOTE]
> These scripts are implemented by myself; please observe the code carefully and be responsible for loss if anything happens to your game resource.
> I do use Claude Code as a pair for refactoring and for keeping `REFERENCE.md` honest, but the strategies and the game knowledge in here are mine.
> If you have any issues or improvement ideas, make a PR or send an issue ticket; I will be there in my free time!
> Have fun playing!

> Under Development
>
> - ~~Monster stacking strategy~~ -- done, see `pull_strategy`
> - ~~Change gears for fighters on condition (luck gear for drops when monster nearly die, and base on strategy)~~ -- done, see `strategic_fn`
> - Gimme more ideas...
