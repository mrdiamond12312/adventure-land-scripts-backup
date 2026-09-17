// Prints cave state whenever it changes, to work out the shapes we cannot see.

let lastMapReport = "";
let lastCaveReport = "";
let lastEntityReport = "";

/** Whether the pathfinder graph could ever have known this map */
function reportMap() {
  if (character.map === lastMapReport) return;
  lastMapReport = character.map;

  console.log("=== map ===");
  console.log(
    JSON.stringify({
      map: character.map,
      knownToG: Boolean(parent.G.maps[character.map]),
    }),
  );
}

/** Objectives, doors, purse and timer all live here */
function reportCave() {
  const snapshot = JSON.stringify(character.cave);
  if (snapshot === lastCaveReport) return;
  lastCaveReport = snapshot;

  console.log("=== character.cave ===");
  console.log(snapshot);
}

/** Whatever tells an ally apart from a hostile is on one of these */
function reportCaveEntities() {
  const marked = Object.values(parent.entities)
    .filter((entity) => entity.cave)
    .map((entity) => ({
      id: entity.id,
      name: entity.name,
      type: entity.type,
      mtype: entity.mtype,
      level: entity.level,
      target: entity.target,
      cave: entity.cave,
    }));

  const snapshot = JSON.stringify(marked);
  if (snapshot === lastEntityReport) return;
  lastEntityReport = snapshot;

  console.log("=== entities carrying .cave ===");
  console.log(snapshot);
}

function reportLoop() {
  try {
    reportMap();
    reportCave();
    reportCaveEntities();
  } catch (error) {
    console.error(error);
  } finally {
    setTimeout(reportLoop, 250);
  }
}

reportLoop();
