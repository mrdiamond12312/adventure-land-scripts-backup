/** Tunables for the corner-to-corner planner */
const TAUT_PATH_CONFIG = Object.freeze({
  CORNER_OFFSET: 2, // corners sit this far outside a wall's hitbox band
  WINDOW_MARGINS: [150, 400, 900], // search boxes around start and goal, smallest first
  MAX_NODES: 500, // a window holding more corners than this is left to the caller
  MAX_EDGE_CHECKS: 20000, // can_move calls one query may spend
  SNAP_RADIUS: 40, // how far a goal inside a wall band may be nudged out
  SNAP_STEP: 4,
  SNAP_ANGLES: 16,
  BUCKET_SIZE: 64, // spatial bucket edge for the inside-a-band test
  EDGE_CACHE_LIMIT: 250000, // cached corner pairs per map before the cache is dropped
  ARRIVED_DISTANCE: 4, // waypoints this close to us are already reached
});

/** Per-map corner graphs, keyed by map and hitbox */
const tautMeshes = new Map();

/**
 * Collinear wall segments joined into single lines, so their joints add no corners.
 * @param {number[][]} lines - G.geometry x_lines or y_lines, `[at, from, to]`
 * @returns {number[][]}
 */
function mergeCollinearLines(lines = []) {
  const sorted = [...lines].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];

  for (const [at, from, to] of sorted) {
    const last = merged[merged.length - 1];
    if (last && last[0] === at && from <= last[2]) {
      last[2] = Math.max(last[2], to);
      continue;
    }
    merged.push([at, from, to]);
  }

  return merged;
}

/**
 * Walls of one map inflated by a hitbox into the bands its center may not
 * enter, with the standable corners around them.
 * @param {string} map
 * @param {{h: number, v: number, vn: number}} base
 */
function buildTautMesh(map, base) {
  const geo = parent.G.geometry[map];
  if (!geo) return null;

  const rects = [];
  for (const [x, y1, y2] of mergeCollinearLines(geo.x_lines))
    rects.push([x - base.h, y1 - base.vn, x + base.h, y2 + base.v]);
  for (const [y, x1, x2] of mergeCollinearLines(geo.y_lines))
    rects.push([x1 - base.h, y - base.vn, x2 + base.h, y + base.v]);

  const size = TAUT_PATH_CONFIG.BUCKET_SIZE;
  const buckets = new Map();
  rects.forEach(([x1, y1, x2, y2], index) => {
    for (let bx = Math.floor(x1 / size); bx <= Math.floor(x2 / size); bx++) {
      for (let by = Math.floor(y1 / size); by <= Math.floor(y2 / size); by++) {
        const key = `${bx},${by}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(index);
      }
    }
  });

  const mesh = {
    map,
    base,
    bounds: [geo.min_x, geo.min_y, geo.max_x, geo.max_y],
    rects,
    buckets,
    xs: [],
    ys: [],
    sxs: [],
    sys: [],
    edges: new Map(),
  };

  const off = TAUT_PATH_CONFIG.CORNER_OFFSET;
  const seen = new Set();
  for (const [x1, y1, x2, y2] of rects) {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const x = sx < 0 ? x1 - off : x2 + off;
        const y = sy < 0 ? y1 - off : y2 + off;
        const key = `${x},${y}`;
        if (seen.has(key) || !isTautStandable(mesh, x, y)) continue;
        seen.add(key);
        mesh.xs.push(x);
        mesh.ys.push(y);
        mesh.sxs.push(sx);
        mesh.sys.push(sy);
      }
    }
  }

  return mesh;
}

/**
 * @param {string} map
 * @param {{h: number, v: number, vn: number}} base
 */
function getTautMesh(map, base) {
  const key = `${map}|${base.h},${base.v},${base.vn}`;
  if (tautMeshes.has(key)) return tautMeshes.get(key);

  // A generated floor's walls can land after its map key
  const mesh = buildTautMesh(map, base);
  if (mesh) tautMeshes.set(key, mesh);
  return mesh;
}

/** Whether a center point lies inside the map and outside every wall band */
function isTautStandable(mesh, x, y) {
  const [minX, minY, maxX, maxY] = mesh.bounds;
  if (x < minX || x > maxX || y < minY || y > maxY) return false;

  const size = TAUT_PATH_CONFIG.BUCKET_SIZE;
  const indices =
    mesh.buckets.get(`${Math.floor(x / size)},${Math.floor(y / size)}`) ?? [];

  return indices.every((index) => {
    const [x1, y1, x2, y2] = mesh.rects[index];
    return !(x > x1 && x < x2 && y > y1 && y < y2);
  });
}

/** The point itself, or the nearest standable one within SNAP_RADIUS */
function snapToStandable(mesh, point) {
  if (isTautStandable(mesh, point.x, point.y)) return point;

  const { SNAP_RADIUS, SNAP_STEP, SNAP_ANGLES } = TAUT_PATH_CONFIG;
  for (let r = SNAP_STEP; r <= SNAP_RADIUS; r += SNAP_STEP) {
    for (let i = 0; i < SNAP_ANGLES; i++) {
      const angle = (i / SNAP_ANGLES) * Math.PI * 2;
      const x = point.x + r * Math.cos(angle);
      const y = point.y + r * Math.sin(angle);
      if (isTautStandable(mesh, x, y)) return { x, y };
    }
  }

  return null;
}

/**
 * Whether the line through a corner only grazes the band it belongs to — a
 * taut path bends at a corner only along such lines.
 */
function isTangentAt(mesh, corner, dx, dy) {
  return dx * mesh.sxs[corner] * dy * mesh.sys[corner] <= 0;
}

/** Binary min-heap of `[priority, node]` */
class TautHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(item) {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (items[up][0] <= items[i][0]) break;
      [items[up], items[i]] = [items[i], items[up]];
      i = up;
    }
  }

  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let low = i;
        if (l < items.length && items[l][0] < items[low][0]) low = l;
        if (r < items.length && items[r][0] < items[low][0]) low = r;
        if (low === i) break;
        [items[low], items[i]] = [items[i], items[low]];
        i = low;
      }
    }
    return top;
  }
}

/**
 * A* over start, goal and the corners inside one window. Corner pairs are
 * checked lazily, only when they would improve a node, and cached per map.
 * @returns {{x: number, y: number}[] | null | undefined} undefined once the budget is spent
 */
function searchTautWindow(mesh, from, goal, corners, budget) {
  const count = corners.length + 2;
  const xs = [from.x, goal.x, ...corners.map((c) => mesh.xs[c])];
  const ys = [from.y, goal.y, ...corners.map((c) => mesh.ys[c])];
  const g = new Float64Array(count).fill(Infinity);
  const parentOf = new Int32Array(count).fill(-1);
  const closed = new Uint8Array(count);
  const open = new TautHeap();
  const cornerOf = (node) => (node >= 2 ? corners[node - 2] : -1);
  const heuristic = (node) => Math.hypot(xs[node] - goal.x, ys[node] - goal.y);

  const canWalk = (a, b) => {
    const ca = cornerOf(a);
    const cb = cornerOf(b);
    const cacheKey =
      ca >= 0 && cb >= 0 ? ca * mesh.xs.length + cb : undefined;
    if (cacheKey !== undefined && mesh.edges.has(cacheKey))
      return mesh.edges.get(cacheKey);

    budget.checks++;
    const walkable = can_move({
      map: mesh.map,
      x: xs[a],
      y: ys[a],
      going_x: xs[b],
      going_y: ys[b],
      base: mesh.base,
    });

    if (cacheKey !== undefined) {
      if (mesh.edges.size >= TAUT_PATH_CONFIG.EDGE_CACHE_LIMIT)
        mesh.edges.clear();
      mesh.edges.set(cacheKey, walkable);
    }
    return walkable;
  };

  g[0] = 0;
  open.push([heuristic(0), 0]);

  while (open.size) {
    const [, u] = open.pop();
    if (closed[u]) continue;
    closed[u] = 1;

    if (u === 1) {
      const path = [];
      for (let node = 1; node > 0; node = parentOf[node])
        path.unshift({ x: xs[node], y: ys[node] });
      return path;
    }

    const cu = cornerOf(u);
    for (let v = 1; v < count; v++) {
      if (closed[v] || v === u) continue;

      const dx = xs[v] - xs[u];
      const dy = ys[v] - ys[u];
      const cv = cornerOf(v);
      if (cu >= 0 && !isTangentAt(mesh, cu, dx, dy)) continue;
      if (cv >= 0 && !isTangentAt(mesh, cv, dx, dy)) continue;

      const tentative = g[u] + Math.hypot(dx, dy);
      if (tentative >= g[v]) continue;
      if (budget.checks >= TAUT_PATH_CONFIG.MAX_EDGE_CHECKS) return undefined;
      if (!canWalk(u, v)) continue;

      g[v] = tentative;
      parentOf[v] = u;
      open.push([tentative + heuristic(v), v]);
    }
  }

  return null;
}

/**
 * Shortest walk on one map that bends only at wall corners.
 * @param {string} map
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to - nudged out of a wall band when it sits in one
 * @param {{h: number, v: number, vn: number}} [base] - hitbox, defaults to ours
 * @returns {{x: number, y: number}[] | null} waypoints after `from`, ending at the goal
 */
function getTautPath(map, from, to, base = character.base) {
  const mesh = getTautMesh(map, base);
  if (!mesh) return null;

  const goal = snapToStandable(mesh, to);
  if (!goal) return null;

  const direct = { map, x: from.x, y: from.y, going_x: goal.x, going_y: goal.y };
  if (can_move({ ...direct, base })) return [{ x: goal.x, y: goal.y }];

  const budget = { checks: 0 };
  for (const margin of TAUT_PATH_CONFIG.WINDOW_MARGINS) {
    const minX = Math.min(from.x, goal.x) - margin;
    const maxX = Math.max(from.x, goal.x) + margin;
    const minY = Math.min(from.y, goal.y) - margin;
    const maxY = Math.max(from.y, goal.y) + margin;

    const corners = [];
    for (let c = 0; c < mesh.xs.length; c++) {
      const x = mesh.xs[c];
      const y = mesh.ys[c];
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) corners.push(c);
    }
    if (corners.length > TAUT_PATH_CONFIG.MAX_NODES) return null;

    const path = searchTautWindow(mesh, from, goal, corners, budget);
    if (path) return path;
    if (path === undefined) return null;
  }

  return null;
}

/**
 * Next point to walk to on the taut path from us to `to`, on our map.
 * @param {{x: number, y: number}} to
 * @returns {{x: number, y: number, isGoal: boolean} | null} null without a path or once arrived
 */
function getTautStep(to) {
  const from = { x: character.real_x, y: character.real_y };
  const path = getTautPath(character.map, from, to);
  if (!path) return null;

  const index = path.findIndex(
    (point) =>
      Math.hypot(point.x - from.x, point.y - from.y) >
      TAUT_PATH_CONFIG.ARRIVED_DISTANCE,
  );
  if (index < 0) return null;

  return { ...path[index], isGoal: index === path.length - 1 };
}
