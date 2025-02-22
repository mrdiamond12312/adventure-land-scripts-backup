var isAdvanceSmartMoving = false;
const ALIA_POSITION = {
  winterland: {
    map: "winterland",
    x: -8,
    y: -337,
  },
  main: {
    map: "main",
    x: -85,
    y: -389,
  },
  desertland: {
    map: "desertland",
    x: 10,
    y: -386,
  },
};

const ALIA_FROM_POSITION = {
  ...ALIA_POSITION,
  halloween: {
    map: "halloween",
    x: -94,
    y: -266,
  },
};

function getCharacter(name) {
  for (const iframe of top.$("iframe")) {
    const char = iframe.contentWindow.character;
    if (!char) continue; // Character isn't loaded yet
    if (char.name == name) return char;
  }
}

async function scareAwayMobs() {
  if (
    (locate_item("jacko") || character.slots["orb"] === "jacko") &&
    Object.values(parent.entities).some(
      (mob) => mob?.target === character.name && mob?.type === "monster"
    ) &&
    !is_on_cooldown("scare") &&
    character.mp > 100
  ) {
    await equipBatch({
      orb: "jacko",
    });
    await use_skill("scare");
  }
}

async function mageBlink(map, coordinates, useCoordinates = true) {
  if (
    character.mp > G.skills["blink"].mp &&
    !is_on_cooldown("blink") &&
    character.map === map &&
    coordinates.length === 2 &&
    distance(character, { x: coordinates[0], y: coordinates[1] }) > 300
  ) {
    log("Blink to " + coordinates);
    return await use_skill("blink", coordinates).then(() =>
      reduce_cooldown("blink", character.ping * 0.7)
    );
  }

  if (useCoordinates) {
    log("omg");
    return smart_move({
      map,
      x: coordinates[0],
      y: coordinates[1],
    });
  }
  return await smart_move({
    map,
  });
}

function useNearbySmartMove() {
  smart.edge = 300;
  smart.baby_edge = 300;
  smart.try_exact_spot = false;
}

function resetSmartMove() {
  smart.edge = 20;
  smart.baby_edge = 80;
  smart.try_exact_spot = true;
}

async function advanceSmartMove(props) {
  try {
    useNearbySmartMove();
    await scareAwayMobs();
    const scareInterval = setInterval(() => {
      scareAwayMobs();
    }, 5000);

    if (isAdvanceSmartMoving) return;
    log("Advance Smart Move!");
    isAdvanceSmartMoving = true;
    if (!props.map) props.map = character.map;

    if (character.ctype === "mage") {
      // Get Alia Positions
      log("I'm a Archmage, I can blink");
      const aliaFrom = ALIA_FROM_POSITION[character.map];
      const aliaTo = ALIA_POSITION[props.map];

      // If moving in current map
      if (props.map === character.map) {
        await mageBlink(character.map, [props.x, props.y]);
        log("Blinked!");
        await sleep(character.ping);
        isAdvanceSmartMoving = false;
        log("Done!");
        return smart_move(props).then(() => resetSmartMove());
      }

      // If 2 destination have Alia
      else if (aliaFrom && aliaTo) {
        // Move to current map's Aria
        log("Found Arias on destination and current map, blinking");
        await mageBlink(aliaFrom.map, [aliaFrom.x, aliaFrom.y]);
        await sleep(1200);
        log("Next map");
        // Transport to next map
        await smart_move(aliaTo);

        // await transport()

        log("Moving towards destination");
        // Blink to location if enough mana
        await mageBlink(aliaTo.map, [props.x, props.y]);
        await sleep(character.ping + 800);
        isAdvanceSmartMoving = false;
        return smart_move(props).then(() => resetSmartMove());
      }

      // If one of the 2 maps has no Alia
      else {
        const checkingMapInterval = setInterval(() => {
          if (character.map === props.map) {
            stop("smart");
            clearInterval(checkingMapInterval);
          }
        }, 1000);

        await smart_move({ map: props.map });
        await mageBlink(props.map, [props.x, props.y]);
        await sleep(character.ping);
        isAdvanceSmartMoving = false;
        return smart_move(props).then(() => resetSmartMove());
      }
    } else {
      const mageEntity = getCharacter(MAGE);
      log("Asking for a miracle, may be magiport?");
      if (
        mageEntity &&
        mageEntity.map === props.map &&
        distance(props, mageEntity) < 300 &&
        mageEntity.mp > G.skills["magiport"].mp &&
        !get_entity(MAGE)
      ) {
        send_cm(MAGE, "magiport");
        await smart_move(props);
        log("Whoosh!");
        isAdvanceSmartMoving = false;
        resetSmartMove();
        return;
      } else {
        const checkingMageMagiportInterval = setInterval(async () => {
          let mageEntityUpdate = getCharacter(MAGE);
          if (
            mageEntityUpdate &&
            mageEntityUpdate.map === props.map &&
            distance(props, mageEntityUpdate) < 300 &&
            mageEntityUpdate.mp > G.skills["magiport"].mp &&
            !get_entity(MAGE)
          ) {
            send_cm(MAGE, "magiport");
            log("Whoosh!");
            clearInterval(checkingMageMagiportInterval);
          }
        }, 1000);
        await smart_move(props);
        clearInterval(checkingMageMagiportInterval);
        isAdvanceSmartMoving = false;
        resetSmartMove();
        return;
      }
    }
  } catch (e) {
    isAdvanceSmartMoving = false;
    resetSmartMove();
    if (e.reason === "failed" && e.failed) use_skill("use_town");
    if (e.reason !== "interrupted") {
      isAdvanceSmartMoving = false;
    }
    clearInterval(scareInterval);
  }
  
  isAdvanceSmartMoving = false;
  clearInterval(scareInterval);
  resetSmartMove();
}
