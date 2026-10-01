// Agent Court (에이전트 조정) — 로컬 대시보드 서버 (의존성 없음)
// events.jsonl을 실시간으로 읽어 세션 상태를 만들고, 브라우저에 SSE로 밀어준다.
import http from 'node:http';
import { execFile } from 'node:child_process';
import {
  readFileSync, writeFileSync, existsSync, statSync, openSync, readSync, closeSync, mkdirSync, watchFile, createReadStream,
} from 'node:fs';
import { join, dirname, basename, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const DATA_DIR = process.env.FARM_DATA_DIR || join(ROOT, 'data');
const EVENTS = join(DATA_DIR, 'events.jsonl');
const META = join(DATA_DIR, 'meta.json');
const MEDIA = join(DATA_DIR, 'media');
const PORT = Number(process.env.FARM_PORT || 4545);
const HOST = '127.0.0.1';
const CLAUDE_BIN = process.env.CLAUDE_BIN || (existsSync(join(homedir(), '.local/bin/claude')) ? join(homedir(), '.local/bin/claude') : 'claude');
const AGENTS_POLL = process.env.FARM_NO_AGENTS ? 0 : 15_000;

const REPLAY_WINDOW_MS = 12 * 3600_000; // 재시작 시 최근 12시간만 복원
const STALE_MS = 6 * 3600_000; // 6시간 무소식 세션은 퇴궐 처리
const FEED_MAX = 80;
const RECENT_MAX = 15;
const CONVO_MAX = 150;
const MEDIA_MAX = 80;
const MAX_LOG_BYTES = 30 * 1024 * 1024;

mkdirSync(MEDIA, { recursive: true });

// ── 메타(이름·직책·숨김) ────────────────────────────────
let meta = { sessions: {} };
try { meta = JSON.parse(readFileSync(META, 'utf8')); } catch { /* 첫 실행 */ }
meta.sessions ??= {};
const saveMeta = () => writeFileSync(META, JSON.stringify(meta, null, 2));

// ── 웹 어명 (토큰·대기열·수신기) ───────────────────────
const TOKEN_FILE = join(DATA_DIR, 'token');
if (!existsSync(TOKEN_FILE)) { writeFileSync(TOKEN_FILE, randomBytes(24).toString('hex')); }
try { chmodSync(TOKEN_FILE, 0o600); } catch { /* 무시 */ }
const TOKEN = readFileSync(TOKEN_FILE, 'utf8').trim();
const INSTR_FILE = join(DATA_DIR, 'instructions.json');
let instructions = [];
try { instructions = JSON.parse(readFileSync(INSTR_FILE, 'utf8')); } catch { /* 첫 실행 */ }
const saveInstr = () => writeFileSync(INSTR_FILE, JSON.stringify(instructions.slice(-200), null, 2));
const listeners = new Map(); // sid → { lid, res, timer }
const IMG_MIME = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
const roleOf = (sid) => meta.sessions[sid]?.role || 'none';

// ── 상태 ────────────────────────────────────────────────
const sessions = new Map();
const agents = new Map(); // sessionId → { name, status, kind }
let feed = [];
let convo = [];
let media = [];
const dayKey = (ts) => new Date(ts).toLocaleDateString('sv-SE'); // YYYY-MM-DD (로컬)
const CATS = ['inbox', 'research', 'build', 'test', 'check', 'approval', 'rest'];
const freshStats = (day) => ({ day, prompts: 0, tools: 0, edits: 0, tests: 0, approvals: 0, messages: 0, shows: 0, firstTs: null, byCat: Object.fromEntries(CATS.map((c) => [c, 0])) });
let stats = freshStats(dayKey(Date.now()));

const VERB = {
  Read: '문서 열람', Edit: '문서 수정', Write: '문서 작성', MultiEdit: '문서 수정', NotebookEdit: '문서 수정',
  Grep: '문서 수색', Glob: '문서 찾기', WebFetch: '바깥 소식 조회', WebSearch: '바깥 소식 탐문', ToolSearch: '도구 찾기',
  Agent: '도깨비 소환', Task: '도깨비 소환', ListAgents: '조정 명부 열람',
  AskUserQuestion: '전하께 여쭘', ExitPlanMode: '계책 윤허 청함', TodoWrite: '할 일 정리', TaskCreate: '할 일 등록',
  TaskUpdate: '할 일 갱신', Skill: '비책 사용', Artifact: '방(榜) 게시', Monitor: '동태 감시', Workflow: '대규모 동원',
};
const BASH_VERB = { test: '시험 치름', check: '변경 점검', research: '기록 조회', build: '명령 시행' };

function verbOf(e) {
  if (e.tool === 'Bash') return BASH_VERB[e.cat] || '명령 시행';
  if (e.tool === 'SendMessage') return roleOf(e.sid) === 'boss' ? '하명' : '장계 올림';
  if (VERB[e.tool]) return VERB[e.tool];
  if (e.tool?.startsWith('mcp__')) return '외부 관청 연락';
  return e.tool || '공무';
}
const withDetail = (v, d) => (d ? `${v} · ${d}` : v);

function getSession(e) {
  let s = sessions.get(e.sid);
  if (!s) {
    s = {
      id: e.sid, cwd: e.cwd, project: e.cwd ? basename(e.cwd) : '?', location: 'rest', status: 'idle', text: '입궐',
      provider: e.provider === 'codex' ? 'codex' : 'claude', rawSid: e.rawSid || e.sid, readOnly: !!e.readOnly || e.provider === 'codex',
      startTs: e.ts, lastTs: e.ts, waitingSince: null, recent: [], subs: {}, pendingAgents: [],
      counts: { tools: 0, edits: 0, tests: 0, messages: 0 },
    };
    sessions.set(e.sid, s);
  }
  return s;
}

function pushFeed(s, e, text, loc, actor, extra) {
  const item = { ts: e.ts, sid: s.id, aid: actor?.id, loc, text, ev: e.ev, kind: extra?.kind };
  feed.push(item);
  if (feed.length > FEED_MAX) feed = feed.slice(-FEED_MAX);
  s.recent.push(item);
  if (s.recent.length > RECENT_MAX) s.recent = s.recent.slice(-RECENT_MAX);
}

function setWaiting(s, e, text) {
  if (s.status !== 'waiting') { s.waitingSince = e.ts; stats.approvals++; stats.byCat.approval++; }
  s.status = 'waiting';
  s.location = 'approval';
  s.text = text;
}

// SendMessage의 to("이름" 또는 "이름 [ref]")를 세션으로 풀기: 같은 이름 중 보낸 쪽을 뺀 하나면 확정
function resolveTarget(to, fromSid) {
  if (!to) return null;
  // 답장은 from 주소(uds:/tmp/cc-socks/<pid>.sock)로 오므로 pid로 찾는다
  const sock = /cc-socks\/(\d+)\.sock/.exec(to);
  if (sock) { const hit = [...agents.entries()].find(([, a]) => String(a.pid) === sock[1]); return hit ? hit[0] : null; }
  const name = to.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
  const hits = [...agents.entries()].filter(([sid, a]) => a.name === name && sid !== fromSid).map(([sid]) => sid);
  if (hits.length === 1) return hits[0];
  const byMeta = Object.entries(meta.sessions).filter(([sid, m]) => m.name === name && sid !== fromSid).map(([sid]) => sid);
  return byMeta.length === 1 ? byMeta[0] : null;
}

function apply(e) {
  if (!e?.sid || !e.ev) return;
  const d = dayKey(e.ts);
  if (d > stats.day) stats = freshStats(d);
  const today = d === stats.day;
  if (e.ev === 'SessionEnd') {
    const s = sessions.get(e.sid);
    if (s) { pushFeed(s, e, '퇴궐', 'rest'); sessions.delete(e.sid); }
    return;
  }
  const s = getSession(e);
  s.lastTs = e.ts;
  if (e.provider) s.provider = e.provider;
  if (e.rawSid) s.rawSid = e.rawSid;
  if (typeof e.readOnly === 'boolean') s.readOnly = e.readOnly;
  if (e.cwd && e.cwd !== s.cwd && e.ev !== 'Show') { s.cwd = e.cwd; s.project = basename(e.cwd); }
  if (today && !stats.firstTs) stats.firstTs = e.ts;

  const sub = e.aid ? s.subs[e.aid] : null;

  switch (e.ev) {
    case 'SessionStart': {
      const t = e.source === 'resume' ? '복귀' : e.source === 'clear' ? '자리 정돈' : e.source === 'compact' ? '기억 정리 완료' : '입궐';
      Object.assign(s, { location: 'rest', status: 'idle', text: t, waitingSince: null });
      pushFeed(s, e, t, 'rest');
      break;
    }
    case 'UserPromptSubmit':
      Object.assign(s, { location: 'inbox', status: 'working', text: '어명 접수', waitingSince: null });
      if (today) { stats.prompts++; stats.byCat.inbox++; }
      pushFeed(s, e, '어명 접수', 'inbox');
      break;
    case 'PreToolUse': {
      const loc = e.cat || 'build';
      const text = withDetail(verbOf(e), e.tool === 'SendMessage' ? (e.summary || e.detail) : e.detail);
      if (today) {
        stats.tools++;
        if (loc !== 'approval') stats.byCat[loc] = (stats.byCat[loc] || 0) + 1;
        if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(e.tool)) stats.edits++;
        if (loc === 'test') stats.tests++;
      }
      s.counts.tools++;
      if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(e.tool)) s.counts.edits++;
      if (loc === 'test') s.counts.tests++;
      if (e.tool === 'SendMessage' && e.msg !== undefined) {
        const toSid = resolveTarget(e.to, s.id);
        convo.push({ id: `${e.ts}-${s.id.slice(0, 6)}`, ts: e.ts, from: s.id, to: toSid, toLabel: e.to, text: e.msg, summary: e.summary, kind: roleOf(s.id) === 'boss' ? 'order' : 'report' });
        if (convo.length > CONVO_MAX) convo = convo.slice(-CONVO_MAX);
        s.counts.messages++;
        if (today) stats.messages++;
      }
      if (sub) {
        Object.assign(sub, { location: loc === 'approval' ? 'inbox' : loc, text, lastTs: e.ts });
        pushFeed(s, e, text, sub.location, sub);
        break;
      }
      if (e.tool === 'Agent' || e.tool === 'Task') s.pendingAgents.push({ label: e.detail, stype: e.stype, ts: e.ts });
      if (loc === 'approval') setWaiting(s, e, text);
      else if (s.status !== 'waiting') Object.assign(s, { location: loc, status: 'working', text });
      pushFeed(s, e, text, loc, null, { kind: e.tool === 'SendMessage' ? 'message' : e.cat });
      break;
    }
    case 'PostToolUse':
    case 'PostToolUseFailure':
      if (sub) { sub.lastTs = e.ts; break; }
      if (s.status === 'waiting') {
        Object.assign(s, { status: 'working', waitingSince: null, text: withDetail(verbOf(e), e.detail) });
        if (s.location === 'approval') s.location = e.cat && e.cat !== 'approval' ? e.cat : 'inbox';
      }
      if (e.ev === 'PostToolUseFailure') pushFeed(s, e, withDetail(`${verbOf(e)} 실패`, e.detail), s.location, null, { kind: 'fail' });
      break;
    case 'PermissionRequest': {
      const text = withDetail(`윤허 대기 · ${verbOf(e)}`, e.detail);
      setWaiting(s, e, text);
      pushFeed(s, e, text, 'approval', null, { kind: 'approval' });
      break;
    }
    case 'Notification': {
      const perm = e.ntype === 'permission_prompt' || (!e.ntype && /permission/i.test(e.detail || ''));
      if (perm) {
        if (s.status !== 'waiting') { setWaiting(s, e, '윤허 대기'); pushFeed(s, e, '윤허 대기', 'approval', null, { kind: 'approval' }); }
      } else if (e.ntype === 'idle_prompt') {
        if (s.status !== 'waiting') Object.assign(s, { location: 'rest', status: 'idle', text: '어명을 기다리는 중' });
      }
      break;
    }
    case 'Stop':
      Object.assign(s, { location: 'rest', status: 'idle', text: '복명 완료 · 대기', waitingSince: null });
      pushFeed(s, e, '복명 완료', 'rest', null, { kind: 'done' });
      break;
    case 'Interrupt':
      Object.assign(s, { location: 'rest', status: 'idle', text: '공무 중단 · 대기', waitingSince: null });
      pushFeed(s, e, '공무 중단', 'rest');
      break;
    case 'PostCompact':
      s.text = '기억 정리 완료';
      pushFeed(s, e, '기억 정리 완료', s.location);
      break;
    case 'SubagentStart': {
      if (!e.aid) break;
      const p = s.pendingAgents.shift();
      const type = e.atype || p?.stype || 'general-purpose';
      const loc = /explore|plan|guide/i.test(type) ? 'research' : 'build';
      s.subs[e.aid] = { id: e.aid, label: p?.label || type, type, location: loc, text: '출동', startTs: e.ts, lastTs: e.ts };
      pushFeed(s, e, withDetail('도깨비 출동', p?.label || type), loc, s.subs[e.aid], { kind: 'sub' });
      break;
    }
    case 'SubagentStop': {
      const key = e.aid && s.subs[e.aid] ? e.aid : Object.keys(s.subs)[0];
      if (key) { pushFeed(s, e, withDetail('도깨비 복귀', s.subs[key].label), s.location, s.subs[key]); delete s.subs[key]; }
      break;
    }
    case 'PreCompact':
      s.text = '기억 정리 중';
      pushFeed(s, e, '기억 정리 중', s.location);
      break;
    case 'Show': {
      const files = (e.files || []).filter((f) => /^[\w-]+\.\w+$/.test(f.id));
      if (!files.length) break;
      media.push({ id: files[0].id, ts: e.ts, sid: s.id, title: e.title, note: e.note, files });
      if (media.length > MEDIA_MAX) media = media.slice(-MEDIA_MAX);
      if (today) stats.shows++;
      pushFeed(s, e, withDetail('자료 진상', e.title), s.location, null, { kind: 'show' });
      break;
    }
    default:
      break;
  }
  s.pendingAgents = s.pendingAgents.filter((p) => e.ts - p.ts < 10 * 60_000);
}

function publicState() {
  const list = [];
  for (const s of sessions.values()) {
    const m = meta.sessions[s.id] || {};
    const ag = agents.get(s.id);
    list.push({
      id: s.id, name: m.name || ag?.name || `${s.project}·${s.rawSid.slice(0, 4)}`, customName: !!m.name, agentName: ag?.name || null,
      provider: s.provider, canReceiveOrders: !s.readOnly && s.provider === 'claude',
      role: m.role || 'none', hidden: !!m.hidden, project: s.project, location: s.location, status: s.status, text: s.text,
      startTs: s.startTs, lastTs: s.lastTs, waitingSince: s.waitingSince, counts: s.counts, recent: s.recent,
      subs: Object.values(s.subs), live: ag ? ag.status : null, listening: listeners.has(s.id),
      queued: instructions.filter((i) => i.sid === s.id && i.status === 'queued').length,
    });
  }
  const rank = { boss: 0, member: 1, none: 2 };
  list.sort((a, b) => (rank[a.role] - rank[b.role]) || a.startTs - b.startTs);
  return { now: Date.now(), sessions: list, feed, convo, media, stats, instructions: instructions.slice(-60) };
}

// ── 열린 세션 명부 (claude agents --json) ───────────────
function pollAgents() {
  execFile(CLAUDE_BIN, ['agents', '--json'], { timeout: 12_000, maxBuffer: 2 * 1024 * 1024 }, (err, out) => {
    if (err) return;
    let list;
    try { list = JSON.parse(out); } catch { return; }
    const now = Date.now();
    const seen = new Set();
    agents.clear();
    for (const a of list) {
      if (!a.sessionId) continue;
      // 오래 묵은 백그라운드 세션은 제외 (대화형이거나 하루 안에 시작한 것만)
      if (a.kind !== 'interactive' && now - (a.startedAt || 0) > 86400_000) continue;
      agents.set(a.sessionId, { name: a.name, status: a.status || a.state, kind: a.kind, pid: a.pid });
      seen.add(a.sessionId);
      if (!sessions.has(a.sessionId)) {
        const s = getSession({ sid: a.sessionId, cwd: a.cwd, ts: a.startedAt || now });
        s.lastTs = a.startedAt || now;
        if (a.status === 'busy') Object.assign(s, { status: 'working', location: 'inbox', text: '공무 중' });
        else Object.assign(s, { text: '어명을 기다리는 중' });
      }
    }
    // 재시작 직후엔 명부가 비어 받는 이를 못 찾으므로, 명부가 들어오면 다시 푼다
    for (const c of convo) if (!c.to && c.toLabel && c.from !== 'king') c.to = resolveTarget(c.toLabel, c.from);
    // 명부에서 사라졌고 2분 넘게 소식 없는 세션은 퇴궐 처리
    for (const [sid, s] of sessions) {
      if (s.provider === 'claude' && !s.readOnly && !seen.has(sid) && now - s.lastTs > 120_000) sessions.delete(sid);
    }
    markDirty();
  });
}

// ── 로그 읽기 (재시작 복원 + 실시간 tail) ───────────────
let offset = 0;
let partial = '';

function trimLogIfHuge() {
  if (!existsSync(EVENTS) || statSync(EVENTS).size < MAX_LOG_BYTES) return;
  const keepFrom = Date.now() - 2 * 86400_000;
  const kept = readFileSync(EVENTS, 'utf8').split('\n').filter((l) => {
    try { return JSON.parse(l).ts >= keepFrom; } catch { return false; }
  });
  writeFileSync(EVENTS, kept.join('\n') + (kept.length ? '\n' : ''));
}

function replay() {
  trimLogIfHuge();
  if (!existsSync(EVENTS)) return;
  const buf = readFileSync(EVENTS, 'utf8');
  offset = Buffer.byteLength(buf);
  const from = Date.now() - REPLAY_WINDOW_MS;
  for (const line of buf.split('\n')) {
    if (!line) continue;
    try { const e = JSON.parse(line); if (e.ts >= from) apply(e); } catch { /* 깨진 줄 무시 */ }
  }
  sweepStale();
}

function readNew() {
  let size;
  try { size = statSync(EVENTS).size; } catch { return; }
  if (size < offset) { offset = 0; partial = ''; }
  if (size === offset) return;
  const fd = openSync(EVENTS, 'r');
  const len = size - offset;
  const b = Buffer.alloc(len);
  readSync(fd, b, 0, len, offset);
  closeSync(fd);
  offset = size;
  const lines = (partial + b.toString('utf8')).split('\n');
  partial = lines.pop();
  let changed = false;
  for (const line of lines) {
    if (!line) continue;
    try { apply(JSON.parse(line)); changed = true; } catch { /* 무시 */ }
  }
  if (changed) { markDirty(); tryDeliverAll(); }
}

function finishListener(sid, payload) {
  const l = listeners.get(sid);
  if (!l) return;
  clearTimeout(l.timer);
  listeners.delete(sid);
  try { json(l.res, 200, payload); } catch { /* 연결 끊김 */ }
}

function tryDeliver(sid) {
  const l = listeners.get(sid);
  if (!l) return;
  const s = sessions.get(sid);
  if (s && s.status !== 'idle') return; // 공무 중·윤허 대기 중엔 들고 있다가 끝나면 전달
  const ins = instructions.find((i) => i.sid === sid && i.status === 'queued');
  if (!ins) return;
  ins.status = 'delivered';
  ins.deliveredTs = Date.now();
  saveInstr();
  convo.push({ id: `royal-${ins.id}`, ts: ins.deliveredTs, from: 'king', to: sid, toLabel: null, text: ins.text, kind: 'royal', attachments: ins.attachments.map(({ id, name, mime }) => ({ id, name, mime })) });
  if (convo.length > CONVO_MAX) convo = convo.slice(-CONVO_MAX);
  if (s) Object.assign(s, { location: 'inbox', status: 'working', text: '어명 접수 (웹)' });
  finishListener(sid, { type: 'instruction', instruction: { id: ins.id, text: ins.text, attachments: ins.attachments.map(({ name, path }) => ({ name, path })) } });
  markDirty();
}
function tryDeliverAll() { for (const sid of listeners.keys()) tryDeliver(sid); }

function sweepStale() {
  const now = Date.now();
  let changed = false;
  for (const [id, s] of sessions) {
    if (now - s.lastTs > STALE_MS && !agents.has(id)) { sessions.delete(id); changed = true; continue; }
    for (const [aid, sub] of Object.entries(s.subs)) {
      if (now - sub.lastTs > 30 * 60_000) { delete s.subs[aid]; changed = true; }
    }
  }
  if (dayKey(now) > stats.day) { stats = freshStats(dayKey(now)); changed = true; }
  return changed;
}

// ── SSE ─────────────────────────────────────────────────
const clients = new Set();
let dirty = false;
const markDirty = () => { dirty = true; };
function send(res, data) { res.write(`event: state\ndata: ${JSON.stringify(data)}\n\n`); }
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  const st = publicState();
  for (const c of clients) send(c, st);
}, 400);
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 20_000);
setInterval(() => { if (sweepStale()) markDirty(); }, 60_000);

// ── HTTP ────────────────────────────────────────────────
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8',
};

function sameOrigin(req) {
  const o = req.headers.origin;
  return !o || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o);
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > limit) reject(new Error('too large')); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (err) { reject(err); } });
  });
}

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

function serveFile(res, file, extraHeaders = {}) {
  const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', ...extraHeaders });
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    clients.add(res);
    send(res, publicState());
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/state') return json(res, 200, publicState());

  // 진상된 자료 (이미지·PDF·문서)
  const mm = url.pathname.match(/^\/media\/([\w-]+\.\w+)$/);
  if (mm) {
    const file = join(MEDIA, mm[1]);
    if (!existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    // html 자료는 스크립트 없이 격리해서 보여준다
    const extra = extname(file) === '.html' ? { 'content-security-policy': 'sandbox; default-src \'none\'; img-src data: \'self\'; style-src \'unsafe-inline\'' } : {};
    return serveFile(res, file, extra);
  }

  // 수신기 롱폴링 (훅 전용, 토큰 필수)
  if (url.pathname === '/api/listen') {
    if (req.headers['x-farm-token'] !== TOKEN) return json(res, 403, { type: 'disabled' });
    const sid = url.searchParams.get('sid') || '';
    const lid = url.searchParams.get('lid') || '';
    if (!/^[\w-]{8,64}$/.test(sid) || !lid) return json(res, 400, { type: 'disabled' });
    if (meta.sessions[sid]?.hidden) return json(res, 200, { type: 'disabled' });
    const old = listeners.get(sid);
    if (old && old.lid !== lid) finishListener(sid, { type: 'superseded' });
    else if (old) finishListener(sid, { type: 'none' });
    const timer = setTimeout(() => { if (listeners.get(sid)?.res === res) { listeners.delete(sid); json(res, 200, { type: 'none' }); markDirty(); } }, 25_000);
    listeners.set(sid, { lid, res, timer });
    req.on('close', () => { const l = listeners.get(sid); if (l?.res === res) { clearTimeout(l.timer); listeners.delete(sid); markDirty(); } });
    markDirty();
    tryDeliver(sid);
    return;
  }

  // 웹 어명 내리기 (본문 + 이미지 첨부)
  const mi = url.pathname.match(/^\/api\/sessions\/([\w-]+)\/instructions$/);
  if (mi && req.method === 'POST') {
    if (!sameOrigin(req) || req.headers['x-farm'] !== '1') return json(res, 403, { error: 'origin' });
    let body;
    try { body = await readBody(req, 45 * 1024 * 1024); } catch { return json(res, 400, { error: '첨부가 너무 크옵니다 (합계 40MB까지)' }); }
    const sid = mi[1];
    const session = sessions.get(sid);
    if (session?.readOnly || session?.provider === 'codex' || sid.startsWith('codex-')) {
      return json(res, 409, { error: '이 세션의 지시는 연결된 Claude Code 또는 Codex에서 내려 주세요.' });
    }
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 8000) : '';
    const atts = Array.isArray(body.attachments) ? body.attachments.slice(0, 8) : [];
    if (!text && !atts.length) return json(res, 400, { error: '어명 내용이 비었사옵니다' });
    const saved = [];
    for (const a of atts) {
      const mt = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/.exec(a?.dataUrl || '');
      if (!mt) return json(res, 400, { error: '이미지(png·jpg·gif·webp)만 첨부할 수 있사옵니다' });
      const buf = Buffer.from(mt[2], 'base64');
      if (buf.length > 10 * 1024 * 1024) return json(res, 400, { error: '이미지 한 장은 10MB까지이옵니다' });
      const id = randomUUID().replace(/-/g, '') + IMG_MIME[mt[1]];
      const path = join(MEDIA, id);
      writeFileSync(path, buf);
      saved.push({ id, name: String(a.name || id).slice(0, 80), mime: mt[1], size: buf.length, path });
    }
    const ins = { id: randomUUID().slice(0, 8), sid, ts: Date.now(), text, attachments: saved, status: 'queued' };
    instructions.push(ins);
    saveInstr();
    markDirty();
    tryDeliver(sid);
    return json(res, 200, { ok: true, id: ins.id, status: ins.status });
  }
  const mc = url.pathname.match(/^\/api\/instructions\/([\w-]+)\/cancel$/);
  if (mc && req.method === 'POST') {
    if (!sameOrigin(req) || req.headers['x-farm'] !== '1') return json(res, 403, { error: 'origin' });
    const ins = instructions.find((i) => i.id === mc[1]);
    if (!ins || ins.status !== 'queued') return json(res, 409, { error: '이미 전달되었거나 없는 어명이옵니다' });
    ins.status = 'canceled';
    saveInstr(); markDirty();
    return json(res, 200, { ok: true });
  }

  const m = url.pathname.match(/^\/api\/sessions\/([\w-]+)$/);
  if (m && req.method === 'POST') {
    if (!sameOrigin(req) || req.headers['x-farm'] !== '1') return json(res, 403, { error: 'origin' });
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'body' }); }
    const id = m[1];
    const cur = meta.sessions[id] || {};
    if (typeof body.name === 'string') {
      const n = body.name.trim().slice(0, 20);
      if (n) cur.name = n; else delete cur.name;
    }
    if (['boss', 'member', 'none'].includes(body.role)) {
      if (body.role === 'boss') for (const v of Object.values(meta.sessions)) if (v.role === 'boss') v.role = 'none'; // 영의정은 한 명
      cur.role = body.role;
    }
    if (typeof body.hidden === 'boolean') cur.hidden = body.hidden;
    meta.sessions[id] = cur;
    saveMeta();
    markDirty();
    return json(res, 200, { ok: true });
  }

  // 정적 파일
  const p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = normalize(join(PUBLIC, decodeURIComponent(p)));
  if (!file.startsWith(PUBLIC + '/') || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  serveFile(res, file);
});

replay();
// 웹 어명 기록은 instructions.json에 있으니 회의록에 되살린다
for (const ins of instructions) if (ins.status === 'delivered' && Date.now() - ins.deliveredTs < REPLAY_WINDOW_MS) {
  convo.push({ id: `royal-${ins.id}`, ts: ins.deliveredTs, from: 'king', to: ins.sid, toLabel: null, text: ins.text, kind: 'royal', attachments: ins.attachments.map(({ id, name, mime }) => ({ id, name, mime })) });
}
convo.sort((a, b) => a.ts - b.ts);
watchFile(EVENTS, { interval: 200 }, readNew);
if (AGENTS_POLL) { pollAgents(); setInterval(pollAgents, AGENTS_POLL); }
server.listen(PORT, HOST, () => {
  console.log(`🏯 Agent Court: http://localhost:${server.address().port}  (데이터: ${DATA_DIR})`);
});
