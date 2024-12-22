https://github.com/user-attachments/assets/72960f03-5e0e-4f7e-bf1a-898976337af7

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

## Extra scripts for Leaders (`partyMems[0]` in `basic_function` files)

- Send party invites to other members in `partyMems`

## Some exception escape scripts for fighters (these will be executed every 1s)

- Leave the `jail` (sometimes you get in jail if a ping spike happens; this will interact with the jailor in this map you got sent into)
- `smart_move` to target if out of range (sometimes you get stuck when kiting; this will help)
- Teleport to the primary point of the map when stuck in some obstacle, which makes `smart_move` return `path_not_found`

> [!NOTE]
> These scripts are implemented by myself; please observe the code carefully and be responsible for loss if anything happens to your game resource.
> If you have any issues or improvement ideas, make a PR or send an issue ticket; I will be there in my free time!
> Have fun playing!

> Under Development
>
> - Monster stacking strategy
> - Change gears for fighters on condition (luck gear for drops when monster nearly die, and base on strategy)
> - Gimme more ideas...
