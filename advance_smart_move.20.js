// Global vars and Constants
var isAdvanceSmartMoving = false;

const CRYPT_DOOR = {
  map: "cave",
  x: -191,
  y: -1304,
};

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

const CELL = Object.freeze({
  unknown: 0,
  unstandable: -1,
  standable: 1,
});
const GRID_CACHE = {};

// Utils

/**
 * @author earthiverse
 *
 * Only use within DOM environment to search for character's ifram
 * @param {string} name Character's ID
 * @returns
 */
function getCharacter(name) {
  for (const iframe of top.$("iframe")) {
    const char = iframe.contentWindow.character;
    if (!char) continue; // Character isn't loaded yet
    if (char.name == name) return char;
  }
}

if (parent.caracAL && parent.caracAL.ALPathfinder) {
  parent.caracAL.ALPathfinder.prepare(parent.G);
}

/**
 * Generates and caches a grid object for the target map on cache miss.
 * TODO: Account for mob spawn points as additional standable seeds.
 *
 * @version 20251227vCow
 * @param {string} mapString - The target map ID
 * @returns {Object} Grid data including standability map and map boundaries
 */
function getGrid(mapString) {
  if (GRID_CACHE[mapString]) return GRID_CACHE[mapString];
  const data = parent.G.geometry[mapString];
  const { min_x, min_y, max_x, max_y, x_lines, y_lines, points } = data;
  const mapMobs = parent.G.maps[mapString].monsters;
  const mapSpawns = mapMobs
    .filter((p) => !p.boundaries && p.boundary)
    .reduce((acc, current) => {
      acc.push([
        (current.boundary[0] + current.boundary[2]) / 2,
        (current.boundary[1] + current.boundary[3]) / 2,
      ]);
      return acc;
    }, []);

  // Init Array for Grid coloring
  const gridWidth = Math.ceil(max_x - min_x);
  const gridHeight = Math.ceil(max_y - min_y);
  const mapGrid = new Int8Array(gridWidth * gridHeight);
  mapGrid.fill(CELL.unknown);

  // Color Boundaries with CELL.unstandable
  for (const yLine of y_lines) {
    const y = Math.round(yLine[0] - min_y);
    const fromX = Math.max(0, Math.round(yLine[1] - min_x));
    const toX = Math.min(gridWidth - 1, Math.round(yLine[2] - min_x));
    for (let x = fromX; x <= toX; x++) {
      if (y >= 0 && y < gridHeight)
        mapGrid[y * gridWidth + x] = CELL.unstandable;
    }
  }

  for (const xLine of x_lines) {
    const x = Math.round(xLine[0] - min_x);
    const fromY = Math.max(0, Math.round(xLine[1] - min_y));
    const toY = Math.min(gridHeight - 1, Math.round(xLine[2] - min_y));
    for (let y = fromY; y <= toY; y++) {
      if (x >= 0 && x < gridWidth)
        mapGrid[y * gridWidth + x] = CELL.unstandable;
    }
  }

  // Prepare Seeds (The points where we KNOW we can stand)
  const queue = [];
  for (let key in points) {
    const p = points[key];
    const px = Math.round(p[0] - min_x);
    const py = Math.round(p[1] - min_y);
    const idx = py * gridWidth + px;
    if (mapGrid[idx] === CELL.unknown) {
      mapGrid[idx] = CELL.standable;
      queue.push(idx);
    }
  }

  // Seed from monster spawn centers
  for (const [x, y] of mapSpawns) {
    const px = Math.round(x - min_x);
    const py = Math.round(y - min_y);
    const idx = py * gridWidth + px;

    if (mapGrid[idx] === CELL.unknown) {
      mapGrid[idx] = CELL.standable;
      queue.push(idx);
    }
  }

  // Flood Fill (BFS)
  let head = 0;
  while (head < queue.length) {
    const currIdx = queue[head++];
    const x = currIdx % gridWidth;
    const y = (currIdx / gridWidth) | 0;

    // Standard 4-direction check (1 pixel at a time)
    const neighbors = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];

    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < gridWidth && ny >= 0 && ny < gridHeight) {
        const nextIdx = ny * gridWidth + nx;
        if (mapGrid[nextIdx] === 0) {
          // If CELL.unknown and not a wall
          mapGrid[nextIdx] = 1;
          queue.push(nextIdx);
        }
      }
    }
  }

  GRID_CACHE[mapString] = {
    gridWidth,
    gridHeight,
    mapGrid,
    maxX: max_x,
    maxY: max_y,
    minX: min_x,
    minY: min_y,
  };

  return GRID_CACHE[mapString];
}

/**
 * Helper to check against the grid
 * @param {Object} position a position object with `x`, `y`, and `map` id
 * @returns
 */
function isStandablePoint(position) {
  const { x, y, map } = position;
  const { gridWidth, gridHeight, mapGrid, minX, minY } = getGrid(map);

  // Convert world → grid coordinates
  const gx = Math.round(x - minX);
  const gy = Math.round(y - minY);

  // Out of bounds = not standable
  if (gx < 0 || gx >= gridWidth || gy < 0 || gy >= gridHeight) {
    return false;
  }

  const idx = gy * gridWidth + gx;
  return mapGrid[idx] === CELL.standable;
}

/**
 * Returns spawns data for the given monster
 *
 * @param {string} monster
 * @param {Object} g
 * @returns {Array<{ map: string, x: number, y: number }>}
 */
function getMonsterSpawns(monster, g = parent.G) {
  const spawns = [];

  for (const [mapKey, gMap] of Object.entries(g.maps)) {
    if (gMap.ignore) continue; // Ignore map
    if (!gMap.monsters) continue; // No monsters on map

    for (const mapMonster of gMap.monsters) {
      if (mapMonster.type !== monster) continue; // Different monster

      const boundaries = mapMonster.boundaries ?? [
        [mapKey, ...mapMonster.boundary],
      ];

      for (const [map, x1, y1, x2, y2] of boundaries) {
        spawns.push({
          map,
          x: (x1 + x2) / 2,
          y: (y1 + y2) / 2,
        });
      }
    }
  }

  return spawns;
}

/**
 * Pathfinding using earth's ALPathfinder
 * @param {Object} toPosition includes `x`, `y` and `map`
 * @param {number} speed set the speed to a very big number to disable use_town, default: character's speed
 */
function pathfinderGetPath(toPosition, speed = character.speed) {
  return parent.caracAL.ALPathfinder.getPath(
    character.map,
    character.x,
    character.y,
    toPosition.map,
    toPosition.x,
    toPosition.y,
    speed,
  );
}

/**
 * A smart move helper using earth's ALPathfinder
 * @param {Object} toPosition
 * @param {Object} options
 */
async function smartMove(
  toPosition,
  options = {
    useBlink: true,
    useMagiport: true,
    useScare: true,
    stopCondition: undefined,
    speed: 999999999,
  },
) {
  if (!toPosition) return;

  let pathFindingResult;

  // If position is a mob's name id
  if (typeof toPosition === "string") {
    if (!parent.G.monsters[toPosition]) {
      throw new Error("Unknown monster");
    }

    const monsterSpawns = getMonsterSpawns(toPosition);
    if (!monsterSpawns.length) {
      throw new Error("Monster has no spawns");
    }

    let shortest = Infinity;

    for (const spawn of monsterSpawns) {
      const result = pathfinderGetPath(spawn, options.speed);

      if (Array.isArray(result) && result.length < shortest) {
        shortest = result.length;
        pathFindingResult = result;

        // prefer same-map immediately
        if (spawn.map === character.map) break;
      }
    }
  } else {
    /* Position filler */

    // Fill map first
    if (
      toPosition.map === undefined &&
      toPosition.x !== undefined &&
      toPosition.y !== undefined
    ) {
      toPosition.map = character.map;
    }

    let mapData = parent.G.maps[toPosition.map];

    // Fill x/y from spawn
    if (
      mapData.spawns?.length &&
      (toPosition.x === undefined || toPosition.y === undefined)
    ) {
      toPosition.x = mapData.spawns[0][0];
      toPosition.y = mapData.spawns[0][1];
    }

    // Final validation
    if (
      toPosition.map === undefined ||
      toPosition.x === undefined ||
      toPosition.y === undefined
    ) {
      throw new Error(
        `Unable to find path from ${character.map},${character.x},${character.y} ` +
          `to ${toPosition.map},${toPosition.x},${toPosition.y}`,
      );
    }

    pathFindingResult = pathfinderGetPath(toPosition, options.speed);

    // Standable fallback (for example: icegolem spawn)
    if (
      (!pathFindingResult || !pathFindingResult.length) &&
      mapData?.spawns?.length &&
      isStandablePoint(toPosition)
    ) {
      pathFindingResult = pathfinderGetPath(
        {
          ...toPosition,
          x: mapData.spawns[0][0],
          y: mapData.spawns[0][1],
        },
        options.speed,
      );

      if (Array.isArray(pathFindingResult)) {
        pathFindingResult.push({
          map: toPosition.map,
          x: toPosition.x,
          y: toPosition.y,
          method: "move",
        });
      }
    }
  }

  if (!Array.isArray(pathFindingResult) || !pathFindingResult.length) {
    await use_skill("use_town");
    throw new Error(
      `Unable to find path from ${character.map},${character.x},${character.y} to ${toPosition.map},${toPosition.x},${toPosition.y}`,
    );
  }
  isAdvanceSmartMoving = true;

  if (options.useScare) {
    await scareAwayMobs();
    scareInterval = setInterval(() => {
      scareAwayMobs();
    }, 1000);
    setTimeout(() => clearInterval(scareInterval), 300000);
  }

  try {
    // Moving
    for (const segment of pathFindingResult) {
      if (segment.method === "move") {
        if (segment.map !== character.map) {
          throw new Error(
            `Expected map ${segment.map}, currently on ${character.map}`,
          );
        }
        await move(segment.x, segment.y);
        continue;
      }

      if (segment.method === "door" || segment.method === "transport") {
        await transport(segment.map, segment.spawn);
        continue;
      }

      if (segment.method === "town") {
        await use_skill("use_town");
        await sleep(500);
      }
    }
  } catch (e) {
    console.log("smartMove error:", e);
  } finally {
    clearInterval(scareInterval);
    isAdvanceSmartMoving = false;
  }
}

async function scareAwayMobs() {
  if (
    (locate_item("jacko") !== -1 || character.slots["orb"].name === "jacko") &&
    Object.values(parent.entities).some(
      (mob) => mob?.target === character.name && mob?.type === "monster",
    ) &&
    !is_on_cooldown("scare") &&
    character.mp > 100
  ) {
    return Promise.all([
      equipBatch(
        {
          orb: "jacko",
        },
        true,
      ),
      use_skill("scare"),
    ]);
  }
}

async function mageBlink(
  map,
  coordinates,
  useCoordinates = true,
  minDistanceToBlink = 300,
) {
  if (
    character.mp > G.skills["blink"].mp &&
    !is_on_cooldown("blink") &&
    character.map === map &&
    coordinates.length === 2 &&
    distance(character, { x: coordinates[0], y: coordinates[1] }) >
      minDistanceToBlink
  ) {
    log("Blink to " + coordinates);
    return await use_skill("blink", coordinates).then(() =>
      reduce_cooldown("blink", character.ping * 0.7),
    );
  }

  if (useCoordinates) {
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

async function advanceSmartMove(
  props,
  options = {
    useScare: true,
  },
) {
  if (
    !smart.moving &&
    !character.c &&
    !isAdvanceSmartMoving &&
    ["mage", "merchant"].includes(character.ctype) &&
    character.slots.mainhand?.name !== "broom"
  ) {
    equip(findMaxLevelItem("broom"));
  }

  let scareInterval = undefined;

  if (options.useScare) {
    await scareAwayMobs();
    scareInterval = setInterval(() => {
      scareAwayMobs();
    }, 1000);
    setTimeout(() => clearInterval(scareInterval), 300000);
  }

  try {
    // useNearbySmartMove();

    if (isAdvanceSmartMoving) {
      resetSmartMove();
      clearInterval(scareInterval);
      return;
    }
    log("Advance Smart Move!");
    isAdvanceSmartMoving = true;

    if (
      (props.map === "crypt" || props === "crypt") &&
      character.map !== "crypt" &&
      get("cryptInstance")
    ) {
      if (distance(character, CRYPT_DOOR) > 100)
        await smart_move(CRYPT_DOOR).catch((e) => e);

      await enter("crypt", get("cryptInstance"));
      await sleep(character.ping * 3 + 3000);
    }

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
        await smart_move(props);
        resetSmartMove();
        clearInterval(scareInterval);

        return;
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
        await smart_move(props);
        isAdvanceSmartMoving = false;
        resetSmartMove();
        clearInterval(scareInterval);
        return;
      }

      // If one of the 2 maps has no Alia
      else {
        const checkingMapInterval = setInterval(() => {
          if (character.map === props.map) {
            stop("smart");
            clearInterval(checkingMapInterval);
          }
        }, 1000);

        await smart_move({ map: props.map }).catch((e) => e);

        await mageBlink(props.map, [props.x, props.y]);

        await sleep(character.ping);
        isAdvanceSmartMoving = false;
        await smart_move(props);
        clearInterval(scareInterval);
        resetSmartMove();
        return;
      }
    } else {
      const mageEntity = parent.caracAL
        ? parent.caracAL.siblings.includes(MAGE)
          ? get("mageLocation")
          : undefined
        : getCharacter(MAGE);
      log("Asking for a miracle, may be a magiport?");
      if (
        mageEntity &&
        mageEntity.map === props.map &&
        distance(props, mageEntity) < 300 &&
        mageEntity.mp > G.skills["magiport"].mp &&
        !get_entity(MAGE) &&
        character.map !== "bank"
      ) {
        if (character.ctype === "rogue" && character.s.invis) {
          stop("invis");
        }
        send_cm(MAGE, "magiport");
        await smart_move(props);
        log("Whoosh!");
        isAdvanceSmartMoving = false;
        resetSmartMove();
        clearInterval(scareInterval);
        return;
      } else {
        const checkingMageMagiportInterval = setInterval(async () => {
          let mageEntityUpdate = parent.caracAL
            ? parent.caracAL.siblings.includes(MAGE)
              ? get("mageLocation")
              : undefined
            : getCharacter(MAGE);
          if (
            mageEntityUpdate &&
            mageEntityUpdate.map === props.map &&
            distance(props, mageEntityUpdate) < 300 &&
            mageEntityUpdate.mp > G.skills["magiport"].mp &&
            !get_entity(MAGE) &&
            character.map !== "bank"
          ) {
            send_cm(MAGE, "magiport");
            log("Whoosh!");
            await sleep(character.ping * 2);
            if (distance(character, props) < 300) stop("smart");
            clearInterval(checkingMageMagiportInterval);
          }
        }, 1000);
        if (
          can_move({
            map: props.map,
            x: character.real_x,
            y: character.real_y,
            going_x: props.x,
            going_y: props.y,
            base: character.base,
          })
        ) {
          await move(props.x, props.y);
        } else await smart_move(props);
        clearInterval(checkingMageMagiportInterval);
        isAdvanceSmartMoving = false;
        clearInterval(scareInterval);
        resetSmartMove();
        return;
      }
    }
  } catch (e) {
    isAdvanceSmartMoving = false;
    resetSmartMove();
    clearInterval(scareInterval);
    stop();

    if (e.reason === "failed" && e.failed) use_skill("use_town");
    if (e.reason !== "interrupted") {
      isAdvanceSmartMoving = false;
    }

    if (
      e.reason === undefined &&
      e.failed &&
      distance(character, CRYPT_DOOR) < 100
    ) {
      await move(16, -1170);
    }
  }

  isAdvanceSmartMoving = false;
  clearInterval(scareInterval);
  resetSmartMove();

  return;
}
