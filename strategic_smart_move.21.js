const MAGIPORT_IGNORE_LIST = ["bank", "bank_u", "bank_b", "jail"];

/** Tunables used across the smartMove implementation */
const SMART_MOVE_CONFIG = Object.freeze({
  // Pathing / walk loop
  MIN_PATHING_SPEED: 40, // floor for pathfinding speed so slow characters still consider town routes
  ARRIVED_DISTANCE: 10, // already close enough to the destination, skip the move entirely
  MAGICAL_WAIT_MS: 500, // walk loop poll while a blink/magiport is in flight
  LOOP_DEBUG: false,

  // Magiport (_magiportCheck)
  MAGIPORT_CHECK_INTERVAL_MS: 200,
  MAGIPORT_MAGE_NEAR_DEST_DISTANCE: 200, // mage counts as "parked at the destination" within this
  MAGIPORT_MIN_WORTH_DISTANCE: 100, // closer than this to the mage, walking is cheaper than a port
  MAGIPORT_MP_RESERVE_CASTS: 2, // mage keeps mp for this many magiport casts (the other fighters)
  MAGIPORT_LANDING_WAIT_MS: 1500, // wait after send_cm before checking whether the port landed
  MAGIPORT_ARRIVAL_DISTANCE: 300, // landed within this of the destination = the port worked

  // Blink (_blinkCheck and the in-path blink segment)
  BLINK_CHECK_INTERVAL_MS: 200,
  BLINK_MIN_WORTH_DISTANCE: 200, // shorter jumps than this aren't worth the mp/cooldown
  BLINK_SETTLE_MS: 250, // wait after blink before correcting position with move()
  BLINK_MP_WAIT_TIMEOUT_MS: 15_000, // how long a blink path segment waits for mp/cooldown
  BLINK_SETTLE_PING_RATE: 0.7, // in-path blink settles for ping * this before the next segment

  // Scare / stop watcher
  SCARE_INTERVAL_MS: 1000,
  STOP_WATCHER_INTERVAL_MS: 500,

  // Transport / town
  TRANSPORT_DOOR_NEAR_DISTANCE: 100, // farther than this from the door, walk up to it first
  NEW_MAP_TIMEOUT_MS: 5000, // waitForNewMap default timeout
  TOWN_MAX_RETRIES: 5,
  TOWN_RETRY_DELAY_MS: 300,
  TOWN_SPAWN_ARRIVAL_DISTANCE: 100, // landed within this of spawn 0 = the town worked
  TOWN_CHANNEL_TIMEOUT_MS: 5000, // how long to wait for the town channel to finish
});

class StrategicSmartMove {
  constructor() {
    this.pathfinder = parent.caracAL.ALPathfinder;
    this.pathfinder.prepare(parent.G, ["bank_u"]);
    this.pathfinder.addCheatPath("winterland", 721, 277, 737, 352);
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
   * Unsafe move - using within Strategic Smart Move for crossing smap wall
   * @param {number} goingX - Destination x coordinate
   * @param {number} goingY - Destination y coordinate
   */
  async unsafeMove(goingX, goingY) {
    const map = parent.character.map;
    const geo = parent.G.geometry[map];
    delete parent.G.geometry[map];
    let promise;
    try {
      promise = parent.move(goingX, goingY, true);
    } finally {
      parent.G.geometry[map] = geo;
    }
    return promise;
  }

  /**
   * Use town to teleport back to the first spawn of the map with retries
   * @param {Object} [options={}] - Optional configuration.
   * @param {number} [options.maxRetries=SMART_MOVE_CONFIG.TOWN_MAX_RETRIES] - Maximum number of retry attempts.
   * @param {number} [options.retryDelay=SMART_MOVE_CONFIG.TOWN_RETRY_DELAY_MS] - Delay (ms) between retries.
   */
  async useTownWithRetry({
    maxRetries = SMART_MOVE_CONFIG.TOWN_MAX_RETRIES,
    retryDelay = SMART_MOVE_CONFIG.TOWN_RETRY_DELAY_MS,
  } = {}) {
    let attempts = 0;
    let mapData = parent.G.maps[character.map];

    while (attempts++ < maxRetries) {
      if (this.stopTownSession === this.smartMoveSession) {
        return true;
      }
      await town();
      await waitUntil(() => {
        return !character.c.town;
      }, SMART_MOVE_CONFIG.TOWN_CHANNEL_TIMEOUT_MS);
      await sleep(retryDelay);
      if (mapData.spawns?.length) {
        if (
          distance(character, {
            map: character.map,
            x: mapData.spawns[0][0],
            y: mapData.spawns[0][1],
          }) > SMART_MOVE_CONFIG.TOWN_SPAWN_ARRIVAL_DISTANCE
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
   * Whether the mage is currently running, so its location snapshot is live
   * @returns {boolean} true if the mage character is online
   */
  isMageOnline() {
    if (parent.caracAL) return !!parent.caracAL.siblings?.includes(MAGE);
    return !!get_active_characters()[MAGE];
  }

  /**
   * Get Mage Information
   * @returns mage information from localStorage or from iframe, undefined if the mage is offline
   */
  getMageInfo() {
    if (!this.isMageOnline()) return undefined;
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
   * check keeps retrying. While the mage is offline the loop just idles, so it
   * picks the port back up if the mage comes online mid-walk.
   * @param {number} session - the smartMove session this loop belongs to
   * @param {Object} toPosition - resolved destination with `map`, `x`, `y`
   */
  async _magiportCheck(session, toPosition) {
    if (session !== this.smartMoveSession) return;

    if (SMART_MOVE_CONFIG.LOOP_DEBUG) console.warn("magiport tick", session);

    const mageInfo = this.getMageInfo();

    if (
      mageInfo &&
      mageInfo.map === toPosition.map &&
      distance(toPosition, mageInfo) <
        SMART_MOVE_CONFIG.MAGIPORT_MAGE_NEAR_DEST_DISTANCE &&
      distance(character, mageInfo) >=
        SMART_MOVE_CONFIG.MAGIPORT_MIN_WORTH_DISTANCE &&
      mageInfo.mp >
        parent.G.skills["magiport"].mp *
          SMART_MOVE_CONFIG.MAGIPORT_MP_RESERVE_CASTS &&
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
        await sleep(SMART_MOVE_CONFIG.MAGIPORT_LANDING_WAIT_MS);

        if (
          character.map === toPosition.map &&
          distance(character, toPosition) <
            SMART_MOVE_CONFIG.MAGIPORT_ARRIVAL_DISTANCE
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
            await this.unsafeMove(toPosition.x, toPosition.y); // Move after magiport to correct position in case of random spawn
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
      SMART_MOVE_CONFIG.MAGIPORT_CHECK_INTERVAL_MS,
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

    if (SMART_MOVE_CONFIG.LOOP_DEBUG) console.warn("blink tick", session);

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
          SMART_MOVE_CONFIG.BLINK_CHECK_INTERVAL_MS,
        );
        return;
      }
    }

    try {
      if (
        blinkLocation &&
        !is_on_cooldown("blink") &&
        character.mp >
          parent.G.skills["blink"].mp +
            parent.G.skills["magiport"].mp *
              SMART_MOVE_CONFIG.MAGIPORT_MP_RESERVE_CASTS && // reserve to magiport the other fighters
        distance(character, { x: blinkLocation.x, y: blinkLocation.y }) >
          SMART_MOVE_CONFIG.BLINK_MIN_WORTH_DISTANCE
      ) {
        console.warn(
          `Blinking to ${blinkSegment.map} (${blinkSegment.x}, ${blinkSegment.y})`,
        );
        this.isDoingSomethingMagical = true;
        this.stopTownChanneling();
        await use_skill("blink", [blinkSegment.x, blinkSegment.y]);
        await sleep(SMART_MOVE_CONFIG.BLINK_SETTLE_MS);
        await this.unsafeMove(blinkSegment.x, blinkSegment.y); // Blink has random position, move after blink to correct it
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
      SMART_MOVE_CONFIG.BLINK_CHECK_INTERVAL_MS,
    );
  }

  waitForNewMap(timeout = SMART_MOVE_CONFIG.NEW_MAP_TIMEOUT_MS) {
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
      if (distToDoor > SMART_MOVE_CONFIG.TRANSPORT_DOOR_NEAR_DISTANCE) {
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
      speed: Math.max(character.speed, SMART_MOVE_CONFIG.MIN_PATHING_SPEED),
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

      if (distance(toPosition, character) < SMART_MOVE_CONFIG.ARRIVED_DISTANCE)
        return;

      pathFindingResult = this.pathfinderGetPath(toPosition, options.speed);

      // Standable fallback (for example: icegolem spawn): when no direct path
      // exists but the point itself is standable, reroute via spawn 0 and hop
      // the last leg. Gated on useTown so short in-combat moves (kiting/tanking
      // pass useTown:false) bail with an empty path instead of trekking the
      // warrior all the way to spawn 0 mid-fight.
      if (
        (!pathFindingResult || !pathFindingResult.length) &&
        options.useTown &&
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
        }, SMART_MOVE_CONFIG.SCARE_INTERVAL_MS);
      }
    } catch (e) {
      console.warn("Code's not ready");
    }

    if (options.useMagiport && MAGE && character.ctype !== "mage") {
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
        if (SMART_MOVE_CONFIG.LOOP_DEBUG) console.warn("watcher tick", session);
        if (options.stopWatcher()) {
          stop();
          this.isSmartMoving = false;
          clearInterval(this.watcherInterval);
          return;
        }

        if (!this.isSmartMoving || session !== this.smartMoveSession)
          clearInterval(this.watcherInterval);
      }, SMART_MOVE_CONFIG.STOP_WATCHER_INTERVAL_MS);
    }

    try {
      while (progress.segmentIndex < pathFindingResult.length) {
        if (!this.isSmartMoving || session !== this.smartMoveSession) break;

        if (this.isDoingSomethingMagical) {
          await sleep(SMART_MOVE_CONFIG.MAGICAL_WAIT_MS);
          continue;
        }

        const segment = pathFindingResult[progress.segmentIndex];
        if (segment.method === "move") {
          // if (segment.map !== character.map) {
          //   throw new Error(
          //     `Expected map ${segment.map}, currently on ${character.map}`,
          //   );
          // }
          await this.unsafeMove(segment.x, segment.y);
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
            await waitUntil(
              () => this.hasMpToBlink(),
              SMART_MOVE_CONFIG.BLINK_MP_WAIT_TIMEOUT_MS,
            );
          }

          if (this.hasMpToBlink() && character.map === segment.map) {
            await use_skill("blink", [segment.x, segment.y]);
            await sleep(
              character.ping * SMART_MOVE_CONFIG.BLINK_SETTLE_PING_RATE,
            );
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
