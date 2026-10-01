import { BUILDING_LAYOUT, WALKABLE_CORRIDORS } from './concept-map.js';

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const keyOf = (p) => p.map((v) => v.toFixed(6)).join(',');
const interpolate = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function nearestOnSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  const point = interpolate(a, b, t);
  return { point, t, distance: distance(p, point) };
}
export function routeLength(points) {
  return points?.reduce((sum, p, i) => sum + (i ? distance(points[i - 1], p) : 0), 0) || 0;
}
export function pointAtDistance(points, d) {
  if (!points?.length) return null;
  if (d <= 0) return [...points[0]];
  for (let i = 1; i < points.length; i++) {
    const len = distance(points[i - 1], points[i]);
    if (d <= len) return interpolate(points[i - 1], points[i], len ? d / len : 1);
    d -= len;
  }
  return [...points[points.length - 1]];
}

export function createNavigation(corridors = WALKABLE_CORRIDORS, buildings = BUILDING_LAYOUT) {
  const nodes = new Map(), edges = [];
  const node = (p) => { const key = keyOf(p); if (!nodes.has(key)) nodes.set(key, { point: p, links: [] }); return key; };
  for (const c of corridors) for (let i = 1; i < c.points.length; i++) {
    const a = c.points[i - 1], b = c.points[i], ak = node(a), bk = node(b), len = distance(a, b);
    nodes.get(ak).links.push([bk, len]); nodes.get(bk).links.push([ak, len]);
    edges.push({ a, b, ak, bk, len, width: c.width, kind: c.kind });
  }
  const nearest = (p, radius = null) => {
    let best = null;
    for (const edge of edges) {
      const n = nearestOnSegment(p, edge.a, edge.b);
      if (radius !== null && n.distance > edge.width / 2 - radius + 1e-7) continue;
      if (!best || n.distance < best.distance) best = { ...n, edge };
    }
    return best;
  };
  const project = (p) => [...nearest(p).point];
  const isWalkable = (p, radius = 3) => edges.some((e) => nearestOnSegment(p, e.a, e.b).distance <= e.width / 2 - radius + 1e-7);
  function route(from, to) {
    if (!isWalkable(from) || !isWalkable(to)) return null;
    const start = nearest(from, 3), end = nearest(to, 3);
    const distances = new Map(), previous = new Map(), open = new Set();
    for (const [id, length] of [[start.edge.ak, start.t * start.edge.len], [start.edge.bk, (1 - start.t) * start.edge.len]]) {
      distances.set(id, length); previous.set(id, null); open.add(id);
    }
    while (open.size) {
      let at = null;
      for (const id of open) if (at === null || distances.get(id) < distances.get(at)) at = id;
      open.delete(at);
      for (const [id, len] of nodes.get(at).links) {
        const value = distances.get(at) + len;
        if (value < (distances.get(id) ?? Infinity)) { distances.set(id, value); previous.set(id, at); open.add(id); }
      }
    }
    const candidates = [[end.edge.ak, end.t * end.edge.len], [end.edge.bk, (1 - end.t) * end.edge.len]];
    candidates.sort((a, b) => (distances.get(a[0]) ?? Infinity) + a[1] - ((distances.get(b[0]) ?? Infinity) + b[1]));
    const finish = candidates[0];
    if (!Number.isFinite(distances.get(finish[0]))) return null;
    const chain = [];
    for (let id = finish[0]; id !== null; id = previous.get(id)) chain.unshift(nodes.get(id).point);
    let middle = [start.point, ...chain, end.point];
    if (start.edge === end.edge && distance(start.point, end.point) <= routeLength(middle)) middle = [start.point, end.point];
    const result = [[...from], ...middle.map((p) => [...p]), [...to]];
    return result.filter((p, i) => !i || distance(result[i - 1], p) > 1e-8);
  }
  const standing = new Map();
  function standingPosition(buildingKey, index = 0) {
    const entry = buildings[buildingKey]?.entry;
    if (!entry) throw new Error(`Unknown building: ${buildingKey}`);
    if (!standing.has(buildingKey)) {
      const candidates = new Map();
      for (const e of edges) {
        if (e.kind === 'portal') continue;
        const count = Math.max(1, Math.ceil(e.len / 5));
        for (let i = 0; i <= count; i++) {
          const p = interpolate(e.a, e.b, i / count);
          if (isWalkable(p)) candidates.set(keyOf(p), p);
        }
      }
      const ordered = [...candidates.values()].sort((a, b) => distance(entry, a) - distance(entry, b));
      const points = [project(entry)];
      for (const p of ordered) if (points.every((q) => distance(p, q) >= 14)) points.push(p);
      standing.set(buildingKey, points);
    }
    const points = standing.get(buildingKey);
    if (index < 0 || index >= points.length) throw new Error(`No safe standing position ${buildingKey}:${index}`);
    return [...points[index]];
  }
  const strollNodes = [...nodes.values()].filter((n) => !edges.some((e) => e.kind === 'portal' && (e.ak === keyOf(n.point) || e.bk === keyOf(n.point)))).map((n) => [...n.point]);
  return { route, project, isWalkable, pointAtDistance, routeLength, standingPosition, strollNodes };
}
export const navigation = createNavigation();
export const { route, project, isWalkable, standingPosition, strollNodes } = navigation;
