character.on("cm", async function ({ name, message }) {
  if (isInvFull()) {
    return;
  }

  switch (message) {
    case "inv_ok":
      onDuty = false;
      break;
  }

  if (!onDuty) {
    onDuty = true;
  } else return;

  try {
    equipBroom();

    switch (message.msg) {
      case "inv_full":
        log(`Go collecting ${name} compoundables at ${message.map}`);
        await advanceSmartMove({
          ...message,
        });
        send_cm(name, "inv_full_merchant_near");
        await sleep(5000);
        break;

      case "buy_mana":
        log(`Buying some mana potions for ${name}`);
        if (isInvFull()) {
          if (!smart.moving) await smart_move(bankPosition);
          if (character.map === "bank") bank_store(0);
        }
        if (locate_item("mpot1") === -1) {
          await advanceSmartMove({ map: "main", x: 56, y: -122 });
          await buy("mpot1", 9899);
        }
        await advanceSmartMove({
          ...message,
        });
        await send_item(name, locate_item("mpot1"), 10000);
        send_cm(name, "buy_mana_merchant_near");
        await sleep(5000);
        break;

      case "buy_hp":
        log(`Buying some health potions for ${name}`);
        if (isInvFull()) {
          if (!smart.moving) await smart_move(bankPosition);
          if (character.map === "bank") bank_store(0);
        }
        if (locate_item("hpot1") === -1) {
          await advanceSmartMove({ map: "main", x: 56, y: -122 });
          await buy("hpot1", 9899);
        }
        await advanceSmartMove({
          ...message,
        });
        await send_item(name, locate_item("hpot1"), 10000);
        send_cm(name, "buy_hp_merchant_near");
        await sleep(5000);
        break;

      case "buff_mluck":
        await advanceSmartMove({
          ...message,
        });
        if (!is_on_cooldown("mluck") && character.mp > 20) {
          use_skill("mluck", get_entity(name));
        }
        onDuty = false;
        break;

      case "elixir": {
        const elixirToDeliver = message.elixir;
        if (locate_item(elixirToDeliver) === -1) {
          const merchantThatSellNeededElixir =
            findVendorMerchantOf(elixirToDeliver);
          if (getItemBankSlots(elixirToDeliver).length) {
            await retrieveBankItem(message.elixir);
          } else if (merchantThatSellNeededElixir) {
            if (!haveAComputer())
              await advanceSmartMove({
                map: find_npc(merchantThatSellNeededElixir).map,
              });
            await buy(message.elixir);
          } else {
            break;
          }
        }

        if (locate_item(message.elixir) === -1) {
          break;
        }

        await advanceSmartMove({
          ...message,
        });
        await send_item(name, locate_item(message.elixir), 10);
        break;
      }

      case "xptome":
        if (!partyMems.includes(name)) break;
        log(`Buying Tome of Protection for ${name}`);

        if (locate_item("xptome") === -1) {
          await retrieveBankItem("xptome");

          if (locate_item("xptome") === -1) {
            await smart_move(find_npc("premium"));
            await buy("xptome");
          }
        }

        if (locate_item("xptome") === -1) {
          break;
        }

        await advanceSmartMove({
          ...message,
        });
        await send_item(name, locate_item("xptome"), 1);
        break;

      default:
        log(`Unidentified '${message.msg}'`);
    }
  } finally {
    onDuty = false;
  }
});

async function openCryptInstance() {
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

var isLuringMobs = false;
const trustedPartners = ["earthPriest", "earthWar"];

async function lureMechaGnome() {
  let nextDelay = 500;
  try {
    if (
      isLuringMobs ||
      onDuty ||
      isAdvanceSmartMoving ||
      smart.moving ||
      shouldGoChilling() ||
      serverCurrentlyHasLiveEvent() ||
      (!(
        parent.party_list &&
        trustedPartners.some((name) => parent.party_list.includes(name))
      ) &&
        !parent.caracAL.siblings.includes(PRIEST))
    ) {
      return;
    }

    // Global flags to prevent other tasks from interrupting
    onDuty = true;
    isLuringMobs = true; // Prevent scareAwayMobs

    await advanceSmartMove({ map: "cyberland" });
    await sleep(character.ping);

    const gnomesNearby = Object.values(parent.entities).filter(
      (entity) =>
        entity && entity.type === "monster" && entity.mtype === "mechagnome",
    );

    if (gnomesNearby.length < 3) {
      nextDelay = 45_000;
      throw new Error("Gnome not fully spawned");
    } else nextDelay = 110_000;

    const mageResponse = await waitUntil(() => {
      const mageInfo = get("mageLocation");
      if (!mageInfo) return false;
      return (
        mageInfo.mp >= G.skills["magiport"].mp + 100 &&
        Date.now() - mageInfo.time < 15_000 &&
        distance(mageInfo, { map: map, x: mapX, y: mapY }) < 300
      );
    }, 10_000);

    if (!mageResponse) {
      nextDelay = 15_000;
      throw new Error("Mage did not have mana / not online");
    }

    parent.socket.emit("eval", { command: "mooooooh" });
    await advanceSmartMove(get("mageLocation"), { useScare: false });
    await sleep(character.ping);
    await waitUntil(() => {
      const partnerNearby =
        trustedPartners.some((name) => get_player(name)) || get_player(HEALER);

      if (!partnerNearby) return true;

      for (const id in parent.entities) {
        const entity = parent.entities[id];
        if (
          entity &&
          entity.mtype === "mechagnome" &&
          entity.target === character.name
        ) {
          return false;
        }
      }

      return true;
    }, 10_000);
  } catch (e) {
    console.error(e);
  } finally {
    isLuringMobs = false;
    onDuty = false;
    setTimeout(lureMechaGnome, nextDelay);
  }
}

if (!parent.caracAL) {
  lureMechaGnome();
}
