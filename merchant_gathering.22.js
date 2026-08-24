// Gathering: fishing, mining and dismantling, plus the gear they need.

async function equipBroom() {
  const currentWeapon = character.slots.mainhand;
  if (!currentWeapon || currentWeapon.name !== "broom") {
    const broom = findMaxLevelItem("broom");
    if (broom === -1) await retrieveBankItem("broom");
    return equipBatch({
      mainhand: "broom",
      offhand: "wbookhs",
    });
  }
}

function shouldGoChilling() {
  return (
    (!is_on_cooldown("fishing") &&
      (locate_item("rod") !== -1 ||
        character.slots.mainhand?.name === "rod")) ||
    (!is_on_cooldown("mining") &&
      (locate_item("pickaxe") !== -1 ||
        character.slots.mainhand?.name === "pickaxe")) ||
    character.c.mining ||
    character.c.fishing
  );
}

async function goFishing() {
  if (
    isInvFull() ||
    smart.moving ||
    isAdvanceSmartMoving ||
    character.c.mining ||
    character.c.fishing ||
    is_on_cooldown("fishing") ||
    onDuty
  )
    return;

  const rodItemId = "rod";
  const availableRodsInBank = getItemBankSlots(rodItemId);

  if (
    availableRodsInBank.length > 0 &&
    character.slots.mainhand?.name !== rodItemId &&
    !isInvFull(2) &&
    locate_item(rodItemId) === -1
  ) {
    return retrieveBankItem(rodItemId);
  }

  if (
    locate_item(rodItemId) === -1 &&
    character.slots.mainhand?.name !== rodItemId &&
    availableRodsInBank.length === 0 &&
    !isInvFull(4)
  ) {
    return craft(rodItemId);
  }

  if (
    character.slots.mainhand?.name !== rodItemId &&
    locate_item(rodItemId) === -1
  )
    return;

  if (
    character.real_x != fishingLocation.x ||
    character.real_y != fishingLocation.y ||
    character.map !== fishingLocation.map
  ) {
    await equipBroom();
    await advanceSmartMove(fishingLocation, {
      useBlink: false,
      useMagiport: false,
      exact: true,
    });
  }

  if (character.mp > 120) {
    log("Fishin!");
    return Promise.all([
      equipBatch({
        mainhand: rodItemId,
        offhand: undefined,
      }),
      use_skill("fishing"),
    ]);
  }
}

async function goMining() {
  if (
    isInvFull() ||
    smart.moving ||
    isAdvanceSmartMoving ||
    character.c.mining ||
    character.c.fishing ||
    is_on_cooldown("mining") ||
    onDuty
  )
    return;

  const pickaxeItemId = "pickaxe";
  const availablePickaxesInBank = getItemBankSlots(pickaxeItemId, true);

  if (
    availablePickaxesInBank.length > 0 &&
    character.slots.mainhand?.name !== pickaxeItemId &&
    !isInvFull(2) &&
    locate_item(pickaxeItemId) === -1
  ) {
    return retrieveBankItem(pickaxeItemId);
  }

  if (
    locate_item(pickaxeItemId) === -1 &&
    character.slots.mainhand?.name !== pickaxeItemId &&
    availablePickaxesInBank.length === 0 &&
    !isInvFull(4)
  ) {
    return craft(pickaxeItemId);
  }

  if (
    character.slots.mainhand?.name !== pickaxeItemId &&
    locate_item(pickaxeItemId) === -1
  )
    return;

  if (
    character.real_x != miningLocation.x ||
    character.real_y != miningLocation.y ||
    character.map !== miningLocation.map
  ) {
    await equipBroom();
    await advanceSmartMove(miningLocation, {
      useBlink: false,
      useMagiport: false,
      exact: true,
    });
  }

  if (character.mp > 120) {
    log("Mining!");
    return Promise.all([
      equipBatch({
        mainhand: pickaxeItemId,
        offhand: undefined,
      }),
      use_skill("mining"),
    ]);
  }
}

async function dismantleSomething() {
  if (
    onDuty ||
    isInvFull(4) ||
    smart.moving ||
    isAdvanceSmartMoving ||
    character.c.mining ||
    character.c.fishing ||
    isSortingInventory ||
    Math.max(...parent.pings) > 300
  )
    return;

  const itemToDismantle = DISMANTLE_LIST.find((id) => locate_item(id) !== -1);
  if (!itemToDismantle) return;

  if (get_nearest_npc()?.name !== "Leo" && !haveAComputer()) {
    await advanceSmartMove(find_npc("craftsman"));
  }

  return dismantle(locate_item(itemToDismantle));
}
