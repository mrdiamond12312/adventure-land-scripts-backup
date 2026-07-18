// if (parent.S.pinkgoo?.live && !isFightingBoss) {
//   let pinkgooInstance = get_nearest_monster({ type: "pinkgoo" });
//   if (!pinkgooInstance) {
//     if (character.map !== parent.S.pinkgoo?.map) {
//       await smart_move({ map: parent.S.pinkgoo?.map }).catch((e) => {
//         if (e.reason === "interrupted") {
//           pinkgooInstance = get_nearest_monster({ type: "pinkgoo" });
//           stop("smart");
//         }
//       });
//     }
//     pinkgooInstance = get_nearest_monster({ type: "pinkgoo" });

//     if (!pinkgooInstance) {
//       const mapMobSpawn = G.maps[parent.S.pinkgoo?.map].monsters.filter(
//         (p) => !p.boundaries
//       );

//       const uniqueMapMobSpawn = mapMobSpawn.reduce((acc, current) => {
//         const overlapped = acc.find((item) => {
//           return !(
//             item.boundary[0] >= current.boundary[2] ||
//             item.boundary[2] <= current.boundary[0] ||
//             item.boundary[1] >= current.boundary[3] ||
//             item.boundary[3] <= current.boundary[1]
//           );
//         });
//         if (!overlapped) {
//           acc.push(current);
//         }
//         return acc;
//       }, []);

//       for (const spawn of uniqueMapMobSpawn) {
//         const visitedSpawn = get("visitedSpawn") ?? [];
//         if (visitedSpawn.includes(spawn.type)) {
//           continue;
//         } else {
//           visitedSpawn.push(spawn.type);
//           set("visitedSpawn", visitedSpawn);
//         }
//         const toX = (spawn.boundary[0] + spawn.boundary[2]) / 2;
//         const toY = (spawn.boundary[1] + spawn.boundary[3]) / 2;
//         if (
//           character.ctype === "mage" &&
//           character.mp > 3400 &&
//           !is_on_cooldown("blink") &&
//           distance(character, { x: toX, y: toY }) > 300
//         ) {
//           await use_skill("blink", [toX, toY]);
//           reduce_cooldown("blink", character.ping * 0.95);
//           await sleep(1200);
//         } else
//           await smart_move({
//             map: parent.S.pinkgoo?.map,
//             x: (spawn.boundary[0] + spawn.boundary[2]) / 2,
//             y: (spawn.boundary[1] + spawn.boundary[3]) / 2,
//           }).catch((e) => {
//             if (e.reason === "interrupted") {
//               pinkgooInstance = get_nearest_monster({ type: "pinkgoo" });
//               stop("smart");
//             }
//           });
//         pinkgooInstance = get_nearest_monster({ type: "pinkgoo" });

//         if (pinkgooInstance) {
//           set(
//             "visitedSpawn",
//             visitedSpawn.filter((vspawn) => vspawn !== spawn.type)
//           );
//           change_target(pinkgooInstance);
//           return pinkgooInstance;
//         }

//         if (!parent.S.pinkgoo?.live) break;
//         break;
//       }
//     } else {
//       change_target(pinkgooInstance);
//       return pinkgooInstance;
//     }
//   } else {
//     changeToNormalStrategies();
//     if (
//       character.ctype === "warrior" &&
//       character.dreturn &&
//       is_in_range(pinkgooInstance, "taunt") &&
//       !is_on_cooldown("taunt") &&
//       character.mp > G.skills["taunt"].mp &&
//       pinkgooInstance.target !== character.name
//     ) {
//       use_skill("taunt", pinkgooInstance);
//     }

//     if (!get_entity(MAGE) || character.ctype === "mage")
//       partyMems.forEach((id) => {
//         if (!get_entity(id))
//           send_cm(id, {
//             msg: "pinkgoo_found",
//             map: character.map,
//             x: character.x,
//             y: character.y,
//           });
//       });
//     return pinkgooInstance;
//   }
// } else {
//   set("visitedSpawn", undefined);
// }

// --- Retired from strategic_smart_move.21.js ---
// Old grid flood-fill standability check, replaced by ALPathfinder.isWalkable.

// const CELL = Object.freeze({
//   unknown: 0,
//   unstandable: -1,
//   standable: 1,
// });
// const GRID_CACHE = {};

// /**
//  * Generates and caches a grid object for the target map on cache miss.
//  * TODO: Account for mob spawn points as additional standable seeds.
//  *
//  * @version 20251227vCow
//  * @param {string} mapString - The target map ID
//  * @returns {Object} Grid data including standability map and map boundaries
//  */
// _getGrid(mapString) {
//   if (GRID_CACHE[mapString]) return GRID_CACHE[mapString];
//   const data = parent.G.geometry[mapString];
//   const { min_x, min_y, max_x, max_y, x_lines, y_lines, points } = data;
//   const mapMobs = parent.G.maps[mapString].monsters;
//   const mapSpawns = mapMobs
//     .filter((p) => !p.boundaries && p.boundary)
//     .reduce((acc, current) => {
//       acc.push([
//         (current.boundary[0] + current.boundary[2]) / 2,
//         (current.boundary[1] + current.boundary[3]) / 2,
//       ]);
//       return acc;
//     }, []);

//   // Init Array for Grid coloring
//   const gridWidth = Math.ceil(max_x - min_x);
//   const gridHeight = Math.ceil(max_y - min_y);
//   const mapGrid = new Int8Array(gridWidth * gridHeight);
//   mapGrid.fill(CELL.unknown);

//   // Color Boundaries with CELL.unstandable
//   for (const yLine of y_lines) {
//     const y = Math.round(yLine[0] - min_y);
//     const fromX = Math.max(0, Math.round(yLine[1] - min_x));
//     const toX = Math.min(gridWidth - 1, Math.round(yLine[2] - min_x));
//     for (let x = fromX; x <= toX; x++) {
//       if (y >= 0 && y < gridHeight)
//         mapGrid[y * gridWidth + x] = CELL.unstandable;
//     }
//   }

//   for (const xLine of x_lines) {
//     const x = Math.round(xLine[0] - min_x);
//     const fromY = Math.max(0, Math.round(xLine[1] - min_y));
//     const toY = Math.min(gridHeight - 1, Math.round(xLine[2] - min_y));
//     for (let y = fromY; y <= toY; y++) {
//       if (x >= 0 && x < gridWidth)
//         mapGrid[y * gridWidth + x] = CELL.unstandable;
//     }
//   }

//   // Prepare Seeds (The points where we KNOW we can stand)
//   const queue = [];
//   for (let key in points) {
//     const p = points[key];
//     const px = Math.round(p[0] - min_x);
//     const py = Math.round(p[1] - min_y);
//     const idx = py * gridWidth + px;
//     if (mapGrid[idx] === CELL.unknown) {
//       mapGrid[idx] = CELL.standable;
//       queue.push(idx);
//     }
//   }

//   // Seed from monster spawn centers
//   for (const [x, y] of mapSpawns) {
//     const px = Math.round(x - min_x);
//     const py = Math.round(y - min_y);
//     const idx = py * gridWidth + px;

//     if (mapGrid[idx] === CELL.unknown) {
//       mapGrid[idx] = CELL.standable;
//       queue.push(idx);
//     }
//   }

//   // Flood Fill (BFS)
//   let head = 0;
//   while (head < queue.length) {
//     const currIdx = queue[head++];
//     const x = currIdx % gridWidth;
//     const y = (currIdx / gridWidth) | 0;

//     // Standard 4-direction check (1 pixel at a time)
//     const neighbors = [
//       [x + 1, y],
//       [x - 1, y],
//       [x, y + 1],
//       [x, y - 1],
//     ];

//     for (const [nx, ny] of neighbors) {
//       if (nx >= 0 && nx < gridWidth && ny >= 0 && ny < gridHeight) {
//         const nextIdx = ny * gridWidth + nx;
//         if (mapGrid[nextIdx] === 0) {
//           // If CELL.unknown and not a wall
//           mapGrid[nextIdx] = 1;
//           queue.push(nextIdx);
//         }
//       }
//     }
//   }

//   GRID_CACHE[mapString] = {
//     gridWidth,
//     gridHeight,
//     mapGrid,
//     maxX: max_x,
//     maxY: max_y,
//     minX: min_x,
//     minY: min_y,
//   };

//   return GRID_CACHE[mapString];
// }

// /**
//  * Helper to check against the grid
//  * @param {Object} position a position object with `x`, `y`, and `map` id
//  * @returns {Boolean} whether the position is standable based on the grid data
//  */
// oldIsStandablePoint(position) {
//   const { x, y, map } = position;
//   const { gridWidth, gridHeight, mapGrid, minX, minY } = this._getGrid(map);

//   // Convert world to grid coordinates
//   const gx = Math.round(x - minX);
//   const gy = Math.round(y - minY);

//   // Out of bounds = not standable
//   if (gx < 0 || gx >= gridWidth || gy < 0 || gy >= gridHeight) {
//     return false;
//   }

//   const idx = gy * gridWidth + gx;
//   return mapGrid[idx] === CELL.standable;
// }

// Old transport variant that retried through the door on transport_cant_reach.

// async transport(map, spawn) {
//   const waitPromise = this.waitForNewMap();
//   parent.socket.emit("transport", { to: map, s: spawn });

//   const catchPromise = parent.push_deferred("transport").catch(async (e) => {
//     if (e.response === "transport_cant_reach") {
//       const door = this._findDoorTo(map);
//       if (door) {
//         await smart_move(door.x, door.y);
//         await this.transport(map, spawn);
//       }
//     }
//   });

//   try {
//     await waitPromise;
//   } catch (error) {
//     console.warn("Transport timeout! Current map:", character.map);
//   }

//   await catchPromise;
// }
