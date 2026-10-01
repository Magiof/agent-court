import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Scene, BUILDINGS, WORLD, KING_POS, CHARACTER_SCALE, loadSprites } from '../public/pixel.js';
import { navigation } from '../public/navigation.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const report = { date: '2026-10-01', cases: [], metrics: {}, failures: [] };
const samples = new Map();
const length = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const sourceScale = (meta) => meta.worldHeight ? meta.worldHeight / (meta.foot[1] - (meta.top || 0)) : 1;
const close = (a, b, epsilon = 1e-6) => assert.ok(length(a, b) <= epsilon, `${a} != ${b}`);
const point = (p) => assert.ok(Array.isArray(p) && p.length === 2 && p.every(Number.isFinite), `Invalid point ${p}`);
const record = (p, kind) => {
  point(p);
  assert.ok(p[0] >= 0 && p[0] <= WORLD.w && p[1] >= 0 && p[1] <= WORLD.h, `Outside world: ${p}`);
  const key = `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
  if (!samples.has(key)) samples.set(key, { x: p[0], y: p[1], kind });
};

function routeSamples(route, kind) {
  assert.ok(Array.isArray(route) && route.length > 0, `Missing route: ${kind}`);
  for (let i = 0; i < route.length; i++) {
    record(route[i], kind);
    if (!i) continue;
    const a = route[i - 1], b = route[i], n = Math.max(1, Math.ceil(length(a, b) / 3));
    for (let j = 1; j < n; j++) record([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n], kind);
  }
}

function fakeCanvas() {
  const gradient = { addColorStop() {} };
  const imageCalls = [];
  const context = new Proxy({ drawImage: (...args) => imageCalls.push(args), createLinearGradient: () => gradient, createRadialGradient: () => gradient, measureText: (s) => ({ width: s.length * 7 }) }, {
    get(target, key) { return key in target ? target[key] : () => {}; },
    set(target, key, value) { target[key] = value; return true; },
  });
  return { width: 800, height: 500, imageCalls, style: {}, getContext: () => context, addEventListener() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ width: 800, height: 500, left: 0, top: 0 }) };
}
globalThis.document = { createElement: () => fakeCanvas() };
globalThis.window = { devicePixelRatio: 1 };
let seed = 0x102026;
const originalRandom = Math.random;
Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const scene = () => new Scene(fakeCanvas(), { map: { width: 1546, height: 1017 } });
const session = (id, location, subs = [], role = 'member') => ({ id, name: id, project: 'validation', location, status: 'idle', role, subs });

function simulate(s, seconds, kind, onStep = () => {}) {
  const dt = 0.04;
  for (let n = 0; n < Math.ceil(seconds / dt); n++) {
    const before = new Map([...s.actors].map(([id, a]) => [id, s.actorWorld(a)]));
    s.step(dt);
    for (const [id, a] of s.actors) {
      const position = s.actorWorld(a);
      record(position, `${kind}:actor:${id}`);
      if (before.has(id) && !a.removing) assert.ok(length(position, before.get(id)) <= 20, `Actor teleported in one 40ms frame: ${id}`);
    }
    for (const n of s.npcs) record([n.x, n.y], `${kind}:npc`);
    onStep(n * dt);
  }
}

async function check(name, fn) {
  const start = performance.now();
  await test(name, async () => {
    try { await fn(); report.cases.push({ name, passed: true, durationMs: Math.round(performance.now() - start) }); }
    catch (error) { report.cases.push({ name, passed: false, durationMs: Math.round(performance.now() - start) }); report.failures.push({ name, message: error.message }); throw error; }
  });
}

try {
  await check('all 42 distinct building pairs have continuous routes and correct endpoints', () => {
    let pairs = 0;
    for (const from of BUILDINGS) for (const to of BUILDINGS) {
      if (from.key === to.key) continue;
      const route = navigation.route(from.entry, to.entry);
      routeSamples(route, `route:${from.key}->${to.key}`);
      close(route[0], from.entry); close(route.at(-1), to.entry);
      const measured = route.slice(1).reduce((sum, p, i) => sum + length(route[i], p), 0);
      assert.ok(measured >= length(from.entry, to.entry) - 1e-6);
      assert.ok(Math.abs(navigation.routeLength(route) - measured) < 1e-6);
      close(navigation.pointAtDistance(route, 0), from.entry);
      close(navigation.pointAtDistance(route, measured + 1), to.entry);
      pairs++;
    }
    assert.equal(pairs, 42); report.metrics.buildingPairs = pairs;
  });

  await check('real Scene moves all 42 building pairs without teleporting or corner cuts', () => {
    for (const from of BUILDINGS) for (const to of BUILDINGS) {
      if (from.key === to.key) continue;
      const s = scene(); s.npcs = [];
      s.sync([session('traveller', from.key)]);
      const actor = s.actors.get('traveller'); const start = s.actorWorld(actor);
      s.sync([session('traveller', to.key)]);
      close(s.actorWorld(actor), start);
      routeSamples(actor.route, `scene:${from.key}->${to.key}`);
      simulate(s, 30, `scene:${from.key}->${to.key}`);
      close(s.actorWorld(actor), navigation.standingPosition(to.key, 0), 0.05);
      assert.equal(actor.t, 1);
    }
    report.metrics.sceneBuildingPairs = 42;
  });

  await check('sessions and subagents reroute mid-motion, spawn safely, and remove cleanly', () => {
    const s = scene(); s.npcs = [];
    s.sync([session('boss', 'inbox', [{ id: 'sub-a', location: 'research', status: 'working' }], 'boss')]);
    for (const actor of s.actors.values()) routeSamples(actor.route, `spawn:${actor.id}`);
    simulate(s, 2, 'spawn');
    s.sync([session('boss', 'test', [{ id: 'sub-a', location: 'build', status: 'working' }], 'boss')]);
    simulate(s, 0.6, 'before-reroute');
    const before = new Map([...s.actors].map(([id, a]) => [id, s.actorWorld(a)]));
    s.sync([session('boss', 'approval', [{ id: 'sub-a', location: 'rest', status: 'idle' }, { id: 'sub-b', location: 'check', status: 'working' }], 'boss')]);
    for (const [id, p] of before) close(s.actorWorld(s.actors.get(id)), p);
    for (const actor of s.actors.values()) routeSamples(actor.route, `reroute:${actor.id}`);
    simulate(s, 30, 'reroute');
    close(s.actorWorld(s.actors.get('boss')), navigation.standingPosition('approval', 0), 0.05);
    close(s.actorWorld(s.actors.get('sub-a')), navigation.standingPosition('rest', 0), 0.05);
    s.sync([]); simulate(s, 2, 'remove'); assert.equal(s.actors.size, 0);
    report.metrics.subagentsTested = 2;
  });

  await check('12-person crowd uses unique world-space slots and animates reassignment', () => {
    for (const building of BUILDINGS) {
      const slots = Array.from({ length: 12 }, (_, i) => navigation.standingPosition(building.key, i));
      for (let i = 0; i < slots.length; i++) {
        record(slots[i], `standing:${building.key}:${i}`);
        for (let j = 0; j < i; j++) assert.ok(length(slots[i], slots[j]) >= 14 - 1e-6, `${building.key} crowd slots ${j}/${i} overlap`);
      }
    }
    const s = scene(); s.npcs = [];
    const crowd = Array.from({ length: 12 }, (_, i) => session(`member-${String(i).padStart(2, '0')}`, 'rest'));
    s.sync(crowd); simulate(s, 30, 'crowd');
    const positions = [...s.actors.values()].map((a) => s.actorWorld(a));
    assert.equal(new Set(positions.map((p) => p.map((v) => v.toFixed(3)).join(','))).size, 12, 'Crowd slots repeat');
    let minSpacing = Infinity;
    for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) minSpacing = Math.min(minSpacing, length(positions[i], positions[j]));
    assert.ok(minSpacing >= 14 - 1e-6, `Crowd feet are only ${minSpacing.toFixed(2)} world px apart`);
    report.metrics.crowdMinimumSpacing = minSpacing;
    const before = new Map([...s.actors].map(([id, a]) => [id, s.actorWorld(a)]));
    s.sync(crowd.slice(1));
    let moving = 0;
    for (const [id, a] of s.actors) if (!a.removing) {
      close(s.actorWorld(a), before.get(id));
      if (a.t < 1) { moving++; routeSamples(a.route, `slot-change:${id}`); }
    }
    assert.ok(moving > 0, 'Slot reassignment did not animate');
    simulate(s, 30, 'slot-change'); report.metrics.crowdSize = 12; report.metrics.slotReassignments = moving;
  });

  await check('zoom, fit, focus, and full-map view do not move actor world positions', () => {
    const s = scene(); s.npcs = [];
    s.sync(Array.from({ length: 10 }, (_, i) => session(`zoom-${i}`, 'rest')));
    simulate(s, 30, 'zoom-before');
    const before = new Map([...s.actors].map(([id, a]) => [id, s.actorWorld(a)]));
    s.fit({ getBoundingClientRect: () => ({ width: 900, height: 550 }) });
    for (let i = 0; i < 5; i++) s.zoomAt(450, 275, 1.2);
    for (const [id, a] of s.actors) close(s.actorWorld(a), before.get(id));
    s.focus('zoom-0'); s.step(0.04); s.showAll(); s.step(0.04);
    for (const [id, a] of s.actors) close(s.actorWorld(a), before.get(id));
    assert.equal(s.fitZoom, Math.min(900 / WORLD.w, 550 / WORLD.h));
    report.metrics.zoomCrowdSize = 10;
  });

  await check('NPCs remain on visible paths over 240 simulated seconds', () => {
    const s = scene();
    simulate(s, 240, 'npc-long');
    for (const n of s.npcs) if (n.route) routeSamples(n.route, 'npc-final-route');
    report.metrics.npcCount = s.npcs.length; report.metrics.npcSimulatedSeconds = 240;
  });

  await check('actual frame draws all character roles at 0.70 scale and keeps body hit targets aligned', async () => {
    assert.equal(CHARACTER_SCALE, 0.70);
    const index = JSON.parse(readFileSync(`${root}/public/assets/sprites/index.json`, 'utf8'));
    const previousFetch = globalThis.fetch, previousImage = globalThis.Image;
    globalThis.fetch = async () => ({ json: async () => index });
    globalThis.Image = class {
      set src(value) { this.url = value; queueMicrotask(() => this.onload?.()); }
      get src() { return this.url; }
    };
    let loaded;
    try { loaded = await loadSprites(); }
    finally { globalThis.fetch = previousFetch; globalThis.Image = previousImage; }
    const s = scene();
    s.sync([session('body-main', 'rest', [{ id: 'body-sub', location: 'research', status: 'idle' }], 'boss')]);
    simulate(s, 30, 'frame-spawn');
    const slugs = new Map();
    for (const [slug, image] of Object.entries(loaded.sheets)) slugs.set(image, [...(slugs.get(image) || []), slug]);
    const sourceSlugs = (image) => slugs.get(image) || slugs.get(image.imageCalls?.find((args) => slugs.has(args[0]))?.[0]);
    const calls = [];
    s.ctx.drawImage = (...args) => { if (args.length === 9 && sourceSlugs(args[0])) calls.push(args); };
    s.nightOverride = 'day'; s.frame(s.lastT + 40);
    assert.equal(calls.length, s.npcs.length + s.actors.size + 1, 'Frame omitted a character or duplicated one');
    for (const args of calls) {
      const candidates = sourceSlugs(args[0]);
      assert.ok(candidates.some((slug) => {
        const scale = s.view.zoom * CHARACTER_SCALE * (slug === 'dokkaebi' ? 0.8 : 1) * sourceScale(index[slug]);
        return Math.abs(args[7] - index[slug].w * scale) < 1e-6 && Math.abs(args[8] - index[slug].h * scale) < 1e-6;
      }), `Wrong drawn normalized size: ${candidates}`);
    }
    for (const [id, a] of s.actors) {
      const [x, y] = s.toScreen(...s.actorWorld(a));
      const meta = index[a.slug], scale = s.view.zoom * CHARACTER_SCALE * (a.kind === 'sub' ? 0.8 : 1) * sourceScale(meta);
      const hit = s.hitTest({ clientX: x, clientY: y - (meta.foot[1] - (meta.top || 0)) * scale / 2 });
      assert.equal(hit?.type, 'actor'); assert.equal(hit?.id, id);
    }
    const [kx, ky] = s.toScreen(...KING_POS), king = index.king;
    assert.equal(s.hitTest({ clientX: kx, clientY: ky - (king.foot[1] - (king.top || 0)) * sourceScale(king) * CHARACTER_SCALE * s.view.zoom / 2 })?.type, 'king');
    report.metrics.frameCharacterBodies = calls.length;
  });

  await check('crowded names separate and shifted name clicks preserve actor world positions', () => {
    const s = scene(); s.npcs = [];
    s.fit({ getBoundingClientRect: () => ({ width: 800, height: 500 }) });
    const left = session('tag-left', 'rest'), right = session('tag-right', 'rest');
    left.name = '호조판서'; right.name = '병조판서';
    s.sync([left, right]); simulate(s, 30, 'nameplates');
    s.showAll(); s.step(0.04);
    const before = new Map([...s.actors].map(([id, a]) => [id, s.actorWorld(a)]));
    s.nightOverride = 'day'; s.frame(s.lastT + 40);
    const labels = s.nameplates.filter((p) => p.type === 'actor');
    assert.equal(labels.length, 2);
    const [a, b] = labels.map((p) => p.box);
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'Nameplates still overlap');
    const shifted = labels.filter((p) => p.box.y > p.sy + 3);
    assert.ok(shifted.length > 0, 'Fixture did not exercise a shifted label');
    for (const label of labels) {
      const hit = s.hitTest({ clientX: label.box.x + label.box.w / 2, clientY: label.box.y + label.box.h / 2 });
      assert.equal(hit?.type, 'actor'); assert.equal(hit?.id, label.id);
    }
    for (const [id, p] of before) close(s.actorWorld(s.actors.get(id)), p);
    report.metrics.shiftedNameplates = shifted.length;
  });

  await check('sampled route and actor feet agree with independently checked map pixels', () => {
    record(KING_POS, 'king');
    const result = spawnSync('python3', [new URL('./validate-road-pixels.py', import.meta.url).pathname], {
      cwd: root, input: JSON.stringify({ samples: [...samples.values()] }), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stderr);
    const raster = JSON.parse(result.stdout); report.raster = raster;
    assert.equal(raster.failedCount, 0, JSON.stringify(raster.failures.slice(0, 12)));
  });
} finally {
  Math.random = originalRandom;
  report.metrics.uniqueFootSamples = samples.size;
  report.passed = report.failures.length === 0;
  mkdirSync(`${root}/output/qa`, { recursive: true });
  writeFileSync(`${root}/output/qa/map-paths-validation-20261001.json`, `${JSON.stringify(report, null, 2)}\n`);
}
