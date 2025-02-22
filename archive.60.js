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
