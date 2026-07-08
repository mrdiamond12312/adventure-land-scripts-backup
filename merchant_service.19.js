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

function isMyPriestOnline() {
  return parent.caracAL.siblings.includes(PRIEST);
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
      !isMyPriestOnline())
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

//// Ent luring — runs as its own scheduler, same shape as lureMechaGnome above.
// Ents are very tanky and effectively never die while being dragged, so there's
// no dead/alive branching here — the lure either completes or gets aborted on error.
const ENT_LURE_MAP = "desertland";
const ENT_AIM_POINT = { x: -75, y: -1897 };
const ENT_FIRST_ANCHOR = { x: 136, y: -1836 };
const ENT_SCARE_BUFFER = 1.5;
const ENT_TICK = 10;

function getEntLureDestination() {
  return { x: mapX, y: mapY, map: ENT_LURE_MAP };
}

function getEntWaypoints() {
  return [
    ENT_FIRST_ANCHOR,
    { x: 196, y: -1641 },
    { x: 199, y: -1125 },
    { x: 85, y: -1035 },
    { x: -187, y: -620 },
    { x: -496, y: -620 },
    getEntLureDestination(),
  ];
}

// The mage sits near spawn and reports whether an ent is already engaged with the
// party there (see mageLocation.entTargetingParty in basic_mage.4.js) — avoids
// starting a second lure while one is already in progress at home.
function isEntAlreadyEngagedAtSpawn() {
  const mageInfo = get("mageLocation");
  return !!(
    mageInfo &&
    Date.now() - mageInfo.time < 15_000 &&
    mageInfo.entTargetingParty
  );
}

async function ensureDartgun() {
  if (findMaxLevelItem("dartgun") === -1) await retrieveBankItem("dartgun");
  if (findMaxLevelItem("quiver") === -1) await retrieveBankItem("quiver");

  await equipBatch(calculateMerchantEquipments());
}

async function positionAtEntAimPoint(entId, dartgunRange) {
  let ent = parent.entities[entId];

  // Re-derive the stand point every tick (not just once) since the ent can drift
  // before we're in position, and keep retrying until we're actually there.
  while (ent) {
    const dx = ENT_AIM_POINT.x - ent.x;
    const dy = ENT_AIM_POINT.y - ent.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) break;

    const standPoint = {
      x: ent.x + (dx / len) * dartgunRange,
      y: ent.y + (dy / len) * dartgunRange,
    };

    if (distance(character, standPoint) < 20) break;

    if (!isMyPriestOnline()) {
      throw new Error("Priest went offline mid-lure — aborting.");
    }

    await move(standPoint.x, standPoint.y).catch(() => smart_move(standPoint));
    await sleep(ENT_TICK);
    ent = parent.entities[entId];
  }

  if (!ent) throw new Error("Ent disappeared before positioning — lure aborted.");
}

async function aggroEnt(entId, dartgunRange) {
  let ent = parent.entities[entId];
  while (ent && ent.target !== character.name) {
    if (!isMyPriestOnline()) {
      throw new Error("Priest went offline mid-lure — aborting.");
    }

    const d = distance(character, ent);
    if (!is_on_cooldown("attack") && d <= dartgunRange) {
      await attack(ent).catch(() => {});
    } else if (d > dartgunRange) {
      await move(
        character.x + (ent.x - character.x) * 0.2,
        character.y + (ent.y - character.y) * 0.2,
      ).catch(() => {});
    }
    await sleep(ENT_TICK);
    ent = parent.entities[entId];
  }

  if (!ent) throw new Error("Ent disappeared before aggro — lure aborted.");
}

async function walkEntToSpawn(entId) {
  let arrived = false;

  getEntWaypoints()
    .reduce(
      (currentPromiseChain, { x: nextX, y: nextY }) =>
        currentPromiseChain.then(() =>
          move(nextX, nextY).catch((e) => {
            console.warn("move failed", nextX, nextY, e);
            throw e;
          }),
        ),
      Promise.resolve(),
    )
    .then(() => {
      arrived = true;
    });

  await new Promise((resolve, reject) => {
    const step = async () => {
      const ent = parent.entities[entId];
      if (arrived || !ent || character.rip) return resolve();
      if (!isMyPriestOnline()) {
        return reject(new Error("Priest went offline mid-lure — aborting."));
      }

      const d = distance(character, ent);
      if (
        d < G.monsters.ent.range * ENT_SCARE_BUFFER &&
        !ms_to_next_skill("scare")
      ) {
        await withTimeout(use_skill("scare"), 300)
          .then(() => reduce_cooldown("scare", character.ping * 0.95))
          .catch(() => {});
      }

      if (
        !ent.target &&
        d <= character.range + character.xrange * 0.1 &&
        d > character.range * 0.85 &&
        !is_on_cooldown("attack")
      ) {
        await withTimeout(attack(ent), 300).catch(() => {});
      }

      setTimeout(step, ENT_TICK);
    };
    step();
  });
}

async function dragEnt() {
  let nextDelay = 15_000;

  if (
    map !== ENT_LURE_MAP ||
    isLuringMobs ||
    onDuty ||
    isAdvanceSmartMoving ||
    smart.moving ||
    shouldGoChilling() ||
    serverCurrentlyHasLiveEvent() ||
    !isMyPriestOnline() ||
    isEntAlreadyEngagedAtSpawn()
  ) {
    return setTimeout(dragEnt, nextDelay);
  }

  try {
    onDuty = true;
    isLuringMobs = true;
    isDraggingMobs = true;
    // Tell the rest of the party we're actively dragging this in — see
    // getMonstersOnDeclares() in basic_function.7.js, which skips declaring it
    // as a farm target while it's still being walked in from elsewhere.
    set("luringMobType", "ent");

    await ensureDartgun();
    const dartgunRange = character.range + character.xrange * 0.8;

    await advanceSmartMove({ ...ENT_FIRST_ANCHOR, map: ENT_LURE_MAP });

    const ent = get_nearest_monster({ type: "ent" });
    if (!ent) throw new Error("No Ent found!");

    await positionAtEntAimPoint(ent.id, dartgunRange);
    await aggroEnt(ent.id, dartgunRange);
    await walkEntToSpawn(ent.id);

    nextDelay = 90_000; // lured successfully, give it a while before going again
  } catch (e) {
    console.warn(`Ent lure failed: ${e.message}`);
    nextDelay = 30_000;
  } finally {
    isDraggingMobs = false;
    isLuringMobs = false;
    onDuty = false;
    set("luringMobType", undefined);
    setTimeout(dragEnt, nextDelay);
  }
}

if (!parent.caracAL) {
  lureMechaGnome();
  dragEnt();
}
