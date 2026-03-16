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
    close_stand();
  } else return;

  equipBroom();

  switch (message.msg) {
    case "inv_full":
      log(`Go collecting ${name} compoundables at ${message.map}`);
      await advanceSmartMove({
        ...message,
      });
      send_cm(name, "inv_full_merchant_near");
      await sleep(5000);
      onDuty = false;
      break;

    case "buy_mana":
      log(`Buying some mana potions for ${name}`);
      if (isInvFull()) {
        if (!smart.moving) await smart_move(bankPosition);
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
      break;

    case "buy_hp":
      log(`Buying some health potions for ${name}`);
      if (isInvFull()) {
        if (!smart.moving) await smart_move(bankPosition);
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

    case "elixir":
      if (locate_item(message.elixir) === -1) {
        await retrieveBankItem(message.elixir);

        if (locate_item(message.elixir) === -1) {
          await smart_move({ map: find_npc("wbartender").map });
          await buy(message.elixir);
        }
      }
      if (locate_item(message.elixir) === -1) {
        onDuty = false;
        break;
      }
      await advanceSmartMove({
        ...message,
      });
      await send_item(name, locate_item(message.elixir), 10);
      onDuty = false;
      break;

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
        onDuty = false;
        break;
      }

      await advanceSmartMove({
        ...message,
      });
      await send_item(name, locate_item("xptome"), 1);
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

var isLuringMobs = false;
const trustedPartners = ["earthPriest", "earthWar"];

async function lureMechaGnome() {
  if (
    isLuringMobs ||
    onDuty ||
    isAdvanceSmartMoving ||
    smart.moving ||
    serverCurrentlyHasLiveEvent() ||
    (!(
      parent.party_list &&
      trustedPartners.some((name) => parent.party_list.includes(name))
    ) &&
      !parent.caracAL.siblings.includes(PRIEST))
  ) {
    return setTimeout(lureMechaGnome, 500);
  }

  // Global flags to prevent other tasks from interrupting
  onDuty = true;
  isLuringMobs = true; // Prevent scareAwayMobs

  let nextDelay = 500;

  try {
    close_stand();
    await advanceSmartMove({ map: "cyberland" });
    await sleep(character.ping);

    const gnomesNearby = Object.values(parent.entities).filter(
      (entity) =>
        entity && entity.type === "monster" && entity.mtype === "mechagnome",
    );

    if (!gnomesNearby.length) {
      nextDelay = 45_000;
      throw new Error("No mechagnome found");
    } else nextDelay = 150_000;

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
    }, 1e4);
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
