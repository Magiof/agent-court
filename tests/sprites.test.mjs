import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Scene, CHARACTER_SCALE, KING_POS, hash, loadSprites, portraitUrl } from '../public/pixel.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const report = { date: '2026-10-01', cases: [], failures: [], fixtureOnly: false };
const canvases = [], imageUrls = [];
function canvas() {
  const calls = [], gradient = { addColorStop() {} };
  const context = new Proxy({
    drawImage: (...args) => calls.push({ kind: 'image', args }),
    translate: (...args) => calls.push({ kind: 'translate', args }),
    scale: (...args) => calls.push({ kind: 'scale', args }),
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    measureText: (text) => ({ width: text.length * 7 }),
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const c = { calls, style: {}, getContext: () => context, addEventListener() {}, setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 500 }),
    toDataURL: () => `data:image/png;fixture,${canvases.indexOf(c)}` };
  canvases.push(c); return c;
}
globalThis.document = { createElement: () => canvas() };
globalThis.window = { devicePixelRatio: 1 };
globalThis.Image = class {
  set src(url) { this.url = url; imageUrls.push(url); queueMicrotask(() => this.onload?.()); }
  get src() { return this.url; }
};

const grid = () => ({
  south: [{ x: 0, y: 0, foot: [50, 118] }],
  walk_south: [{ x: 100, y: 0, foot: [48, 116] }, { x: 200, y: 0, foot: [52, 119], flip: true }],
  north: [{ x: 0, y: 120, foot: [49, 118] }],
  walk_north: [{ x: 0, y: 120, foot: [49, 117] }],
  east: [{ x: 100, y: 120, foot: [51, 118] }],
  walk_east: [{ x: 100, y: 120, foot: [49, 116] }, { x: 200, y: 120, foot: [52, 119], flip: true }],
});
const normalized = (file = 'fixture-shared.png') => ({ file, w: 100, h: 120, foot: [50, 118], top: 8, worldHeight: 48, hitWidth: 14, nativePixelGrid: true, frames: grid() });
const fixture = {
  king: normalized(), yeonguijeong: normalized(),
  'pansoe-blue': { w: 25, h: 52, foot: [12, 49], frames: { south: [0], east: [50], west: [150], north: [100], 'walking-6-frames_east': [200, 225] } },
  'pansoe-green': normalized('fixture-green.png'),
  'commoner-man': { w: 26, h: 52, foot: [14, 49], frames: { south: 0, east: 52, west: 156, north: 104, walk_east: [208, 234] } },
  'commoner-woman': normalized('fixture-woman.png'),
  dokkaebi: { ...normalized('fixture-goblin.png'), worldHeight: 42 },
};
fixture.king.frames.south = [{ x: 0, y: 0, foot: [2, 118] }];
fixture['pansoe-green'].nativePixelGrid = false; // Optional contract still permits direct source-cell drawing.
fixture['pansoe-green'].frames.south = { x: 200, y: 120, foot: [99, 118] };
fixture.yeonguijeong.frames['walking-6-frames_east'] = fixture.yeonguijeong.frames.walk_east;
delete fixture.yeonguijeong.frames.walk_east;
fixture['commoner-woman'].frames.walk_west = [{ x: 200, y: 120, foot: [52, 119] }];
let metadata = fixture;
globalThis.fetch = async () => ({ json: async () => structuredClone(metadata) });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const sourceFrame = (meta, pose, phase = 0) => {
  const frames = meta.frames[pose] || meta.frames.south;
  const f = Array.isArray(frames) ? frames[phase % frames.length] : frames;
  return typeof f === 'number' ? { x: f, y: 0, foot: meta.foot } : { ...f, foot: f.foot || meta.foot };
};
const unit = (meta) => meta.worldHeight ? meta.worldHeight / (meta.foot[1] - (meta.top || 0)) : 1;
const session = { id: 'sprite-fixture', name: '시험', role: 'boss', location: 'rest', status: 'idle', subs: [] };

function assertSource(args, meta, frame) {
  if (meta.nativePixelGrid) {
    const native = args[0], width = Math.ceil(meta.w * unit(meta)), height = Math.ceil(meta.h * unit(meta));
    assert.equal(native.width, width); assert.equal(native.height, height);
    assert.deepEqual(args.slice(1, 5), [0, 0, width, height]);
    const source = native.calls.filter((call) => call.kind === 'image');
    assert.equal(source.length, 1, 'Native frame was rebuilt or omitted');
    assert.deepEqual(source[0].args.slice(1, 5), [frame.x, frame.y, meta.w, meta.h]);
    assert.deepEqual(source[0].args.slice(5), [0, 0, width, height]);
    assert.equal(native.getContext('2d').imageSmoothingEnabled, false);
    return source[0].args[0];
  }
  assert.deepEqual(args.slice(1, 5), [frame.x, frame.y, meta.w, meta.h]);
  return args[0];
}

function draw(scene, actor, meta, expectedPose, phase = 0, directionFlip = false) {
  actor.frame = phase; scene.canvas.calls.length = 0;
  const world = scene.actorWorld(actor), screen = scene.toScreen(...world);
  const time = 180 * (Math.PI * 1.5 - hash(actor.id) % 7); // 도깨비 idle bob은 0인 순간에 검사한다.
  scene.drawActor(actor, time);
  const images = scene.canvas.calls.filter((c) => c.kind === 'image');
  assert.equal(images.length, 1, 'Sprite used the missing-asset fallback');
  const args = images[0].args, f = sourceFrame(meta, expectedPose, phase);
  const flip = directionFlip !== !!f.flip;
  assert.equal(assertSource(args, meta, f).src, `assets/sprites/${meta.file || `${actor.slug}.png`}`);
  const scale = scene.view.zoom * CHARACTER_SCALE * (actor.kind === 'sub' ? 0.8 : 1) * unit(meta);
  close(args[7], meta.w * scale); close(args[8], meta.h * scale);
  if (flip) {
    assert.deepEqual(scene.canvas.calls.find((c) => c.kind === 'translate')?.args, screen);
    assert.deepEqual(scene.canvas.calls.find((c) => c.kind === 'scale')?.args, [-1, 1]);
    close(args[5] + f.foot[0] * scale, 0); close(args[6] + f.foot[1] * scale, 0);
  } else {
    assert.ok(!scene.canvas.calls.some((c) => c.kind === 'scale'));
    close(args[5] + f.foot[0] * scale, screen[0]); close(args[6] + f.foot[1] * scale, screen[1]);
  }
  assert.deepEqual(scene.actorWorld(actor), world, 'Drawing changed path coordinates');
  return args;
}

async function check(name, fn) {
  await test(name, async () => {
    try { await fn(); report.cases.push({ name, passed: true }); }
    catch (error) { report.cases.push({ name, passed: false }); report.failures.push({ name, message: error.message }); throw error; }
  });
}

try {
  const loaded = await loadSprites();
  await check('versioned sheet files load once and legacy walking aliases remain usable', () => {
    assert.equal(imageUrls.filter((url) => url === 'assets/sprites/fixture-shared.png').length, 1);
    assert.equal(loaded.sheets.king, loaded.sheets.yeonguijeong);
    assert.ok(imageUrls.includes('assets/sprites/commoner-man.png'));
    assert.deepEqual(loaded.index['pansoe-blue'].frames.walk_east, [200, 225]);
    assert.deepEqual(loaded.index.yeonguijeong.frames.walk_east, grid().walk_east);
  });

  const s = new Scene(canvas()); s.npcs = []; s.sync([session]);
  const actor = s.actors.get(session.id); actor.alpha = 1;
  await check('native frame caches keep fixed logical size and exact foot anchors across zoom changes', () => {
    assert.equal(CHARACTER_SCALE, 0.70);
    for (const [slug, meta] of Object.entries(loaded.index)) {
      if (slug === 'king') continue;
      actor.slug = slug; actor.kind = slug === 'dokkaebi' ? 'sub' : 'session'; actor.parent = session; actor.t = 1;
      draw(s, actor, meta, 'south');
      const [x, y] = s.toScreen(...s.actorWorld(actor));
      const height = meta.worldHeight || meta.foot[1] - (meta.top || 0), scale = CHARACTER_SCALE * (actor.kind === 'sub' ? 0.8 : 1);
      assert.equal(s.hitTest({ clientX: x, clientY: y - height * scale / 2 })?.id, actor.id);
    }
    s.canvas.calls.length = 0; s.drawKing(0, false);
    const args = s.canvas.calls.find((c) => c.kind === 'image').args, meta = loaded.index.king, f = sourceFrame(meta, 'south');
    assertSource(args, meta, f);
    const scale = CHARACTER_SCALE * unit(meta), [x, y] = s.toScreen(...KING_POS);
    close(args[5] + f.foot[0] * scale, x); close(args[6] + f.foot[1] * scale, y);
    close(args[8], meta.h * scale);
    actor.slug = 'commoner-woman'; actor.kind = 'session'; actor.t = 1;
    const first = draw(s, actor, loaded.index[actor.slug], 'south')[0], count = canvases.length;
    for (const zoom of [0.65, 2, 3.3]) {
      s.view.zoom = zoom;
      assert.equal(draw(s, actor, loaded.index[actor.slug], 'south')[0], first, 'Zoom rebuilt the native raster');
      assert.equal(canvases.length, count, 'Zoom created a new source raster');
    }
    s.view.zoom = 1;
    report.nativeCache = { zooms: [0.65, 2, 3.3], reuseVerified: true };
  });

  await check('two-row walking frames and per-frame mirroring retain foot anchors and fixed size', () => {
    actor.slug = 'yeonguijeong'; actor.kind = 'session'; actor.t = 0.5;
    const meta = loaded.index.yeonguijeong;
    actor.vertical = true; actor.down = true;
    draw(s, actor, meta, 'walk_south', 0); draw(s, actor, meta, 'walk_south', 1);
    actor.down = false; draw(s, actor, meta, 'walk_north');
    actor.vertical = false; actor.dir = 1;
    draw(s, actor, meta, 'walk_east', 0); draw(s, actor, meta, 'walk_east', 1);
    actor.dir = -1; draw(s, actor, meta, 'walk_east', 1, true);
    actor.slug = 'commoner-woman'; draw(s, actor, loaded.index['commoner-woman'], 'walk_west', 0, false);
    actor.slug = 'pansoe-blue'; actor.dir = 1; draw(s, actor, loaded.index['pansoe-blue'], 'walk_east', 1);
  });

  await check('portraits use the front cell, stay within it, and reset after a sheet replacement', async () => {
    for (const [slug, meta] of Object.entries(loaded.index)) for (const size of [68, 128]) {
      const before = canvases.length; portraitUrl({ slug }, size);
      const c = canvases[before], args = c.calls.find((call) => call.kind === 'image')?.args;
      assert.ok(args, `Empty portrait for ${slug}`);
      const f = sourceFrame(meta, 'south');
      assert.ok(args[1] >= f.x && args[1] + args[3] <= f.x + meta.w, `Portrait crosses a neighboring cell: ${slug}`);
      assert.ok(args[2] >= f.y && args[2] + args[4] <= f.y + meta.h, `Portrait crosses a neighboring row: ${slug}`);
      assert.ok(args[3] > 0 && args[4] > 0); assert.equal(args[7], size); assert.equal(args[8], size);
    }
    const original = portraitUrl({ slug: 'king' }, 128);
    actor.slug = 'king'; actor.kind = 'session'; actor.t = 1;
    const oldRaster = draw(s, actor, loaded.index.king, 'south')[0];
    metadata = structuredClone(fixture); metadata.king.file = 'fixture-king-replacement.png';
    const replacement = await loadSprites();
    assert.notEqual(portraitUrl({ slug: 'king' }, 128), original, 'Portrait remained cached from the old sheet');
    assert.equal(canvases.at(-1).calls.find((call) => call.kind === 'image').args[0].src, 'assets/sprites/fixture-king-replacement.png');
    const newArgs = draw(s, actor, replacement.index.king, 'south');
    assert.notEqual(newArgs[0], oldRaster, 'Native raster survived sprite replacement');
    assert.equal(assertSource(newArgs, replacement.index.king, sourceFrame(replacement.index.king, 'south')), replacement.sheets.king);
    report.nativeCache.clearedOnReload = true;
  });

  await check('production PNG dimensions, every referenced frame, and front portraits reach the real consumer', async () => {
    metadata = JSON.parse(readFileSync(`${root}/public/assets/sprites/index.json`, 'utf8'));
    const files = new Map();
    for (const [slug, meta] of Object.entries(metadata)) {
      const file = meta.file || `${slug}.png`, png = readFileSync(`${root}/public/assets/sprites/${file}`);
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `Invalid PNG: ${slug}`);
      files.set(`assets/sprites/${file}`, { width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
      assert.equal(meta.worldHeight, slug === 'dokkaebi' ? 42 : 48);
      assert.equal(meta.hitWidth, 14);
      assert.equal(meta.nativePixelGrid, true, `Production asset did not opt into the native pixel grid: ${slug}`);
    }
    globalThis.Image = class {
      set src(url) {
        const file = files.get(url);
        assert.ok(file, `Consumer requested missing asset: ${url}`);
        this.url = url; Object.assign(this, file); queueMicrotask(() => this.onload?.());
      }
      get src() { return this.url; }
    };
    const production = await loadSprites();
    assert.deepEqual(Object.keys(production.sheets).sort(), Object.keys(metadata).sort());
    let framesChecked = 0;
    for (const [slug, meta] of Object.entries(production.index)) {
      actor.slug = slug; actor.kind = slug === 'dokkaebi' ? 'sub' : 'session'; actor.parent = session;
      for (const [pose, frames] of Object.entries(meta.frames)) {
        const count = Array.isArray(frames) ? frames.length : 1;
        for (let phase = 0; phase < count; phase++) {
          const f = sourceFrame(meta, pose, phase), image = production.sheets[slug];
          assert.ok(f.x >= 0 && f.y >= 0 && f.x + meta.w <= image.width && f.y + meta.h <= image.height, `Source frame crosses PNG bounds: ${slug}/${pose}/${phase}`);
          actor.t = pose.startsWith('walk_') ? 0.5 : 1;
          actor.vertical = pose.endsWith('_south') || pose.endsWith('_north');
          actor.down = pose.endsWith('_south'); actor.dir = pose.endsWith('_west') ? -1 : 1;
          // drawActor uses south while idle; other idle poses are checked as the same direction's walking fallback.
          if (!pose.startsWith('walk_') && pose !== 'south') {
            const direction = pose;
            const walk = meta.frames[`walk_${direction}`];
            if (walk || (direction === 'east' || direction === 'west') && meta.frames.walk_east) continue;
            actor.t = 0.5; actor.vertical = direction === 'north' || direction === 'south'; actor.down = direction === 'south'; actor.dir = direction === 'west' ? -1 : 1;
          }
          draw(s, actor, meta, pose, phase); framesChecked++;
        }
      }
      for (const size of [68, 128]) {
        const before = canvases.length; portraitUrl({ slug }, size);
        const args = canvases[before].calls.find((call) => call.kind === 'image').args, front = sourceFrame(meta, 'south');
        assert.equal(args[0], production.sheets[slug]);
        assert.ok(args[1] >= front.x && args[1] + args[3] <= front.x + meta.w);
        assert.ok(args[2] >= front.y && args[2] + args[4] <= front.y + meta.h);
      }
    }
    report.production = { assets: Object.keys(production.sheets).length, uniquePngFiles: files.size, nativePixelGridAssets: Object.values(production.index).filter((meta) => meta.nativePixelGrid).length, consumerDrawFrames: framesChecked, portraits: Object.keys(production.sheets).length * 2 };
  });
} finally {
  report.passed = report.failures.length === 0;
  mkdirSync(`${root}/output/qa`, { recursive: true });
  writeFileSync(`${root}/output/qa/sprite-renderer-fixtures-20261001.json`, `${JSON.stringify(report, null, 2)}\n`);
}
