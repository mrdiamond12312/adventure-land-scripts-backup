// Other class message listener;

character.on("cm", async function ({ name, message }) {
  switch (message) {
    case "inv_full_merchant_near":
      log("The merchant is nearby, sending compoundable");

      await Promise.all(
        character.items.forEach(async (item, index) => {
          if (!item) return;
          if (
            item.level > 0 ||
            ["tracker", "hpot1", "mpot1"].includes(item.name)
          )
            return;
          await send_item(partyMerchant, index, 1000);
        })
      );
      // const compoundables = filterCompoundableAndStackable();
      // const others = Array.from({ length: 42 }, (_, i) => i + 0).filter(
      //   (i) =>
      //     compoundables.indexOf(i) < 0 &&
      //     character.items[i]?.name &&
      //     !["tracker", "hpot1", "mpot1"].includes(character.items[i].name)
      // );
      // await Promise.all(
      //   compoundables.map(async (index) => {
      //     await send_item(partyMerchant, index, 1000);
      //   })
      // );
      // await Promise.all(
      //   others.map(async (index) => {
      //     await send_item(partyMerchant, index, 1000);
      //   })
      // );
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

    default:
      log(`Unidentified MsgCode: ${message}`);
  }
});
