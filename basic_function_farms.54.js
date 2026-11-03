// basic_function part: the farm library, the current farm, and spot anchors

/**
 * Where a spot sits: `at`, else the middle of the `between` mobs' spawns on `map`,
 * else the first `mtype` spawn on `map`.
 * @typedef {object} SpotAnchor
 * @property {string} map
 * @property {{x: number, y: number}} [at]
 * @property {string[]} [between]
 * @property {string} [mtype]
 */

/**
 * A farm: its anchor, plus the mobs we farm there in priority order. `mtype` defaults to the farm's key.
 * `tanker` takes the tank on the spot (none leaves it to assignRoles); the warrior taunts and holds
 * `warriorHeld` mobs on the spot, whoever tanks.
 * @typedef {SpotAnchor & {mobs: string[], tanker?: string, warriorHeld?: string[]}} FarmConfig
 */

/** @typedef {{name: string, map: string, x: number, y: number, mobs: string[], tanker?: string, warriorHeld: string[]}} Farm */

/** @satisfies {Record<string, FarmConfig>} */
const FARMS = {
  bigbird: {
    map: "main",
    at: { x: 1248, y: -63 },
    mobs: ["grinch", "phoenix", "spider", "bigbird", "scorpion"],
  },
  spider: {
    map: "main",
    at: { x: 1328, y: -80 },
    mobs: ["spider"],
  },
  sparkbot: {
    map: "uhills",
    at: { x: -289, y: -188 },
    mobs: ["goldenbot", "sparkbot"],
  },
  wolf: {
    map: "winterland",
    at: { x: 423, y: -2614 },
    mobs: ["phoenix", "stompy", "wolf"],
  },
  wolfie: {
    map: "winterland",
    between: ["wolfie"],
    mobs: ["wolfie"],
  },
  fireroamer: {
    map: "desertland",
    at: { x: 223, y: -708 },
    mobs: ["fireroamer"],
  },
  mole: {
    map: "tunnel",
    at: { x: 0, y: -775 },
    mobs: ["grinch", "phoenix", "mole"],
  },
  xscorpion: {
    map: "halloween",
    at: { x: -219, y: 681 },
    mobs: ["phoenix", "xscorpion", "minimush"],
  },
  croc: {
    map: "main",
    at: { x: 676, y: 1754 },
    mobs: ["phoenix", "croc", "armadillo"],
  },
  ghost: {
    map: "halloween",
    between: ["ghost"],
    mobs: ["fvampire", "grinch", "phoenix", "ghost"],
  },
  squig: {
    map: "main",
    at: { x: -1111, y: 132 },
    mobs: ["phoenix", "frog", "squigtoad", "crab", "squig", "turtle", "crabx"],
  },
  plantoid: {
    map: "desertland",
    at: { x: -840.75, y: -340.75 },
    mobs: ["ent", "plantoid", "mechagnome"],
    tanker: PRIEST,
    warriorHeld: ["ent"],
  },
  prat: {
    map: "level1",
    at: { x: 50, y: 425 },
    mobs: ["prat"],
  },
  mummy: {
    map: "spookytown",
    at: { x: 256, y: -1253 },
    mobs: ["mummy"],
  },
  booboo: {
    map: "spookytown",
    at: { x: 412, y: -694 },
    mobs: ["jr", "booboo"],
  },
  dryad: {
    map: "mforest",
    at: { x: 403, y: -347 },
    mobs: ["dryad", "mechagnome"],
  },
  odino: {
    map: "mforest",
    at: { x: -25, y: 700 },
    mobs: ["paledino", "odino", "mechagnome"],
    tanker: PRIEST,
  },
};

/** Farm name -> its resolved spot */
const farmSpotCache = new Map();

/**
 * @param {SpotAnchor} anchor
 * @returns {{map: string, x: number, y: number}|undefined} a standable point for the anchor
 */
function getAnchorSpot({ map, at, between, mtype }) {
  if (at)
    return (
      strategicSmartMove.getStandablePointNear({ map, ...at }) ?? { map, ...at }
    );

  const spawns = (between ?? [mtype])
    .flatMap((type) => getMonsterSpawns(type))
    .filter((spawn) => spawn.map === map);
  if (!between || !spawns.length) return spawns[0];

  const middle = {
    map,
    x: Math.round(spawns.reduce((sum, { x }) => sum + x, 0) / spawns.length),
    y: Math.round(spawns.reduce((sum, { y }) => sum + y, 0) / spawns.length),
  };
  return strategicSmartMove.getStandablePointNear(middle) ?? middle;
}

/**
 * @param {string} name
 * @returns {Farm|undefined}
 */
function resolveFarm(name) {
  const config = FARMS[name];
  if (!config) return undefined;

  if (!farmSpotCache.has(name))
    farmSpotCache.set(name, getAnchorSpot({ mtype: name, ...config }));

  const spot = farmSpotCache.get(name);
  return (
    spot && {
      name,
      ...spot,
      mobs: config.mobs,
      tanker: config.tanker,
      warriorHeld: config.warriorHeld ?? [],
    }
  );
}

/**
 * Points the party at another farm; an unknown or missing name falls back to `defaultFarm`.
 * @param {string} [name]
 * @returns {string} the farm now current
 */
function setCurrentFarm(name = defaultFarm) {
  if (!FARMS[name]) {
    console.warn(`Unknown farm "${name}", using "${defaultFarm}"`);
    name = defaultFarm;
  }

  currentFarm = name;
  return currentFarm;
}

/** @returns {Farm} the current farm, else the default one when its spot cannot be found */
function getFarm() {
  return resolveFarm(currentFarm) ?? resolveFarm(defaultFarm);
}
