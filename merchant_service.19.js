character.on("cm", async function ({ name, message }) {
  if (isInvFull()) {
    return;
  }

  if (onDuty) return;
  onDuty = true;

  try {
    equipBroom();

    switch (message.msg) {
      case "inv_full":
        console.warn(`Go collecting ${name} compoundables at ${message.map}`);
        await advanceSmartMove(message);
        send_cm(name, "inv_full_merchant_near");
        await sleep(5000);
        break;

      case "buy_mana":
        console.warn(`Buying some mana potions for ${name}`);
        if (locate_item("mpot1") === -1) {
          await advanceSmartMove({ map: "main", x: 56, y: -122 });
          await buy("mpot1", 9899);
        }
        await advanceSmartMove(message);
        await send_item(name, locate_item("mpot1"), 10000);
        send_cm(name, "buy_mana_merchant_near");
        await sleep(5000);
        break;

      case "buy_hp":
        console.warn(`Buying some health potions for ${name}`);
        if (isInvFull()) {
          await bankStoreRoutine();
        }
        if (locate_item("hpot1") === -1) {
          await advanceSmartMove({ map: "main", x: 56, y: -122 });
          await buy("hpot1", 9899);
        }
        await advanceSmartMove(message);
        await send_item(name, locate_item("hpot1"), 10000);
        send_cm(name, "buy_hp_merchant_near");
        await sleep(5000);
        break;

      case "buff_mluck":
        await advanceSmartMove(message);
        if (!is_on_cooldown("mluck") && character.mp > 20) {
          use_skill("mluck", get_entity(name));
        }
        break;

      case "elixir": {
        const elixirToDeliver = message.elixir;
        if (locate_item(elixirToDeliver) === -1) {
          const merchantThatSellNeededElixir =
            findVendorMerchantOf(elixirToDeliver);
          if (getItemBankSlots(elixirToDeliver, true).length) {
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
        console.warn(`Buying Tome of Protection for ${name}`);

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

        await advanceSmartMove(message);
        await send_item(name, locate_item("xptome"), 1);
        break;

      default:
        console.warn(`Unidentified '${message.msg}'`);
    }
  } finally {
    onDuty = false;
  }
});

async function openCryptInstance() {
  try {
    if (onDuty || isAdvanceSmartMoving || smart.moving) {
      return;
    }

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
  } finally {
    onDuty = false;
  }
}

var isLuringMobs = false;
var isDraggingMobs = false;
const trustedPartners = ["earthPriest", "earthWar"];

async function lureMechaGnome() {
  let nextDelay = 1000;

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
    return setTimeout(lureMechaGnome, nextDelay);
  }

  try {
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

async function dragEnt() {
  let equipping = false;
  const ensureDartgun = async () => {
    if (character.slots.mainhand?.name === "dartgun" || equipping) return;
    equipping = true;
    try {
      let slot = findMaxLevelItem("dartgun");
      if (slot === -1 || slot == null) {
        await retrieveBankItem("dartgun");
        slot = findMaxLevelItem("dartgun");
      }
      if (slot === -1 || slot == null) throw new Error("No dartgun available!");
      await equip(slot);
    } finally {
      equipping = false;
    }
  };

  const LURE_DESTINATION = { x: mapX, y: mapY, map: "desertland" };
  const AIM_POINT = { x: -75, y: -1897 };
  const FIRST_ANCHOR = { x: 136, y: -1836 };
  const SCARE_BUFFER = 1.5;
  const TICK = 10;

  let dartgunRange; // scoped locally instead of implicit global

  if (
    isLuringMobs ||
    onDuty ||
    isAdvanceSmartMoving ||
    smart.moving ||
    shouldGoChilling()
  ) {
    return;
  }

  try {
    onDuty = true;
    isLuringMobs = true;
    isDraggingMobs = true;

    // --- 1. First equip, then define the range ---
    await ensureDartgun();
    dartgunRange = character.range + character.xrange * 0.8;

    // --- 2. Go to the ents ---
    await advanceSmartMove("ent");

    let ent = get_nearest_monster({ type: "ent" });
    const entId = ent.id;
    if (!ent) throw new Error("No Ent found!");

    // --- 2b. Position at dartgunRange, on the AIM_POINT side of the ent ---
    const dx = AIM_POINT.x - ent.x;
    const dy = AIM_POINT.y - ent.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len > 0) {
      const standPoint = {
        x: ent.x + (dx / len) * dartgunRange,
        y: ent.y + (dy / len) * dartgunRange,
      };
      await move(standPoint.x, standPoint.y).catch(() =>
        smart_move(standPoint),
      );
    }

    // --- 3. Aggro (loop UNTIL it targets us) ---
    while (!ent.rip && ent.target !== character.name) {
      const d = distance(character, ent);
      if (!is_on_cooldown("attack") && d <= dartgunRange) {
        await attack(ent).catch(() => {});
      } else if (d > dartgunRange) {
        await move(
          character.x + (ent.x - character.x) * 0.1,
          character.y + (ent.y - character.y) * 0.1,
        ).catch(() => {});
      }
      await sleep(TICK);
    }
    if (ent.dead) throw new Error("Ent died before aggro — lure aborted.");

    // --- 4. Kite it to the destination ---
    isAdvanceSmartMoving = true;
    let arrived = false;
    const waypoints = [
      FIRST_ANCHOR,
      { x: 196, y: -1641 },
      { x: 199, y: -1125 },
      { x: 85, y: -1035 },
      { x: -187, y: -620 },
      { x: -496, y: -620 },
      { x: -757, y: -302 },
    ];

    //move(FIRST_ANCHOR.x, FIRST_ANCHOR.y) .then(() => advanceSmartMove(LURE_DESTINATION, { useScare: false, useMagiport: false, useBlink: false, speed: 500 })) .then(() => { arrived = true; isAdvanceSmartMoving = false; });

    waypoints
      .reduce(
        (p, { x, y }) =>
          p.then(() =>
            move(x, y).catch((e) => {
              console.warn("move failed", x, y, e);
              throw e;
            }),
          ),
        Promise.resolve(),
      )
      .then(() => {
        arrived = true;
        isAdvanceSmartMoving = false;
      });

    // --- 5. While walking: heal + scare + re-aggro ---
    // cruise(24);
    await new Promise((resolve) => {
      const step = async () => {
        const ent = parent.entities[entId];
        if (arrived || !ent || character.rip) {
          console.warn("breaking the loop");
          return resolve();
        }
        const d = distance(character, ent);
        console.warn(d);
        if (
          d < G.monsters.ent.range * SCARE_BUFFER &&
          !ms_to_next_skill("scare")
        ) {
          console.warn("scaring ent!");
          await withTimeout(use_skill("scare"), 300)
            .then(() => reduce_cooldown("scare", character.ping * 0.95))
            .catch((e) => console.warn(e, "scare"));
        }

        if (
          !ent.target &&
          d <= character.range + character.xrange * 0.1 &&
          d > character.range * 0.85 &&
          !is_on_cooldown("attack")
        ) {
          await withTimeout(attack(ent), 300).catch((e) =>
            console.warn(e, "attack"),
          );
        }

        setTimeout(step, TICK);
      };
      step();
    });

    console.warn("loop ended", arrived, ent?.id);
    if (ent.rip) game_log("Ent died mid-lure.", "orange");
    else game_log("Lure complete!", "green");
  } catch (e) {
    console.warn(`Lure failed: ${e.message}`, "red");
  } finally {
    isDraggingMobs = false;
    isLuringMobs = false;
    isAdvanceSmartMoving = false;
    onDuty = false;
    // cruise(500);
  }
}

if (!parent.caracAL) {
  lureMechaGnome();
}
