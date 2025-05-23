character.on("cm", async function ({ name, message }) {
  if (isInvFull()) {
    return;
  }
  switch (message) {
    case "inv_ok":
      onDuty = false;
      moveHome();
      break;
  }
  if (!onDuty) {
    onDuty = true;
    close_stand();
  } else return;

  equipBroom();
  // const sender = get_characters().find(character => character.name === name);

  switch (message.msg) {
    case "inv_full":
      log(`Go collecting ${name} compoundables at ${message.map}`);
      await advanceSmartMove({
        ...message,
      });
      send_cm(name, "inv_full_merchant_near");
      await sleep(5000);
      onDuty = false;
      moveHome();
      break;

    case "buy_mana":
      log(`Buying some mana potions for ${name}`);
      if (isInvFull()) {
        if (!smart.move) await smart_move(bankPosition);
        if (character.map === "bank") bank_store(0);
      }
      if (locate_item("mpot1") === -1) {
        await smart_move(find_npc("fancypots"));
        await buy("mpot1", 9899);
      }
      await advanceSmartMove({
        ...message,
      });
      await send_item(name, locate_item("mpot1"), 10000);
      send_cm(name, "buy_mana_merchant_near");
      await sleep(5000);
      onDuty = false;
      moveHome();
      break;

    case "buy_hp":
      log(`Buying some health potions for ${name}`);
      if (isInvFull()) {
        if (!smart.move) await smart_move(bankPosition);
        if (character.map === "bank") bank_store(0);
      }
      if (locate_item("hpot1") === -1) {
        await smart_move(find_npc("fancypots"));
        await buy("hpot1", 9899);
      }
      await advanceSmartMove({
        ...message,
      });
      await send_item(name, locate_item("hpot1"), 10000);
      send_cm(name, "buy_hp_merchant_near");
      await sleep(5000);
      onDuty = false;
      moveHome();
      break;

    case "buff_mluck":
      await advanceSmartMove({
        ...message,
      });
      if (!is_on_cooldown("mluck") && character.mp > 20) {
        use_skill("mluck", get_entity(name));
      }
      onDuty = false;
      moveHome();
      break;

    case "elixir":
      if (locate_item(message.elixir) === -1) {
        let itemBankSlot = undefined;
        let itemSlot = undefined;
        await smart_move(bankPosition);
        Object.keys(character.bank)
          .filter((id) => id !== "gold")
          .map((slot) => {
            character.bank[slot]?.map((item, index) => {
              if (item && item.name === message.elixir) {
                itemBankSlot = slot;
                itemSlot = index;
              }
            });
          });
        if (itemBankSlot && itemSlot) {
          bank_retrieve(itemBankSlot, itemSlot);
        } else {
          await smart_move({ map: find_npc("wbartender").map });
          buy(message.elixir);
        }
      }
      if (!locate_item(message.elixir)) {
        onDuty = false;
        break;
      }
      await advanceSmartMove({
        ...message,
      });
      await send_item(name, locate_item(message.elixir), 10);
      onDuty = false;
      break;

    default:
      onDuty = false;
      log(`Unidentified '${message.msg}'`);
  }
});

async function openCryptInstance() {
  close_stand();
  onDuty = true;
  if (locate_item("cryptkey") === -1) {
    await retrieveBankItem("cryptkey");
    await sleep(1000 + character.ping);

    if (locate_item("cryptkey") === -1) {
      return;
    }
  }

  await smart_move(CRYPT_DOOR);
  await enter("crypt");

  set("cryptInstance", character.in);
  set("lastCryptInstance", new Date());
  set("cryptDefeatedMobs", []);
  set("lastSeenDefeatableCryptBoss", undefined);

  onDuty = false;
  return;
}
