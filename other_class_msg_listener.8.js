// Other class message listener;

character.on("cm", async function ({ name, message }) {
  if (
    !partyMems.includes(name) &&
    name !== partyMerchant &&
    message !== "magiport"
  )
    return;
  switch (message.msg || message) {
    case "inv_full_merchant_near":
      log("The merchant is nearby, sending compoundable");

      await Promise.all(
        character.items.map(async (item, index) => {
          if (!item) return;
          if (
            item.level > 0 ||
            [
              "tracker",
              "hpot1",
              "mpot1",
              "cdragon",
              "oxhelmet",
              "snowball",
              "spookyamulet",
              "xptome",
              "xpbooster",
              "goldbooster",
              "luckbooster",
              "suckerpunch",
            ].includes(item.name)
          )
            return;
          await send_item(partyMerchant, index, 9999);
        }),
      );
      send_cm(partyMerchant, "inv_ok");
      break;

    case "buy_mana_merchant_near":
      log("Thanks for the potions merchant!");
      send_gold(partyMerchant, 1500000);
      break;

    case "buy_hp_merchant_near":
      log("Thanks for the potions merchant!");
      send_gold(partyMerchant, 1500000);
      break;

    case "party_heal":
      log(`Remotely heal ${name}!`);
      use_skill("partyheal").then(() =>
        reduce_cooldown("partyheal", character.ping * 0.95),
      );
      break;

    case "magiport":
      if (character.mp > G.skills["magiport"]?.mp) {
        use_skill("magiport", name);
      }
      break;

    case "dc-harakiri":
      midasLooting();
      parent.socket.emit("harakiri");
      break;

    case "loot-before-hopping":
      midasLooting(true);
      parent.socket.emit("harakiri");
      break;

    default:
      console.warn(`Unidentified MsgCode: ${message}`);
  }
});
