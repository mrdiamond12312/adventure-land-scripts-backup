const MAGIPORT_IGNORE_LIST = ["bank", "bank_u", "bank_b", "jail"];

class StrategicSmartMove {
  constructor() {
    this.pathfinder = parent.caracAL.ALPathfinder;
    this.pathfinder.prepare(parent.G, ["bank_u"]);
    this.scareInterval = undefined;
    this.isDoingSomethingMagical = false;
    this.blinkLoop = undefined;
    this.magiportLoop = undefined;
    this.watcherInterval = undefined;
    this.isSmartMoving = true;
    this.stopTownSession = null;
  }

  /**
   * Helper to find the door leading to a specific map from the current map
   * @param {*} map destination map id
   * @param {*} fromMap door search source map, defaults to character's current map
   * @returns a closest door object with `map`, `x`, and `y` of the door leading to the destination map, or undefined if no such door exists
   */
  _findDoorTo(map, fromMap = character.map) {
    const doors = G.maps[fromMap].doors || [];

    const closest = doors
      .filter((d) => d[4] === map)
      .sort(
        (lhs, rhs) =>
          distance(character, { x: lhs[0], y: lhs[1] }) -
          distance(character, { x: rhs[0], y: rhs[1] }),
      )
      .shift(); // smallest distance first

    if (!closest) return undefined;

    return {
      map: closest[4],
      x: closest[0],
      y: closest[1],
    };
  }

  /**
   * Now using alpathfinder's isWalkable to check if the coordinate is standable
   */
  isStandablePoint(position) {
    return this.pathfinder.isWalkable(position.map, position.x, position.y);
  }

  /**
   * Returns spawns data for the given monster
   *
   * @param {string} monster
   * @param {Object} g
   * @returns {Array<{ map: string, x: number, y: number }>}
   */
  getMonsterSpawns(monster, g = parent.G) {
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
  pathfinderGetPath(toPosition, speed = character.speed) {
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
   * Use town to teleport back to the first spawn of the map with retries
   * @param {Object} [options={}] - Optional configuration.
   * @param {number} [options.maxRetries=5] - Maximum number of retry attempts.
   * @param {number} [options.retryDelay=300] - Delay (ms) between retries.
   */
  async useTownWithRetry({ maxRetries = 5, retryDelay = 300 } = {}) {
    let attempts = 0;
    let mapData = parent.G.maps[character.map];

    while (attempts++ < maxRetries) {
      if (this.stopTownSession === this.smartMoveSession) {
        return true;
      }
      await town();
      await waitUntil(() => {
        return !character.c.town;
      }, 5000);
      await sleep(retryDelay);
      if (mapData.spawns?.length) {
        if (
          distance(character, {
            map: character.map,
            x: mapData.spawns[0][0],
            y: mapData.spawns[0][1],
          }) > 100
        ) {
          continue;
        }
        return true;
      }
    }

    if (
      mapData.spawns?.length &&
      this.stopTownSession !== this.smartMoveSession
    ) {
      await smart_move({
        map: character.map,
        x: mapData.spawns[0][0],
        y: mapData.spawns[0][1],
      });
    }

    return false;
  }

  stopTownChanneling() {
    this.stopTownSession = this.smartMoveSession;
    stop("town");
  }

  // Mage Utils

  /**
   * Get Mage Information
   * @returns mage information from localStorage or from iframe
   */
  getMageInfo() {
    return parent.caracAL ? get("mageLocation") : getCharacter(MAGE);
  }

  /**
   * Check Mage condition before blinking
   * @returns true if mage can blink
   */
  hasMpToBlink() {
    return (
      character.ctype === "mage" &&
      character.mp >= G.skills["blink"].mp &&
      !is_on_cooldown("blink")
    );
  }

  /**
   * Recurring check (1s) that asks the mage for a magiport once it is parked
   * near the destination. Verifies the port actually landed before ending the
   * smartMove session — if the mage never casts, the walk keeps going and the
   * check keeps retrying.
   * @param {number} session - the smartMove session this loop belongs to
   * @param {Object} toPosition - resolved destination with `map`, `x`, `y`
   */
  async _magiportCheck(session, toPosition) {
    if (session !== this.smartMoveSession) return;

    console.warn("magiport tick", session);

    const mageInfo = this.getMageInfo();

    if (
      mageInfo &&
      mageInfo.map === toPosition.map &&
      distance(toPosition, mageInfo) < 200 &&
      distance(character, mageInfo) >= 100 &&
      mageInfo.mp > parent.G.skills["magiport"].mp * 2 &&
      mageInfo.time > Date.now() - 15_000 &&
      !MAGIPORT_IGNORE_LIST.includes(character.map) // Avoid magiporting in ignore maps
    ) {
      this.isDoingSomethingMagical = true;
      try {
        if (character.ctype === "rogue" && character.s.invis) {
          await stop("invis");
        }

        console.warn(`Whoosh! #${session}`);
        send_cm(MAGE, "magiport");
        stop();
        await sleep(1500);

        if (
          character.map === toPosition.map &&
          distance(character, toPosition) < 300
        ) {
          if (
            this.pathfinder.canWalkPath(
              character.map,
              character.x,
              character.y,
              toPosition.x,
              toPosition.y,
            )
          )
            await move(toPosition.x, toPosition.y); // Move after magiport to correct position in case of random spawn
          this.cleanUp(session);
          this.stopTownChanneling();
          return;
        }

        console.warn(`Magiport didn't land #${session}, resuming walk`);
      } catch (e) {
        console.warn(`Magiport branch failed #${session}:`, e);
      } finally {
        this.isDoingSomethingMagical = false;
      }
    }

    // Recursive timeout to check for magiport availability every second
    if (session !== this.smartMoveSession || !this.isSmartMoving) return;
    this.magiportLoop = setTimeout(
      () => this._magiportCheck(session, toPosition),
      1000,
    );
  }

  /**
   * Recurring check (1s) that blinks the mage past the remaining same-map
   * segments of the path, skipping the walked segments via `progress`.
   * @param {number} session - the smartMove session this loop belongs to
   * @param {Array<Object>} pathFindingResult - the path segments being walked
   * @param {{segmentIndex: number}} progress - segment cursor shared with the walking loop
   */
  async _blinkCheck(session, pathFindingResult, progress) {
    if (
      progress.segmentIndex >= pathFindingResult.length ||
      !this.isSmartMoving ||
      session !== this.smartMoveSession
    ) {
      clearTimeout(this.blinkLoop);
      return;
    }

    let lastIndex = progress.segmentIndex;
    const currentMap = character.map;

    for (
      let searchIndex = lastIndex;
      searchIndex < pathFindingResult.length;
      searchIndex++
    ) {
      if (pathFindingResult[searchIndex].map === currentMap) {
        lastIndex = searchIndex;
        if (
          searchIndex + 1 < pathFindingResult.length &&
          pathFindingResult[searchIndex + 1].method === "town"
        ) {
          lastIndex = searchIndex + 1;
        }
      }
    }

    const blinkSegment = pathFindingResult[lastIndex];
    let blinkLocation;

    if (blinkSegment && blinkSegment.method === "move") {
      blinkLocation = blinkSegment;
    }

    if (blinkSegment && blinkSegment.method === "town") {
      const mapData = parent.G.maps[currentMap];
      if (mapData.spawns?.length) {
        blinkLocation = {
          map: blinkSegment.map,
          x: mapData.spawns[0][0],
          y: mapData.spawns[0][1],
        };
      } else {
        console.log(
          `No spawn data for town segment ${blinkSegment.map}, skipping blink`,
        );
        this.blinkLoop = setTimeout(
          () => this._blinkCheck(session, pathFindingResult, progress),
          1000,
        );
        return;
      }
    }

    try {
      if (
        blinkLocation &&
        !is_on_cooldown("blink") &&
        character.mp >
          parent.G.skills["blink"].mp + parent.G.skills["magiport"].mp * 2 && // reserve to magiport the other 2 fighters
        distance(character, { x: blinkLocation.x, y: blinkLocation.y }) > 200
      ) {
        console.warn(
          `Blinking to ${blinkSegment.map} (${blinkSegment.x}, ${blinkSegment.y})`,
        );
        this.isDoingSomethingMagical = true;
        this.stopTownChanneling();
        await use_skill("blink", [blinkSegment.x, blinkSegment.y]);
        await sleep(250);
        await move(blinkSegment.x, blinkSegment.y); // Blink has random position, move after blink to correct it
        progress.segmentIndex = lastIndex + 1;
      }
    } catch (e) {
      console.warn("Error while blinking:", e);
    } finally {
      this.isDoingSomethingMagical = false;
    }

    if (session !== this.smartMoveSession || !this.isSmartMoving) return;
    this.blinkLoop = setTimeout(
      () => this._blinkCheck(session, pathFindingResult, progress),
      1000,
    );
  }

  waitForNewMap(timeout = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        parent.socket.off("new_map", handler);
        reject(new Error("new_map timeout"));
      }, timeout);

      function handler(data) {
        clearTimeout(timer);
        resolve(data);
      }

      parent.socket.once("new_map", handler);
    });
  }

  async transport(map, spawn) {
    const door = this._findDoorTo(map);

    if (door) {
      const distToDoor = distance(character, { x: door.x, y: door.y });

      // If we are too far from the door, move there first
      if (distToDoor > 100) {
        console.warn(
          `Too far from door to ${map} (${Math.round(
            distToDoor,
          )} units). Moving...`,
        );
        // Using the global smart_move or your local pathfinder
        await smart_move({ x: door.x, y: door.y });
      }
    }

    const waitPromise = this.waitForNewMap();
    parent.socket.emit("transport", { to: map, s: spawn });
    parent.push_deferred("transport");

    try {
      await waitPromise;
    } catch (error) {
      console.warn("Transport timeout! Current map:", character.map);
    }
  }

  /**
   * @param {string | Object} toPosition - the monster id or map or coordinates object to move to
   * @param {*} extraOptions - extra settings
   * @param {boolean} extraOptions.useBlink - whether to use blink for the last segment, default: true
   * @param {boolean} extraOptions.useMagiport - whether to use magiport for the last segment if blink is unavailable, default: true
   * @param {boolean} extraOptions.useScare - whether to scare away mobs during smart moving, default: true
   * @param {Function} extraOptions.stopWatcher - a function that returns a boolean to determine whether to stop smart moving, default: undefined
   * @param {number} extraOptions.speed - the speed to use for pathfinding, set to a very big number to disable use_town, default: character's speed
   * @param {boolean} extraOptions.useTown - whether to town back to the map's first spawn when no path is found, default: true. Set false when towning is worse than not moving (e.g. a tanker holding mobs)
   */
  async smartMove(toPosition, extraOptions = {}) {
    // Stop any existing smart move
    if (this.isSmartMoving) {
      this.cleanUp();
      this.stopTownChanneling();
    }

    console.warn(toPosition);

    if (!can_walk(character)) return;

    const options = {
      useBlink: character.ctype === "mage",
      useMagiport: true,
      useScare: true,
      stopWatcher: undefined,
      wait: 0,
      speed: Math.max(character.speed, 40),
      useTown: true,
      exact: false,
      smartmoveDebug: false, // to set the global var smartmoveDebug
      ...extraOptions,
    };

    if (!toPosition) return;

    let pathFindingResult;

    // If position is a mob's name id
    if (typeof toPosition === "string") {
      if (!parent.G.monsters[toPosition]) {
        throw new Error("Unknown monster");
      }

      const monsterSpawns = this.getMonsterSpawns(toPosition);
      if (!monsterSpawns.length) {
        throw new Error("Monster has no spawns");
      }

      let shortest = Infinity;

      for (const spawn of monsterSpawns) {
        const result = this.pathfinderGetPath(spawn, options.speed);

        if (Array.isArray(result) && result.length < shortest) {
          shortest = result.length;
          pathFindingResult = result;
          toPosition = spawn;

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

      if (distance(toPosition, character) < 10) return;

      pathFindingResult = this.pathfinderGetPath(toPosition, options.speed);

      // Standable fallback (for example: icegolem spawn)
      if (
        (!pathFindingResult || !pathFindingResult.length) &&
        mapData?.spawns?.length &&
        this.isStandablePoint(toPosition)
      ) {
        pathFindingResult = this.pathfinderGetPath(
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
            method: "blink",
          });
        }
      }
    }

    this.smartMoveSession = (this.smartMoveSession || 0) + 1;
    const session = this.smartMoveSession;
    isAdvanceSmartMoving = true;
    this.isSmartMoving = true;
    smartmoveDebug = options.smartmoveDebug;

    if (!Array.isArray(pathFindingResult) || !pathFindingResult.length) {
      try {
        if (
          options.useTown &&
          toPosition.map &&
          this.isStandablePoint(toPosition)
        ) {
          await this.useTownWithRetry();
        }
      } finally {
        this.cleanUp(session);
      }
      throw new Error(
        `Unable to find path from ${character.map},${character.x},${character.y} to ${toPosition.map},${toPosition.x},${toPosition.y}`,
      );
    }

    if (options.wait) {
      await sleep(options.wait);
    }

    if (options.exact) {
      pathFindingResult.push({
        method: "move",
        map: toPosition.map,
        x: toPosition.x,
        y: toPosition.y,
      });
    }

    try {
      if (options.useScare) {
        await scareAwayMobs();
        this.scareInterval = setInterval(async () => {
          if (!this.isSmartMoving || session !== this.smartMoveSession) {
            clearInterval(this.scareInterval);
            return;
          }

          await scareAwayMobs();
        }, 1000);
      }
    } catch (e) {
      console.warn("Code's not ready");
    }

    if (options.useMagiport && character.ctype !== "mage") {
      this.magiportLoop = setTimeout(
        () => this._magiportCheck(session, toPosition),
        0,
      );
    }

    // Start moving
    // Segment progress, shared with the blink loop which skips segments ahead after a successful blink
    const progress = { segmentIndex: 0 };

    if (
      options.useBlink &&
      character.ctype === "mage" &&
      pathFindingResult.length
    ) {
      this.blinkLoop = setTimeout(
        () => this._blinkCheck(session, pathFindingResult, progress),
        0,
      );
    }

    if (options.stopWatcher) {
      this.watcherInterval = setInterval(() => {
        if (options.stopWatcher()) {
          stop();
          this.isSmartMoving = false;
          clearInterval(this.watcherInterval);
          return;
        }

        if (!this.isSmartMoving || session !== this.smartMoveSession)
          clearInterval(this.watcherInterval);
      }, 500);
    }

    try {
      while (progress.segmentIndex < pathFindingResult.length) {
        if (!this.isSmartMoving || session !== this.smartMoveSession) break;

        if (this.isDoingSomethingMagical) {
          await sleep(500);
          continue;
        }

        const segment = pathFindingResult[progress.segmentIndex];
        if (segment.method === "move") {
          // if (segment.map !== character.map) {
          //   throw new Error(
          //     `Expected map ${segment.map}, currently on ${character.map}`,
          //   );
          // }
          await move(segment.x, segment.y);
          progress.segmentIndex++;
          continue;
        }

        if (segment.method === "door" || segment.method === "transport") {
          await this.transport(segment.map, segment.spawn);
          progress.segmentIndex++;
          continue;
        }

        if (segment.method === "town") {
          await this.useTownWithRetry();
          progress.segmentIndex++;
          continue;
        }

        if (segment.method === "leave") {
          await leave();
          progress.segmentIndex++;
          continue;
        }

        if (segment.method === "blink" && character.ctype === "mage") {
          if (!this.hasMpToBlink()) {
            await waitUntil(() => this.hasMpToBlink(), 15_000);
          }

          if (this.hasMpToBlink() && character.map === segment.map) {
            await use_skill("blink", [segment.x, segment.y]);
            await sleep(character.ping * 0.7);
            progress.segmentIndex++;
            continue;
          }
        }

        progress.segmentIndex++;
      }
    } catch (e) {
      console.warn("smartMove error:", e);
    } finally {
      this.cleanUp(session);
    }
  }

  /**
   * Tears down timers and stops movement. When a session is given, only cleans
   * up if that session is still the current one — a finished old session must
   * not kill the timers of a newer smartMove that already took over.
   * @param {number} [session] - the smartMove session this cleanup belongs to
   */
  cleanUp(session) {
    if (session !== undefined && session !== this.smartMoveSession) return;
    if (this.scareInterval) {
      clearInterval(this.scareInterval);
      this.scareInterval = undefined;
    }
    if (this.blinkLoop) {
      clearTimeout(this.blinkLoop);
      this.blinkLoop = undefined;
    }
    if (this.magiportLoop) {
      clearTimeout(this.magiportLoop);
      this.magiportLoop = undefined;
    }
    if (this.watcherInterval) {
      clearInterval(this.watcherInterval);
      this.watcherInterval = undefined;
    }

    this.isDoingSomethingMagical = false;
    this.isSmartMoving = false;
    isAdvanceSmartMoving = false;
    stop();
    console.warn("Clean up called for session", this.smartMoveSession);
  }
}

const strategicSmartMove = new StrategicSmartMove();
const smartMove = strategicSmartMove.smartMove.bind(strategicSmartMove);
const getMonsterSpawns =
  strategicSmartMove.getMonsterSpawns.bind(strategicSmartMove);
