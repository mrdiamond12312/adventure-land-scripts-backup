https://github.com/user-attachments/assets/72960f03-5e0e-4f7e-bf1a-898976337af7

# Adventure Land's Scripts

This repository backup automation scripts for fighters and merchant of this [game](https://adventure.land/)

## How Fighters works

- Accepting party invitation from leader
- Finding desired target (declared in `basic_function`)
- `smart_move` to target farming location if not in sight
- Select a target nearbe through `getTarget()` -- this will choose the leader's target if he's in sight
- Attack and use skills (specific for each class in `basic_*`)
- Buff potions (hp and mana)
- Equip elixir (set your desired elixir in `basic_function`)
- Buff the team (for Priest)
- Kiting (please set rangeRate for each class in their file to set the distance of kiting)
- Sending requiry and needs to merchant (through code-message (cm in short) in `basic_function`)
- Listening for cm
- Go to bosses and events and fight it if any exists

## How Merchant works

- Listening for cm (if the inventory is full or have another ongoing duty, these cm will be ignore)

  - For buying potion/desired elixir and deliver to fighters
  - For collecting items from fighters if they're out of space in inventory
  - For buffing `mcluck`

- Automating (This won't be counted as duty, the cm listener is now the priority)

  - Move back town and open vendor if there's no action at the moment (current location at `main` near compounding bench for the convenence of doing other things at `main` map)
  - Upgrade upgradables to +8 and if their tier is below `rare` or 2
  - Compound compoundables to +3 and if their tier is below `rare` or 2
  - Exchange exchangables at Xyn
  - Selling items from `sellAble` array defined in `basic_function`

- Automating (This will be counted as duty for efficiency)

  - Auto mining (smart move to `mine` map) -- ignore if no `pickaxe` in inventory
  - Auto fishing (smart move to `main` near the sea) -- ignore if no `rod` in inventory
  - Auto exchange `gemsfragment` (smart move to `mine` near the jeweler)

- `holidayseason` or xmas event automating (These script haven't been completely tested and is very unefficient, but still good to use, these are not counted as duty)
  - `smart_move` to desired npc to exchange `mistletoe`, `candycane`, `ornament`
  - `smart_move` to Leo in `main` to exchange the 9 pieces for `xbox`

## Extra scripts for Leaders (`partyMems[0]` in `basic_function` files)

- Send party invites to other members in `partyMems`

## Some exception escape scripts for fighters (these will be executed every 1s)

- Leave the `jail` (sometime you get in jail if ping-spike happens, this will interact with the jailor in this map you got send into)
- `smart_move` to target if out of range (sometimes you get stuck when kiting, this will help)
- Teleport to basic point of the map when stuck in some obstacle, which makes `smart_move` return `path_not_found`

> [!NOTE]
> These script are implemented myself, please be observe the code carefully and be responsible for loss if anything happens to your game resource.
> If any issues or improvements that you can suggest, make a PR or send an issue ticket, I will be there in my freetime!
> Have fun playing!

> To be Developed
>
> - New merchants upgrade and compound script (to upgrade them after the limit of 8 and 3)
> - More to be configured...
