// 도트 한양 — 승인된 조선 지도 위에 실시간 인물을 올린다. 세계 좌표 = 도트 1px
import { WORLD, BUILDING_LAYOUT, KING_POS, GATE } from './concept-map.js';
import { navigation } from './navigation.js';
export { WORLD, KING_POS, GATE };
export const CHARACTER_SCALE = 0.70;

// 관청 설명과 색상. 위치·크기·정문은 승인된 지도 설계도에서 읽는다.
export const BUILDINGS = [
  { key: 'approval', label: '어전', hanja: '御前 · 仁政殿', desc: '전하의 윤허를 기다리는 곳', color: '#e8b73a' },
  { key: 'inbox', label: '승정원', hanja: '承政院', desc: '어명 접수 · 하명 · 장계', color: '#5d8fc9' },
  { key: 'research', label: '규장각', hanja: '奎章閣', desc: '문서 열람 · 수색 · 조회', color: '#8e6bbf' },
  { key: 'test', label: '과거장', hanja: '科場 · 春塘臺', desc: '시험 (테스트 · 타입체크)', color: '#d9653b' },
  { key: 'build', label: '공조', hanja: '工曹', desc: '문서 수정 · 작성 · 명령 시행', color: '#3f9a6e' },
  { key: 'check', label: '사헌부', hanja: '司憲府', desc: '변경 점검 · 검수', color: '#c9a227' },
  { key: 'rest', label: '주막', hanja: '酒幕', desc: '복명 후 대기 · 휴식', color: '#7aa89a' },
];
export const BUILDING = Object.fromEntries(BUILDINGS.map((b) => [b.key, b]));
// 배경에 그려진 관청과 클릭·표식·정문 좌표를 같은 설계도에 맞춘다.
export function layoutBuildings() {
  for (const b of BUILDINGS) {
    const m = BUILDING_LAYOUT[b.key];
    if (!m) throw new Error(`지도에 ${b.key} 관청 좌표가 없습니다`);
    Object.assign(b, m, { scale: 1 });
    b.base = [b.img[0] + b.size[0] / 2, b.img[1] + b.size[1]];
  }
}
layoutBuildings();
const ZOOMS = [0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];

const SLEEP_MS = 10 * 60_000;
export const effStatus = (s) => (s.status === 'idle' && Date.now() - s.lastTs > SLEEP_MS ? 'sleep' : s.status);
export function hash(str) { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

// ── 인물 (스프라이트) ───────────────────────────────────
export const KING_LOOK = { slug: 'king' };
export const GOBLIN_LOOK = { slug: 'dokkaebi' };
const MEMBER_SLUGS = ['pansoe-blue', 'pansoe-green'];
export function lookOf(s) {
  if (!s) return { slug: 'commoner-man' };
  if (s.role === 'boss') return { slug: 'yeonguijeong' };
  if (s.role === 'member') return { slug: MEMBER_SLUGS[hash(s.id) % MEMBER_SLUGS.length] };
  return { slug: hash(s.id) % 2 ? 'commoner-man' : 'commoner-woman' };
}

let SPRITES = { index: {}, sheets: {} };
const nativeSpriteCache = new Map();
export async function loadSprites() {
  try {
    const index = await (await fetch('assets/sprites/index.json', { cache: 'no-cache' })).json();
    const sheets = {}, images = new Map();
    await Promise.all(Object.entries(index).map(async ([slug, meta]) => {
      const file = meta.file || `${slug}.png`;
      if (!images.has(file)) images.set(file, new Promise((ok) => {
        const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = `assets/sprites/${file}`;
      }));
      const im = await images.get(file);
      if (im) sheets[slug] = im;
    }));
    // 걷기 동작 이름이 'walking-6-frames_east' 처럼 와도 walk_east로 쓰게 맞춘다
    for (const meta of Object.values(index)) {
      for (const dir of ['east', 'west', 'south', 'north']) {
        const k = Object.keys(meta.frames).find((n) => /walk/i.test(n) && n.endsWith(`_${dir}`));
        if (k && !meta.frames[`walk_${dir}`]) meta.frames[`walk_${dir}`] = meta.frames[k];
      }
    }
    SPRITES = { index, sheets };
    nativeSpriteCache.clear();
    portraitCache.clear();
  } catch { SPRITES = { index: {}, sheets: {} }; nativeSpriteCache.clear(); }
  return SPRITES;
}
// 숫자 프레임은 기존 가로 시트 x, 객체 프레임은 여러 행으로 된 시트의 x·y와 발 위치다.
function frameOf(slug, name, t) {
  const meta = SPRITES.index[slug];
  if (!meta) return null;
  const f = meta.frames[name] ?? meta.frames.south;
  if (f === undefined) return null;
  const frame = Array.isArray(f) ? f[Math.floor(t) % f.length] : f;
  if (frame === undefined) return null;
  return typeof frame === 'number' ? { x: frame, y: 0, foot: meta.foot, flip: false } : { x: frame.x, y: frame.y, foot: frame.foot || meta.foot, flip: !!frame.flip };
}
const spriteUnitScale = (slug) => {
  const m = SPRITES.index[slug];
  return m?.worldHeight ? m.worldHeight / Math.max(1, m.foot[1] - (m.top ?? 0)) : 1;
};
function nativeFrame(slug, frame, meta, sheet) {
  const key = `${slug}|${frame.x}|${frame.y}`;
  if (!nativeSpriteCache.has(key)) {
    const unit = spriteUnitScale(slug), c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(meta.w * unit)); c.height = Math.max(1, Math.ceil(meta.h * unit));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet, frame.x, frame.y, meta.w, meta.h, 0, 0, c.width, c.height);
    nativeSpriteCache.set(key, c);
  }
  return nativeSpriteCache.get(key);
}
function drawSprite(ctx, slug, name, t, sx, sy, scale, flip, alpha = 1) {
  const meta = SPRITES.index[slug], sheet = SPRITES.sheets[slug];
  const frame = frameOf(slug, name, t);
  if (!meta || !sheet || frame === null) { // 스프라이트가 아직 없으면 자리표시
    ctx.fillStyle = '#b3262b'; ctx.fillRect(sx - 6 * scale, sy - 26 * scale, 12 * scale, 26 * scale);
    return;
  }
  const [fxo, fyo] = frame.foot;
  scale *= spriteUnitScale(slug);
  flip = !!flip !== frame.flip;
  const source = meta.nativePixelGrid ? nativeFrame(slug, frame, meta, sheet) : sheet;
  const rect = meta.nativePixelGrid ? [0, 0, source.width, source.height] : [frame.x, frame.y, meta.w, meta.h];
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  if (flip) { ctx.translate(sx, sy); ctx.scale(-1, 1); ctx.drawImage(source, ...rect, -fxo * scale, -fyo * scale, meta.w * scale, meta.h * scale); }
  else ctx.drawImage(source, ...rect, sx - fxo * scale, sy - fyo * scale, meta.w * scale, meta.h * scale);
  ctx.restore();
}
const spriteHeight = (slug) => { const m = SPRITES.index[slug]; return m ? (m.foot[1] - (m.top ?? 0)) * spriteUnitScale(slug) : 40; };
const spriteHalfWidth = (slug) => SPRITES.index[slug]?.hitWidth ?? 12;
function walkingPose(slug, moving, dir, vertical, down) {
  if (!moving) return { name: 'south', flip: false };
  const direction = vertical ? (down ? 'south' : 'north') : (dir < 0 ? 'west' : 'east');
  const frames = SPRITES.index[slug]?.frames || {};
  if (frames[`walk_${direction}`]) return { name: `walk_${direction}`, flip: false };
  if (!vertical && frames.walk_east) return { name: 'walk_east', flip: dir < 0 };
  return { name: direction, flip: false };
}

// DOM 초상화 (south 프레임 상반신)
const portraitCache = new Map();
export function portraitUrl(look, size = 64) {
  const key = look.slug + size;
  if (portraitCache.has(key)) return portraitCache.get(key);
  const meta = SPRITES.index[look.slug], sheet = SPRITES.sheets[look.slug];
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#efe3c4'; ctx.fillRect(0, 0, size, size);
  if (meta && sheet) {
    ctx.imageSmoothingEnabled = false;
    const frame = frameOf(look.slug, 'south', 0);
    const top = Math.max(0, Math.min(meta.h - 1, meta.top ?? 0));
    const crop = Math.max(1, Math.min(meta.w, meta.h - top, Math.round((frame.foot[1] - top) * 0.62)));
    const x = Math.max(0, Math.min(meta.w - crop, Math.round(frame.foot[0] - crop / 2)));
    ctx.drawImage(sheet, frame.x + x, frame.y + top, crop, crop, 0, 0, size, size);
    const url = c.toDataURL(); portraitCache.set(key, url); return url;
  }
  return c.toDataURL();
}

// ── 승인된 지도 ───────────────────────────────────────
function paintGround(map) {
  const c = document.createElement('canvas'); c.width = WORLD.w; c.height = WORLD.h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  if (map) g.drawImage(map, 0, 0, map.width, map.height, 0, 0, WORLD.w, WORLD.h);
  return c;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const GLYPH = { bang: '❗', bang2: '‼️', zz: '💤', dots: '💬', ask: '❓', star: '✨', spiral: '🎯', ring: '🔍', cross: '❌', smile: '😊', spark: '👹', bulb: '💡', scroll: '📜', check: '✅' };

export class Scene {
  constructor(canvas, assets = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ground = paintGround(assets.map);
    this.actors = new Map();
    this.nameplates = [];
    this.particles = [];
    this.letters = [];
    this.selectedId = null; this.selectedBuilding = null; this.hover = null;
    this.sessions = [];
    this.nightOverride = null;
    this.view = { zoom: 1, cx: WORLD.w / 2, cy: WORLD.h / 2 };
    this.target = null;
    this.fitZoom = 1;
    this.cw = 800; this.ch = 400; this.dpr = 1;
    this.lastT = performance.now();
    const npcSlugs = ['commoner-man', 'commoner-woman', 'commoner-man', 'commoner-woman', 'commoner-man', 'commoner-woman', 'commoner-man'];
    this.npcs = npcSlugs.map((slug, i) => {
      const p = navigation.strollNodes[(i * 3) % navigation.strollNodes.length];
      return { slug, x: p[0], y: p[1], tx: p[0], ty: p[1], route: [[...p]], routeDistance: 0, routeLength: 0, wait: Math.random() * 4, dir: 1, t: 0, moving: false };
    });
    this.bindInput();
  }

  // ── 시점 ─────────────────────────────────────────────
  toScreen(wx, wy) { return [(wx - this.view.cx) * this.view.zoom + this.cw / 2, (wy - this.view.cy) * this.view.zoom + this.ch / 2]; }
  toWorld(sx, sy) { return [(sx - this.cw / 2) / this.view.zoom + this.view.cx, (sy - this.ch / 2) / this.view.zoom + this.view.cy]; }
  clampView() {
    const v = this.view;
    v.zoom = Math.max(Math.min(this.fitZoom, 1), Math.min(4, v.zoom));
    const hw = this.cw / 2 / v.zoom, hh = this.ch / 2 / v.zoom;
    v.cx = WORLD.w / 2 <= hw ? WORLD.w / 2 : Math.max(hw, Math.min(WORLD.w - hw, v.cx));
    v.cy = WORLD.h / 2 <= hh ? WORLD.h / 2 : Math.max(hh, Math.min(WORLD.h - hh, v.cy));
  }
  // 도트가 뭉개지지 않게 정해진 배율로만
  stepZoom(sx, sy, dir) {
    const cur = this.view.zoom;
    const list = [...new Set([this.fitZoom, ...ZOOMS])].sort((a, b) => a - b);
    const next = dir > 0 ? list.find((z) => z > cur + 0.01) : [...list].reverse().find((z) => z < cur - 0.01);
    if (!next) return;
    const [wx, wy] = this.toWorld(sx, sy);
    this.view.zoom = next; this.clampView();
    const [nx, ny] = this.toWorld(sx, sy);
    this.view.cx += wx - nx; this.view.cy += wy - ny; this.clampView();
    this.target = null; this.bgKey = null;
  }
  zoomAt(sx, sy, factor) { this.stepZoom(sx, sy, factor > 1 ? 1 : -1); }
  showAll() { this.target = { zoom: this.fitZoom, cx: WORLD.w / 2, cy: WORLD.h / 2 }; }
  focus(id) { const a = this.actors.get(id); if (!a) return; const [x, y] = this.actorWorld(a); this.target = { zoom: Math.max(this.view.zoom, 2), cx: x, cy: y - 20 }; }
  focusBuilding(key) { const b = BUILDING[key]; if (b) this.target = { zoom: Math.max(this.view.zoom, 2), cx: b.entry[0], cy: b.entry[1] - 50 }; }

  bindInput() {
    const c = this.canvas;
    let drag = null, wheelAcc = 0;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      wheelAcc += e.deltaY;
      if (Math.abs(wheelAcc) < 60) return;
      const r = c.getBoundingClientRect();
      this.stepZoom(e.clientX - r.left, e.clientY - r.top, wheelAcc < 0 ? 1 : -1);
      wheelAcc = 0;
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cy: this.view.cy, moved: false }; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) { this.view.cx = drag.cx - dx / this.view.zoom; this.view.cy = drag.cy - dy / this.view.zoom; this.clampView(); this.target = null; c.style.cursor = 'grabbing'; }
    });
    c.addEventListener('pointerup', () => { this.justDragged = drag?.moved; drag = null; c.style.cursor = ''; setTimeout(() => { this.justDragged = false; }, 0); });
  }

  fit(wrap) {
    const r = wrap.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.cw = Math.max(320, Math.floor(r.width)); this.ch = Math.max(240, Math.floor(r.height));
    this.canvas.style.width = `${this.cw}px`; this.canvas.style.height = `${this.ch}px`;
    this.canvas.width = Math.floor(this.cw * this.dpr); this.canvas.height = Math.floor(this.ch * this.dpr);
    const fullTarget = this.target && Math.abs(this.target.zoom - this.fitZoom) < 0.001 && this.target.cx === WORLD.w / 2 && this.target.cy === WORLD.h / 2;
    this.fitZoom = Math.min(this.cw / WORLD.w, this.ch / WORLD.h); // 전경은 지도 전체가 칸 안에 들어오게
    if (fullTarget) this.target.zoom = this.fitZoom;
    const wasFullView = !this.fitted || Math.abs(this.view.zoom - (this.previousFitZoom ?? this.fitZoom)) < 0.001;
    if (wasFullView) { this.view.zoom = this.fitZoom; this.view.cx = WORLD.w / 2; this.view.cy = WORLD.h / 2; }
    this.previousFitZoom = this.fitZoom; this.fitted = true;
    this.clampView(); this.bgKey = null;
  }

  // ── 상태 동기화 ───────────────────────────────────────
  sync(sessions) {
    this.sessions = sessions;
    const alive = new Set();
    for (const s of sessions) {
      const a = this.ensure(s.id, 'session', BUILDING[s.location]?.entry || BUILDING.rest.entry);
      a.session = s; a.slug = lookOf(s).slug;
      this.goTo(a, s.location);
      alive.add(s.id);
      for (const sub of s.subs) {
        const sa = this.ensure(sub.id, 'sub', this.actorWorld(a));
        sa.sub = sub; sa.parent = s; sa.slug = 'dokkaebi';
        this.goTo(sa, sub.location);
        alive.add(sub.id);
      }
    }
    for (const [id, a] of this.actors) if (!alive.has(id) && !a.removing) { a.removing = true; this.burst(...this.actorWorld(a), '#f4ead6', 12); }
    this.assignSlots();
  }
  ensure(id, kind, spawn) {
    let a = this.actors.get(id);
    if (!a) {
      // 처음 나타날 때만 길로 투영한다. 보이는 인물을 새 경로로 옮길 때는 현재 점을 그대로 쓴다.
      const p = navigation.project(spawn);
      if (!p) throw new Error(`인물 ${id}의 입장 가능한 길이 없습니다`);
      a = { id, kind, from: [...p], at: null, route: [[...p]], routeDistance: 0, routeLength: 0, destination: [...p], t: 1, dur: 0, slotIndex: 0, alpha: 0, removing: false, bubble: null, emote: null, dir: 1, frame: 0 };
      this.actors.set(id, a);
      if (kind === 'session') this.burst(p[0], p[1], '#e8b73a', 16);
    }
    a.removing = false;
    return a;
  }
  actorWorld(a) { return navigation.pointAtDistance(a.route, a.routeDistance); }
  routeActor(a, destination) {
    if (dist(a.destination, destination) < 0.001) return;
    const from = this.actorWorld(a);
    const route = navigation.route(from, destination);
    if (!route) throw new Error(`인물 ${a.id}의 ${a.at}행 길이 연결되지 않았습니다`);
    a.from = from; a.route = route; a.routeDistance = 0;
    a.routeLength = navigation.routeLength(route); a.destination = [...destination];
    a.dur = a.routeLength / 140; a.t = a.routeLength > 0 ? 0 : 1;
  }
  goTo(a, loc) {
    if (!BUILDING[loc]) loc = 'rest';
    if (a.at === loc) return;
    a.at = loc;
    this.routeActor(a, navigation.standingPosition(loc, a.slotIndex));
  }
  assignSlots() {
    const groups = {};
    for (const a of this.actors.values()) if (!a.removing && a.at) (groups[a.at] ||= []).push(a);
    for (const list of Object.values(groups)) {
      list.sort((p, q) => (p.kind !== q.kind ? (p.kind === 'session' ? -1 : 1) : (p.session?.role === 'boss' ? -1 : q.session?.role === 'boss' ? 1 : p.id < q.id ? -1 : 1)));
      list.forEach((a, i) => {
        a.slotIndex = i;
        this.routeActor(a, navigation.standingPosition(a.at, i));
      });
    }
  }

  // ── 효과 ─────────────────────────────────────────────
  say(id, text, ms = 3600, tone = 'normal') {
    const a = this.actors.get(id);
    if (!a || !text) return;
    if (a.bubble?.tone === 'message' && tone !== 'message' && a.bubble.until > performance.now()) return;
    a.bubble = { text, until: performance.now() + ms, born: performance.now(), tone };
  }
  emote(id, key, ms = 1600) { const a = this.actors.get(id); if (a && GLYPH[key]) a.emote = { g: GLYPH[key], until: performance.now() + ms, born: performance.now() }; }
  burst(wx, wy, color, n = 10) {
    for (let k = 0; k < n; k++) {
      const ang = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 70;
      this.particles.push({ wx, wy, ox: 0, oy: -18, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 40, life: 0.7 + Math.random() * 0.4, age: 0, color, size: 3, g: 140 });
    }
  }
  letter(fromId, toId) {
    const a = this.actors.get(fromId);
    if (!a) return;
    this.letters.push({ from: this.actorWorld(a), toId: toId && this.actors.get(toId) ? toId : null, toFixed: BUILDING.inbox.entry, t: 0, dur: 1.6 });
  }

  // ── 갱신 ─────────────────────────────────────────────
  step(dt) {
    if (this.target) {
      const v = this.view, t = this.target, k = Math.min(1, dt * 6);
      v.cx += (t.cx - v.cx) * k; v.cy += (t.cy - v.cy) * k;
      if (Math.abs(t.zoom - v.zoom) > 0.001) { v.zoom = t.zoom; this.bgKey = null; }
      this.clampView();
      if (Math.abs(t.cx - v.cx) < 0.5 && Math.abs(t.cy - v.cy) < 0.5) this.target = null;
    }
    for (const [id, a] of this.actors) {
      if (a.removing) { a.alpha -= dt * 2.5; if (a.alpha <= 0) this.actors.delete(id); continue; }
      a.alpha = Math.min(1, a.alpha + dt * 3);
      if (a.t < 1) {
        const before = this.actorWorld(a);
        a.routeDistance = Math.min(a.routeLength, a.routeDistance + dt * 140);
        a.t = a.routeLength > 0 ? a.routeDistance / a.routeLength : 1;
        const after = this.actorWorld(a);
        if (Math.abs(after[0] - before[0]) > 0.05) a.dir = after[0] > before[0] ? 1 : -1;
        a.vertical = Math.abs(after[1] - before[1]) > Math.abs(after[0] - before[0]);
        a.down = after[1] > before[1];
        a.frame += dt * 10;
      }
    }
    for (const n of this.npcs) {
      if (n.wait > 0) { n.wait -= dt; n.moving = false; continue; }
      if (n.routeDistance >= n.routeLength) {
        const choices = navigation.strollNodes.filter((p) => dist([n.x, n.y], p) > 8);
        const to = choices[Math.floor(Math.random() * choices.length)];
        const route = navigation.route([n.x, n.y], to);
        if (!route) throw new Error('백성이 다니는 산책길이 연결되지 않았습니다');
        n.route = route; n.routeDistance = 0; n.routeLength = navigation.routeLength(route);
        n.tx = to[0]; n.ty = to[1];
      }
      const before = [n.x, n.y];
      n.routeDistance = Math.min(n.routeLength, n.routeDistance + 28 * dt);
      [n.x, n.y] = navigation.pointAtDistance(n.route, n.routeDistance);
      const dx = n.x - before[0], dy = n.y - before[1];
      if (Math.abs(dx) > 0.01) n.dir = dx > 0 ? 1 : -1;
      n.vertical = Math.abs(dy) > Math.abs(dx); n.down = dy > 0;
      n.t += dt * 8; n.moving = n.routeDistance < n.routeLength;
      if (!n.moving) n.wait = 2 + Math.random() * 6;
    }
    for (const p of this.particles) { p.age += dt; p.ox += p.vx * dt; p.oy += p.vy * dt; p.vy += p.g * dt; }
    this.particles = this.particles.filter((p) => p.age < p.life);
    for (const l of this.letters) {
      l.t += dt / l.dur;
      if (l.t >= 1 && !l.done) { l.done = true; if (l.toId) { this.emote(l.toId, 'bang2', 1800); const b = this.actors.get(l.toId); if (b) this.burst(...this.actorWorld(b), '#fff3d6', 8); } }
    }
    this.letters = this.letters.filter((l) => l.t < 1.1);
    this.smokeT = (this.smokeT || 0) - dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.4;
      const busy = new Set();
      for (const a of this.actors.values()) if (a.kind === 'session' && a.session?.status === 'working' && a.t >= 1) busy.add(a.at);
      for (const k of busy) if (k !== 'approval') { const b = BUILDING[k]; this.particles.push({ wx: b.img[0] + b.size[0] * 0.72, wy: b.img[1] + b.size[1] * 0.2, ox: 0, oy: 0, vx: 6 + Math.random() * 6, vy: -18 - Math.random() * 8, life: 2.6, age: 0, color: 'smoke', size: 4, g: 0 }); }
    }
  }

  darkness() {
    if (this.nightOverride === 'day') return 0;
    if (this.nightOverride === 'night') return 0.55;
    const d = new Date(); const h = d.getHours() + d.getMinutes() / 60;
    if (h >= 7 && h < 17.5) return 0;
    if (h >= 17.5 && h < 19.5) return ((h - 17.5) / 2) * 0.55;
    if (h >= 5 && h < 7) return ((7 - h) / 2) * 0.55;
    return 0.55;
  }

  // ── 그리기 ───────────────────────────────────────────
  roundRect(x, y, w, h, r) { const c = this.ctx; c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  wrapText(text, maxW, maxLines) {
    const ctx = this.ctx, lines = []; let cur = '';
    for (const ch of text) { if (ctx.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch; if (lines.length === maxLines) break; } else cur += ch; }
    if (lines.length < maxLines && cur) lines.push(cur);
    if (lines.length === maxLines && lines.join('').length < text.length) lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
    return lines;
  }
  bubble(sx, topY, b) {
    const ctx = this.ctx;
    const alpha = Math.min(1, ((b.until - performance.now()) / 1000) * 3, (performance.now() - b.born) / 140);
    if (alpha <= 0) return;
    ctx.font = '12px "Gowun Batang", serif';
    const lines = this.wrapText(b.text, b.tone === 'message' ? 200 : 170, b.tone === 'message' ? 3 : 2);
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18, h = lines.length * 16 + 10;
    const x = Math.max(4, Math.min(this.cw - w - 4, sx - w / 2)), y = topY - h - 10;
    ctx.globalAlpha = alpha;
    const fill = b.tone === 'message' ? '#fbf3dc' : b.tone === 'alert' ? '#fde4df' : '#ffffff';
    const edge = b.tone === 'message' ? '#7a4a22' : b.tone === 'alert' ? '#b3262b' : '#3a2a1a';
    ctx.fillStyle = edge; this.roundRect(x - 2, y - 2, w + 4, h + 4, 4); ctx.fill();
    ctx.fillStyle = fill; this.roundRect(x, y, w, h, 3); ctx.fill();
    const tx = Math.max(x + 10, Math.min(x + w - 10, sx));
    ctx.fillStyle = edge; ctx.beginPath(); ctx.moveTo(tx - 7, y + h); ctx.lineTo(tx, y + h + 9); ctx.lineTo(tx + 7, y + h); ctx.fill();
    ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(tx - 5, y + h - 1); ctx.lineTo(tx, y + h + 5); ctx.lineTo(tx + 5, y + h - 1); ctx.fill();
    if (b.tone === 'message') { ctx.fillStyle = '#b3262b'; ctx.fillRect(x + 5, y + 5, 3, h - 10); }
    ctx.fillStyle = '#2a1a0c'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    lines.forEach((l, i) => ctx.fillText(l, x + (b.tone === 'message' ? 13 : 9), y + 6 + i * 16));
    ctx.globalAlpha = 1;
  }
  nameTag(text, sx, y, role) {
    const ctx = this.ctx;
    ctx.font = 'bold 11px "Gowun Batang", serif';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = role === 'boss' ? '#7a1c1c' : role === 'member' ? '#1f3d5c' : 'rgba(40,30,20,.78)';
    this.roundRect(sx - w / 2, y, w, 15, 3); ctx.fill();
    ctx.strokeStyle = role === 'boss' ? '#e8b73a' : 'rgba(255,240,210,.5)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#fff4d6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, sx, y + 8); ctx.textAlign = 'left';
  }
  layoutNameplates() {
    const ctx = this.ctx;
    ctx.font = 'bold 11px "Gowun Batang", serif';
    const [kx, ky] = this.toScreen(...KING_POS);
    const labels = [{ type: 'king', text: '전하', role: 'boss', sx: kx, sy: ky }];
    for (const a of this.actors.values()) {
      if (a.kind !== 'session' || !a.session) continue;
      const [sx, sy] = this.toScreen(...this.actorWorld(a)), name = a.session.name;
      labels.push({ type: 'actor', id: a.id, a, text: name.length > 8 ? name.slice(0, 7) + '…' : name, role: a.session.role, sx, sy });
    }
    labels.sort((p, q) => p.sy - q.sy || p.sx - q.sx);
    const placed = [];
    for (const label of labels) {
      const w = ctx.measureText(label.text).width + 10;
      const box = { x: label.sx - w / 2, y: label.sy + 3, w, h: 15 };
      while (placed.some((p) => box.x < p.box.x + p.box.w + 2 && box.x + box.w + 2 > p.box.x && box.y < p.box.y + p.box.h + 2 && box.y + box.h + 2 > p.box.y)) box.y += 18;
      label.box = box; placed.push(label);
    }
    this.nameplates = placed;
    return placed;
  }
  drawNameplates() {
    const ctx = this.ctx, labels = this.layoutNameplates();
    for (const label of labels) {
      if (label.box.y > label.sy + 3) {
        ctx.strokeStyle = 'rgba(255,244,214,.45)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(label.sx, label.sy + 1); ctx.lineTo(label.sx, label.box.y); ctx.stroke();
      }
    }
    for (const label of labels) this.nameTag(label.text, label.sx, label.box.y, label.role);
  }
  badge(g, sx, sy, bounce) {
    const ctx = this.ctx;
    ctx.fillStyle = '#fffaf0'; ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 2;
    this.roundRect(sx - 12, sy - 12 + bounce, 24, 22, 4); ctx.fill(); ctx.stroke();
    ctx.font = '14px "Apple Color Emoji","Segoe UI Emoji",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(g, sx, sy - 1 + bounce); ctx.textAlign = 'left';
  }
  signboard(b, count, waiting, t) {
    const ctx = this.ctx;
    const [sx, sy] = this.toScreen(...(b.labelPos || [b.img[0] + b.size[0] / 2, b.img[1] + 6]));
    const sel = this.selectedBuilding === b.key, hov = this.hover?.type === 'building' && this.hover.key === b.key;
    ctx.font = 'bold 14px "Song Myung", "Gowun Batang", serif';
    const w = ctx.measureText(b.label).width + 24, h = 22, x = Math.round(sx - w / 2), y = Math.round(sy - h - 4);
    if (b.key === 'approval' && waiting) { ctx.fillStyle = `rgba(220,60,50,${0.3 + 0.2 * Math.sin(t / 220)})`; ctx.fillRect(x - 6, y - 6, w + 12, h + 12); }
    ctx.fillStyle = '#2a1608'; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = '#5b3418'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#7a4a22'; ctx.fillRect(x + 2, y + 2, w - 4, 2);
    ctx.fillStyle = sel ? '#fff27a' : hov ? '#f8e2a0' : b.color; ctx.fillRect(x + 3, y + 5, 3, h - 10); ctx.fillRect(x + w - 6, y + 5, 3, h - 10);
    ctx.fillStyle = '#ffe6a6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.label, sx, y + h / 2 + 1);
    if (count) {
      const cx = x + w + 6, cy = y + 2;
      ctx.fillStyle = '#2a1608'; ctx.fillRect(cx - 9, cy - 9, 18, 18);
      ctx.fillStyle = b.key === 'approval' && waiting ? '#c62f2f' : '#e8b73a'; ctx.fillRect(cx - 7, cy - 7, 14, 14);
      ctx.fillStyle = b.key === 'approval' && waiting ? '#fff' : '#2a1608'; ctx.font = 'bold 11px sans-serif'; ctx.fillText(String(count), cx, cy + 1);
    }
    ctx.textAlign = 'left';
  }

  drawBackground() {
    const key = `${this.view.zoom}|${this.view.cx.toFixed(1)}|${this.view.cy.toFixed(1)}|${this.cw}|${this.ch}|${this.dpr}`;
    if (this.bgKey !== key) {
      this.bgKey = key;
      this.bgCanvas ||= document.createElement('canvas');
      const bc = this.bgCanvas;
      if (bc.width !== this.canvas.width || bc.height !== this.canvas.height) { bc.width = this.canvas.width; bc.height = this.canvas.height; }
      const b = bc.getContext('2d');
      b.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      b.fillStyle = '#5f8a44'; b.fillRect(0, 0, this.cw, this.ch);
      b.imageSmoothingEnabled = false;
      const [ox, oy] = this.toScreen(0, 0);
      b.drawImage(this.ground, Math.round(ox), Math.round(oy), Math.round(WORLD.w * this.view.zoom), Math.round(WORLD.h * this.view.zoom));
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.bgCanvas, 0, 0); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  drawGateForeground() {
    const ctx = this.ctx, { img, size } = GATE.occlusion;
    const [sx, sy] = this.toScreen(...img), [ox, oy] = this.toScreen(0, 0);
    ctx.save();
    ctx.beginPath(); ctx.rect(Math.floor(sx), Math.floor(sy), Math.ceil(size[0] * this.view.zoom), Math.ceil(size[1] * this.view.zoom)); ctx.clip();
    // 같은 배경을 같은 배율로 잘라 올려 문을 통과하는 인물이 지붕·기둥 뒤로 가려지게 한다.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.ground, Math.round(ox), Math.round(oy), Math.round(WORLD.w * this.view.zoom), Math.round(WORLD.h * this.view.zoom));
    ctx.restore();
  }

  frame(t) {
    const dt = Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;
    this.step(dt);
    const ctx = this.ctx;
    this.drawBackground();
    const z = this.view.zoom;
    const waiting = this.sessions.some((s) => s.status === 'waiting');
    const draws = [];
    for (const n of this.npcs) draws.push({ y: n.y, f: () => {
      const [sx, sy] = this.toScreen(n.x, n.y), scale = z * CHARACTER_SCALE;
      const pose = walkingPose(n.slug, n.moving, n.dir, n.vertical, n.down);
      ctx.fillStyle = 'rgba(0,0,0,.20)'; ctx.beginPath(); ctx.ellipse(sx, sy, 8 * scale, 2.5 * scale, 0, 0, 7); ctx.fill();
      drawSprite(ctx, n.slug, pose.name, n.t, sx, sy, scale, pose.flip, 0.95);
    } });
    // 건물은 배경에 포함된다. 인물만 발밑 높이 순으로 겹친다.
    draws.push({ y: KING_POS[1], f: () => this.drawKing(t, waiting) });
    for (const a of this.actors.values()) { const [, wy] = this.actorWorld(a); draws.push({ y: wy, f: () => this.drawActor(a, t) }); }
    draws.push({ y: GATE.occlusion.depth, f: () => this.drawGateForeground() });
    draws.sort((p, q) => p.y - q.y);
    for (const d of draws) d.f();
    this.drawNameplates();
    for (const p of this.particles) {
      const [sx, sy] = this.toScreen(p.wx, p.wy);
      const k = 1 - p.age / p.life;
      if (p.color === 'smoke') { ctx.fillStyle = `rgba(235,235,240,${0.55 * k})`; const s = Math.round((p.size + (1 - k) * 6) * z); ctx.fillRect(Math.round(sx + p.ox * z), Math.round(sy + p.oy * z), s, s); }
      else { ctx.globalAlpha = k; ctx.fillStyle = p.color; ctx.fillRect(Math.round(sx + p.ox), Math.round(sy + p.oy), p.size, p.size); ctx.globalAlpha = 1; }
    }
    for (const l of this.letters) {
      if (l.t > 1) continue;
      const toW = l.toId && this.actors.get(l.toId) ? this.actorWorld(this.actors.get(l.toId)) : l.toFixed;
      const [ax, ay] = this.toScreen(...l.from), [bx, by] = this.toScreen(...toW);
      const k = l.t, mx = (ax + bx) / 2, my = Math.min(ay, by) - 90;
      const x = (1 - k) ** 2 * ax + 2 * (1 - k) * k * mx + k ** 2 * bx, y = (1 - k) ** 2 * ay + 2 * (1 - k) * k * my + k ** 2 * by - 30;
      ctx.font = '22px "Apple Color Emoji","Segoe UI Emoji",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('📜', x, y); ctx.textAlign = 'left';
    }
    this.drawNight(t);
    const counts = {};
    for (const a of this.actors.values()) if (!a.removing && a.at && a.t >= 1) counts[a.at] = (counts[a.at] || 0) + 1;
    for (const b of BUILDINGS) this.signboard(b, counts[b.key] || 0, waiting, t);
    for (const a of this.actors.values()) {
      if (!a.bubble || a.bubble.until <= performance.now()) continue;
      const [sx, sy] = this.toScreen(...this.actorWorld(a));
      const scale = z * CHARACTER_SCALE * (a.kind === 'sub' ? 0.8 : 1);
      this.bubble(sx, sy - spriteHeight(a.slug) * scale - 4, a.bubble);
    }
  }

  drawActor(a, t) {
    const ctx = this.ctx, z = this.view.zoom;
    const bodyScale = z * CHARACTER_SCALE * (a.kind === 'sub' ? 0.8 : 1);
    const [sx, sy] = this.toScreen(...this.actorWorld(a));
    const s = a.session || a.parent;
    const isSub = a.kind === 'sub';
    const st = isSub ? 'working' : effStatus(a.session);
    const sel = !isSub && s && this.selectedId === s.id, hov = this.hover?.type === 'actor' && this.hover.id === a.id;
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(sx, sy, 9 * bodyScale, 3 * bodyScale, 0, 0, 7); ctx.fill();
    if (sel || hov) { ctx.strokeStyle = sel ? '#ffe45a' : 'rgba(255,255,255,.85)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(sx, sy, 13 * bodyScale, 4.5 * bodyScale, 0, 0, 7); ctx.stroke(); }
    const moving = a.t < 1;
    const pose = walkingPose(a.slug, moving, a.dir, a.vertical, a.down);
    const bob = !moving && st === 'working' ? Math.round(Math.max(0, Math.sin(t / 180 + (hash(a.id) % 7))) * 1.5) * bodyScale : 0;
    drawSprite(ctx, a.slug, pose.name, a.frame, sx, sy - bob, bodyScale, pose.flip, a.alpha * (st === 'sleep' ? 0.8 : 1));
    const h = spriteHeight(a.slug) * bodyScale;
    if (a.bubble && a.bubble.until > performance.now()) return;
    let g = null, bounce = 0;
    if (!isSub && st === 'waiting') { g = GLYPH.bang; bounce = Math.round(Math.sin(t / 140) * 3); }
    else if (a.emote && a.emote.until > performance.now()) { g = a.emote.g; bounce = performance.now() - a.emote.born < 150 ? -4 : 0; }
    else if (!isSub && st === 'sleep') g = GLYPH.zz;
    else if (!isSub && st === 'working' && !moving && Math.floor(t / 1600) % 3 === 0) g = GLYPH.dots;
    if (g) this.badge(g, sx + 10, sy - h - 6, bounce);
  }

  drawKing(t, waiting) {
    const z = this.view.zoom, bodyScale = z * CHARACTER_SCALE;
    const [sx, sy] = this.toScreen(...KING_POS);
    this.ctx.fillStyle = 'rgba(0,0,0,.25)'; this.ctx.beginPath(); this.ctx.ellipse(sx, sy, 9 * bodyScale, 3 * bodyScale, 0, 0, 7); this.ctx.fill();
    drawSprite(this.ctx, 'king', 'south', 0, sx, sy, bodyScale, false, 1);
    if (this.hover?.type === 'king') { this.ctx.strokeStyle = 'rgba(255,255,255,.85)'; this.ctx.lineWidth = 2; this.ctx.beginPath(); this.ctx.ellipse(sx, sy, 13 * bodyScale, 4.5 * bodyScale, 0, 0, 7); this.ctx.stroke(); }
    if (waiting) this.badge(GLYPH.ask, sx + 10, sy - spriteHeight('king') * bodyScale - 6, Math.round(Math.sin(t / 200) * 2));
  }

  drawNight(t) {
    const dark = this.darkness();
    if (dark <= 0) return;
    const ctx = this.ctx, z = this.view.zoom;
    ctx.fillStyle = `rgba(14,20,52,${dark})`; ctx.fillRect(0, 0, this.cw, this.ch);
    ctx.globalCompositeOperation = 'lighter';
    const k = dark / 0.55;
    for (const b of BUILDINGS) {
      const [sx, sy] = this.toScreen(b.entry[0], b.entry[1] - 30);
      const r = 70 * z;
      const g = ctx.createRadialGradient(sx, sy, 2, sx, sy, r);
      g.addColorStop(0, `rgba(255,170,90,${0.45 * k})`); g.addColorStop(1, 'rgba(255,170,90,0)');
      ctx.fillStyle = g; ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    }
    for (let i = 0; i < 24; i++) {
      const a = (Math.sin(t / 600 + i * 1.7) + 1) / 2;
      ctx.fillStyle = `rgba(210,255,140,${a * 0.7 * k})`;
      ctx.fillRect(Math.round(((i * 397) % this.cw) + Math.sin(t / 1800 + i) * 10), Math.round(((i * 233) % this.ch) + Math.cos(t / 1500 + i) * 6), 2, 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  hitTest(ev) {
    const r = this.canvas.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top, z = this.view.zoom;
    for (const label of [...this.nameplates].reverse()) {
      if (label.a?.removing) continue;
      const { x, y, w, h } = label.box;
      if (mx >= x && mx <= x + w && my >= y && my <= y + h) return label.type === 'king' ? { type: 'king' } : { type: 'actor', id: label.id, a: label.a };
    }
    const list = [...this.actors.values()].filter((a) => !a.removing).map((a) => ({ a, p: this.toScreen(...this.actorWorld(a)) })).sort((p, q) => q.p[1] - p.p[1]);
    for (const { a, p } of list) {
      const scale = z * CHARACTER_SCALE * (a.kind === 'sub' ? 0.8 : 1);
      if (Math.abs(mx - p[0]) <= Math.max(6, spriteHalfWidth(a.slug) * scale) && my >= p[1] - spriteHeight(a.slug) * scale && my <= p[1] + 18) return { type: 'actor', id: a.id, a };
    }
    const [kx, ky] = this.toScreen(...KING_POS);
    if (Math.abs(mx - kx) <= Math.max(6, spriteHalfWidth('king') * z * CHARACTER_SCALE) && my >= ky - spriteHeight('king') * z * CHARACTER_SCALE && my <= ky + 20) return { type: 'king' };
    for (const b of BUILDINGS) {
      const [sx, sy] = this.toScreen(...(b.labelPos || [b.img[0] + b.size[0] / 2, b.img[1] + 6]));
      this.ctx.font = 'bold 14px "Song Myung", "Gowun Batang", serif';
      const width = this.ctx.measureText(b.label).width + 24;
      if (Math.abs(mx - sx) <= width / 2 + 2 && my >= sy - 28 && my <= sy - 2) return { type: 'building', key: b.key };
      const [x0, y0] = this.toScreen(b.img[0], b.img[1] - 20), [x1, y1] = this.toScreen(b.img[0] + b.size[0], b.img[1] + b.size[1]);
      if (mx >= x0 && mx <= x1 && my >= y0 && my <= y1) return { type: 'building', key: b.key };
    }
    return null;
  }
}
