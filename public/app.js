import { BUILDINGS, BUILDING, Scene, lookOf, KING_LOOK, GOBLIN_LOOK, portraitUrl, effStatus, loadSprites } from './pixel.js';
import { MAP_IMAGE } from './concept-map.js';

const $ = (s) => document.querySelector(s);
const wrap = $('#canvasWrap');
const tooltip = $('#tooltip');

const LOC_LABEL = Object.fromEntries(BUILDINGS.map((b) => [b.key, b.label]));
const LOC_COLOR = Object.fromEntries(BUILDINGS.map((b) => [b.key, b.color]));
const ROLE_LABEL = { boss: '영의정', member: '판서', none: '백성' };
const STATUS_LABEL = { working: '공무 중', waiting: '윤허 대기', idle: '대기', sleep: '졸음' };
const providerLabel = (s) => s.provider === 'codex' ? 'Codex' : 'Claude Code';
const SIJIN = ['자시', '축시', '인시', '묘시', '진시', '사시', '오시', '미시', '신시', '유시', '술시', '해시'];

let state = { sessions: [], feed: [], convo: [], media: [], stats: null, instructions: [] };
let first = true;
let selected = null; // { type: 'session'|'building'|'king', id|key }
let showHidden = false;
let tab = 'feed';
let unread = { convo: 0, media: 0 };
let soundOn = true, notifyOn = false;
const seenFeed = new Set(), seenConvo = new Set(), seenMedia = new Set();
const prevStatus = new Map();
let scene;

// ── 유틸 ────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const hhmmss = (ts) => `${hhmm(ts)}:${pad(new Date(ts).getSeconds())}`;
function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분 전`;
}
const sessionById = (id) => state.sessions.find((s) => s.id === id);
const nameOf = (id) => (id === 'king' ? '전하' : sessionById(id)?.name || (id ? id.slice(0, 6) : '?'));
const lookOfId = (id) => (id === 'king' ? KING_LOOK : lookOf(sessionById(id)));
const portrait = (look, size = 34, cls = '') => `<img class="pt ${cls}" src="${portraitUrl(look, size * 2)}" width="${size}" height="${size}" alt="">`;
const EMO = { bang: '❗', cross: '❌', ask: '❓', sad: '😢' };
const visibleSessions = () => state.sessions.filter((s) => showHidden || !s.hidden);
const isImage = (mime) => /^image\//.test(mime || '');
try { soundOn = localStorage.getItem('farm.sound') !== '0'; notifyOn = localStorage.getItem('farm.notify') === '1'; } catch { /* 무시 */ }

// ── 소리 ────────────────────────────────────────────────
let audioCtx;
function tone(notes, type = 'square', vol = 0.05) {
  if (!soundOn) return;
  try {
    audioCtx ||= new AudioContext();
    const now = audioCtx.currentTime;
    notes.forEach(([f, at, len]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + at);
      g.gain.exponentialRampToValueAtTime(vol, now + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + len);
      o.connect(g).connect(audioCtx.destination);
      o.start(now + at); o.stop(now + at + len + 0.02);
    });
  } catch { /* 무시 */ }
}
const SFX = {
  approval: () => tone([[659, 0, 0.12], [880, 0.13, 0.12], [659, 0.26, 0.12], [880, 0.39, 0.2]]),
  message: () => tone([[988, 0, 0.06], [1319, 0.07, 0.09]], 'triangle', 0.06),
  media: () => tone([[523, 0, 0.1], [659, 0.1, 0.1], [784, 0.2, 0.1], [1047, 0.3, 0.25]], 'triangle', 0.07),
  join: () => tone([[392, 0, 0.08], [523, 0.09, 0.14]], 'triangle', 0.05),
  sent: () => tone([[784, 0, 0.08], [1175, 0.09, 0.16]], 'triangle', 0.06),
};

// ── 알림(토스트) ────────────────────────────────────────
const toasts = new Map();
function toast({ key, kind = 'info', look, emo, title, body, actions = [], ttl = 6000 }) {
  const box = $('#toasts');
  if (key && toasts.has(key)) toasts.get(key).remove();
  const el = document.createElement('div');
  el.className = `toast px-parch ${kind}`;
  const icon = look ? `<div class="portrait">${portrait(look)}</div>` : `<div class="portrait glyph">${emo ?? EMO.bang}</div>`;
  el.innerHTML = `${icon}<div><div class="tt">${esc(title)}</div>${body ? `<div class="tb">${esc(body)}</div>` : ''}${actions.length ? `<div class="ta">${actions.map((a, i) => `<button class="btn" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}</div>`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (b) { actions[+b.dataset.i].run(); dismiss(); }
    else if (actions[0]) { actions[0].run(); dismiss(); }
  });
  const dismiss = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); if (key) toasts.delete(key); };
  el.dismiss = dismiss;
  box.prepend(el);
  while (box.children.length > 5) box.lastChild.remove();
  if (key) toasts.set(key, el);
  if (ttl) setTimeout(() => { if (el.isConnected) dismiss(); }, ttl);
  return el;
}
function osNotify(title, body, onClick) {
  if (!notifyOn || !('Notification' in window) || Notification.permission !== 'granted' || document.hasFocus()) return;
  const n = new Notification(title, { body });
  n.onclick = () => { window.focus(); onClick?.(); };
}

// ── 이벤트 → 효과 ───────────────────────────────────────
const KIND_EMOTE = { build: 'star', test: 'spiral', check: 'ring', fail: 'cross', done: 'smile', sub: 'spark', show: 'star', inbox: 'bulb' };
function react() {
  // 실록 → 말풍선·이모트
  for (const f of state.feed) {
    const k = `${f.ts}|${f.sid}|${f.aid || ''}|${f.text}`;
    if (seenFeed.has(k)) continue;
    seenFeed.add(k);
    if (first) continue;
    const id = f.aid || f.sid;
    if (f.kind !== 'message') scene.say(id, f.text, f.kind === 'approval' ? 5000 : 3200, f.kind === 'approval' ? 'alert' : 'normal');
    const em = f.ev === 'UserPromptSubmit' ? 'bulb' : KIND_EMOTE[f.kind];
    if (em) scene.emote(id, em);
    const a = scene.actors.get(id);
    if (a && f.kind === 'build') scene.burst(...scene.actorWorld(a), '#ffd36b', 8);
    if (a && f.kind === 'fail') scene.burst(...scene.actorWorld(a), '#ff5a5a', 12);
    if (a && f.kind === 'done') scene.burst(...scene.actorWorld(a), '#9ad0c2', 8);
  }
  // 회의록 → 서찰 비행
  for (const c of state.convo) {
    if (seenConvo.has(c.id)) continue;
    seenConvo.add(c.id);
    if (first) continue;
    if (tab !== 'convo') unread.convo++;
    const excerpt = c.text.replace(/\s+/g, ' ').slice(0, 60);
    if (c.from === 'king') {
      scene.emote(c.to, 'bang2', 2200);
      scene.say(c.to, `어명 받잡았사옵니다`, 3500, 'message');
      toast({ kind: 'info', look: KING_LOOK, title: `어명이 ${nameOf(c.to)}에게 닿았사옵니다`, body: excerpt, ttl: 5000 });
      SFX.sent();
    } else {
      scene.letter(c.from, c.to);
      scene.say(c.from, excerpt, 6500, 'message');
      const verb = c.kind === 'order' ? '하명' : '장계';
      toast({ kind: 'info', look: lookOfId(c.from), title: `${nameOf(c.from)} → ${c.to ? nameOf(c.to) : c.toLabel || '?'} ${verb}`, body: excerpt, ttl: 6000, actions: [{ label: '회의록 보기', run: () => setTab('convo') }] });
      SFX.message();
    }
  }
  // 자료함 → 진상 알림
  for (const m of state.media) {
    if (seenMedia.has(m.id)) continue;
    seenMedia.add(m.id);
    if (first) continue;
    if (tab !== 'media') unread.media++;
    scene.emote(m.sid, 'star', 2500);
    toast({ key: `m-${m.id}`, kind: 'info', look: lookOfId(m.sid), title: `${nameOf(m.sid)}이(가) 자료를 진상하였사옵니다`, body: `${m.title}${m.files.length > 1 ? ` 외 ${m.files.length - 1}건` : ''}${m.note ? `\n${m.note}` : ''}`, ttl: 15000, actions: [{ label: '펼쳐 보기', run: () => openViewer(m.id, 0) }, { label: '나중에', run: () => {} }] });
    SFX.media();
    osNotify('📜 자료 진상', `${nameOf(m.sid)} · ${m.title}`, () => openViewer(m.id, 0));
  }
  // 상태 변화 → 윤허 알림·입궐/퇴궐
  const nowIds = new Set(state.sessions.map((s) => s.id));
  for (const s of state.sessions) {
    const before = prevStatus.get(s.id);
    if (!first && before === undefined && !s.hidden) { toast({ kind: 'info', look: lookOf(s), title: `${s.name} 입궐하였사옵니다`, body: s.project, ttl: 4000 }); SFX.join(); }
    if (s.status === 'waiting' && before !== 'waiting' && !s.hidden && !first) {
      toast({ key: `w-${s.id}`, kind: 'approval', look: lookOf(s), title: `${s.name}이(가) 윤허를 청하옵니다`, body: `${s.text}\n터미널에서 윤허해 주시옵소서`, ttl: 0, actions: [{ label: '살펴보기', run: () => select({ type: 'session', id: s.id }) }] });
      SFX.approval();
      osNotify('❗ 윤허 대기', `${s.name} · ${s.text}`, () => select({ type: 'session', id: s.id }));
    }
    if (s.status !== 'waiting' && toasts.has(`w-${s.id}`)) toasts.get(`w-${s.id}`).dismiss();
    prevStatus.set(s.id, s.status);
  }
  for (const id of [...prevStatus.keys()]) {
    if (!nowIds.has(id)) {
      prevStatus.delete(id);
      if (!first) toast({ kind: 'info', emo: EMO.sad, title: `${nameOf(id)} 퇴궐하였사옵니다`, ttl: 3500 });
      toasts.get(`w-${id}`)?.dismiss();
    }
  }
  first = false;
}

// ── 좌측 판넬 ───────────────────────────────────────────
let lastStats = {};
function renderStats() {
  const st = state.stats || {};
  const vis = visibleSessions();
  const waiting = vis.filter((s) => s.status === 'waiting').length;
  const cells = [
    ['🏯', '입궐 세션', vis.length, 'n'], ['⚒', '공무 중', vis.filter((s) => s.status === 'working').length, 'w'],
    ['❗', '윤허 대기', waiting, 'a', waiting ? 'alert' : ''], ['📜', '오늘 어명', st.prompts ?? 0, 'p'],
    ['✉', '장계·하명', st.messages ?? 0, 'm'], ['✎', '문서 수정', st.edits ?? 0, 'e'],
    ['🎯', '시험', st.tests ?? 0, 't'], ['🖼', '자료 진상', st.shows ?? 0, 's'],
  ];
  $('#stats').innerHTML = cells.map(([ico, k, v, id, cls]) => {
    const pop = lastStats[id] !== undefined && lastStats[id] !== v ? 'pop' : '';
    lastStats[id] = v;
    return `<div class="stat ${cls || ''} ${pop}"><span class="ico">${ico}</span><div><div class="k">${k}</div><div class="v">${esc(v)}</div></div></div>`;
  }).join('');
}

function renderFeed() {
  const items = [...state.feed].reverse().slice(0, 70);
  $('#feed').innerHTML = items.map((f, i) => {
    const who = f.aid ? `${nameOf(f.sid)}의 도깨비` : nameOf(f.sid);
    return `<li data-sid="${esc(f.sid)}" class="${i < 1 && !first ? 'new' : ''}"><span class="t">${hhmmss(f.ts)}</span><span><span class="dot" style="background:${LOC_COLOR[f.loc] || '#888'}"></span><span class="who">${esc(who)}</span> ${esc(f.text)}</span></li>`;
  }).join('') || '<li class="muted">아직 기록이 없사옵니다</li>';
}

const expanded = new Set();
function attThumbs(atts) {
  if (!atts?.length) return '';
  return `<div class="att-row">${atts.map((a, i) => `<img class="att" src="/media/${esc(a.id)}" data-att="${esc(a.id)}" data-i="${i}" alt="${esc(a.name)}" title="${esc(a.name)}">`).join('')}</div>`;
}
function renderConvo() {
  const items = [...state.convo].reverse().slice(0, 60);
  $('#convo').innerHTML = items.map((c) => {
    const long = c.text.length > 220;
    const open = expanded.has(c.id);
    const kindLabel = c.kind === 'royal' ? '어명' : c.kind === 'order' ? '하명' : '장계';
    const kindCls = c.kind === 'royal' || c.kind === 'order' ? 'order' : 'report';
    return `<div class="msg ${kindCls}">
      <div class="portrait">${portrait(lookOfId(c.from))}</div>
      <div><div class="msg-head"><b>${esc(nameOf(c.from))}</b> → <b>${esc(c.to ? nameOf(c.to) : c.toLabel || '?')}</b><span class="kind ${kindCls}">${kindLabel}</span><span class="t">${hhmm(c.ts)}</span></div>
      <div class="px-parch"><div class="msg-body ${long && !open ? 'clamp' : ''}">${esc(c.text)}</div>${long ? `<button class="more" data-exp="${esc(c.id)}">${open ? '접기' : '펼쳐 읽기'}</button>` : ''}${attThumbs(c.attachments)}</div></div>
    </div>`;
  }).join('') || '<div class="empty">아직 오간 장계·하명이 없사옵니다.<br>세션끼리 서찰을 주고받으면<br>여기에 기록되옵니다.</div>';
}
$('#convo').addEventListener('click', (e) => {
  const b = e.target.closest('[data-exp]');
  if (b) { const id = b.dataset.exp; expanded.has(id) ? expanded.delete(id) : expanded.add(id); renderConvo(); return; }
  const img = e.target.closest('[data-att]');
  if (img) openImage(img.src, img.alt);
});

function renderMedia() {
  const items = [...state.media].reverse();
  $('#media').innerHTML = items.map((m) => {
    const f = m.files[0];
    const thumb = isImage(f.mime) ? `style="background-image:url('/media/${esc(f.id)}')"` : '';
    const inner = isImage(f.mime) ? '' : `<span class="doc ${f.mime === 'application/pdf' ? '' : 'txt'}">${f.mime === 'application/pdf' ? 'PDF' : 'TXT'}</span>`;
    return `<div class="mcard px-parch" data-media="${esc(m.id)}"><div class="mthumb" ${thumb}>${inner}</div><div class="mtitle">${esc(m.title)}${m.files.length > 1 ? ` (${m.files.length})` : ''}</div><div class="msub">${esc(nameOf(m.sid))} · ${hhmm(m.ts)}</div></div>`;
  }).join('') || '<div class="empty" style="grid-column:span 2">아직 진상된 자료가 없사옵니다.<br>세션이 farm-show로 이미지·PDF를<br>올리면 여기 쌓이옵니다.</div>';
}
$('#media').addEventListener('click', (e) => { const c = e.target.closest('[data-media]'); if (c) openViewer(c.dataset.media, 0); });

function setTab(t) {
  tab = t;
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === t);
  $('#tabFeed').hidden = t !== 'feed'; $('#tabConvo').hidden = t !== 'convo'; $('#tabMedia').hidden = t !== 'media';
  if (t === 'convo') unread.convo = 0;
  if (t === 'media') unread.media = 0;
  renderBadges();
}
function renderBadges() { $('#nConvo').textContent = unread.convo || ''; $('#nMedia').textContent = unread.media || ''; }
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
$('#feed').addEventListener('click', (e) => { const li = e.target.closest('li[data-sid]'); if (li && sessionById(li.dataset.sid)) select({ type: 'session', id: li.dataset.sid }); });

function renderAlerts() {
  const waiting = visibleSessions().filter((s) => s.status === 'waiting');
  $('#alerts').innerHTML = waiting.map((s) => `<div class="alert-item" data-sid="${esc(s.id)}"><span class="seal-sm">윤허</span><b>${esc(s.name)}</b> ${esc(s.text)} — 터미널에서 윤허해 주시옵소서<span class="ago">${s.waitingSince ? ago(s.waitingSince) : ''}</span></div>`).join('');
  document.title = waiting.length ? `(❗${waiting.length}) Agent Court` : 'Agent Court';
}
$('#alerts').addEventListener('click', (e) => { const el = e.target.closest('[data-sid]'); if (el) select({ type: 'session', id: el.dataset.sid }); });

// ── 우측 판넬 ───────────────────────────────────────────
function sessCard(s) {
  const st = effStatus(s);
  return `<div class="sess px-parch ${st === 'waiting' ? 'waiting' : ''}" data-sid="${esc(s.id)}">
    <div class="portrait">${portrait(lookOf(s))}</div>
    <div><div class="name">${esc(s.name)} <span class="badge ${s.role}">${ROLE_LABEL[s.role]}</span> <span class="badge st-${st}">${STATUS_LABEL[st]}</span>${s.queued ? ' <span class="badge st-waiting">어명 대기 ' + s.queued + '</span>' : ''}</div>
    <div class="sub">${esc(LOC_LABEL[s.location])} · ${esc(s.text)}</div>
    <div class="sub">${providerLabel(s)} · ${esc(s.project)} · ${ago(s.lastTs)}${s.subs.length ? ` · 도깨비 ${s.subs.length}` : ''}${s.listening ? ' · 👂' : ''}</div></div>
  </div>`;
}

function renderList() {
  const vis = state.sessions.filter((s) => !s.hidden);
  const hidden = state.sessions.filter((s) => s.hidden);
  const shown = showHidden ? state.sessions : vis;
  return `<h2 class="ribbon">조정 명부 (${vis.length})</h2>
    <div class="sess-list">${shown.map(sessCard).join('') || '<div class="empty">Claude Code 또는 Codex를 연결하고 평소처럼 작업해 주세요. 새 세션의 작업이 이곳에 나타납니다.<br><br>설치 안내는 함께 제공된 시작하기 문서에서 볼 수 있습니다.</div>'}</div>
    ${hidden.length ? `<button class="btn wide" data-act="toggle-hidden">${showHidden ? '숨긴 세션 감추기' : `숨긴 세션 ${hidden.length}개 보기`}</button>` : ''}`;
}

const composerDraft = { text: '', atts: [] }; // 세션 바꿔도 초안 유지
function composerHtml(s) {
  if (s.canReceiveOrders === false || s.provider === 'codex') return `<div class="empty">${providerLabel(s)}의 작업을 보고 있사옵니다.<br>지시는 평소 쓰시던 ${providerLabel(s)}에서 내려 주세요.</div>`;
  const mine = state.instructions.filter((i) => i.sid === s.id).slice(-6).reverse();
  const listenHint = s.listening ? '👂 어명을 들을 채비가 되어 있사옵니다' : s.status === 'idle' ? '아직 수신 채비 전이옵니다 (한 번 응답을 마치면 시작되옵니다). 내리시면 대기열에 두었다가 전하옵니다' : '공무 중이라, 하던 일이 끝나면 전해 올리겠사옵니다';
  return `<h4>📜 어명 내리기</h4>
    <div class="composer px-parch" id="composer">
      <textarea id="cmpText" rows="4" placeholder="${esc(s.name)}에게 내릴 어명을 적으시옵소서 (⌘/Ctrl+Enter로 하달)&#10;이미지는 끌어다 놓거나 붙여넣을 수 있사옵니다">${esc(composerDraft.text)}</textarea>
      <div class="att-row" id="cmpAtts">${composerDraft.atts.map((a, i) => `<div class="att-wrap"><img class="att" src="${a.dataUrl}" data-prev="${i}" title="${esc(a.name)}"><button class="att-x" data-rm="${i}">✕</button></div>`).join('')}</div>
      <div class="cmp-foot"><label class="btn">🖼 그림 첨부<input type="file" id="cmpFile" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden></label><span class="muted small">${esc(listenHint)}</span><button class="btn btn-red" data-act="send">하달</button></div>
    </div>
    ${mine.length ? `<ul class="mini">${mine.map((i) => `<li><span class="t">${hhmm(i.ts)}</span><span>${{ queued: '⏳ 대기', delivered: '✅ 전달', canceled: '✖ 철회' }[i.status]} · ${esc(i.text.slice(0, 50) || '(그림만)')}${i.attachments.length ? ` · 🖼${i.attachments.length}` : ''}${i.status === 'queued' ? ` <button class="more" data-cancel="${esc(i.id)}">철회</button>` : ''}</span></li>`).join('')}</ul>` : ''}`;
}

function renderDetail(s) {
  const st = effStatus(s);
  const recent = [...s.recent].reverse();
  const talks = state.convo.filter((c) => c.from === s.id || c.to === s.id).slice(-5).reverse();
  return `<div class="detail">
    <div class="side-title"><button class="btn" data-act="back">← 명부</button><span class="muted">${esc(s.id.slice(0, 8))}</span></div>
    <div class="head"><div class="portrait">${portrait(lookOf(s), 64)}</div>
      <div><h3>${esc(s.name)}</h3><div class="muted">${providerLabel(s)} · ${ROLE_LABEL[s.role]} · ${esc(s.project)}</div><div style="margin-top:4px"><span class="badge st-${st}">${STATUS_LABEL[st]}</span></div></div></div>
    ${composerHtml(s)}
    <div class="field"><input id="nameInput" maxlength="20" placeholder="관직명 (예: 좌의정)" value="${esc(s.customName ? s.name : '')}"><button class="btn" data-act="save-name">제수</button></div>
    <div class="seg">${['boss', 'member', 'none'].map((r) => `<button class="btn ${s.role === r ? 'on' : ''}" data-act="role" data-role="${r}">${ROLE_LABEL[r]}</button>`).join('')}</div>
    <div class="row"><span>지금</span><span>${esc(LOC_LABEL[s.location])} · ${esc(s.text)}</span></div>
    ${s.waitingSince ? `<div class="row"><span>윤허 대기</span><span>${ago(s.waitingSince)}부터</span></div>` : ''}
    <div class="row"><span>입궐</span><span>${hhmm(s.startTs)}</span></div>
    <div class="row"><span>마지막 공무</span><span>${ago(s.lastTs)}</span></div>
    <div class="row"><span>도구 · 수정 · 시험 · 서찰</span><span>${s.counts.tools} · ${s.counts.edits} · ${s.counts.tests} · ${s.counts.messages || 0}</span></div>
    ${s.subs.length ? `<h4>도깨비 (${s.subs.length})</h4><ul class="mini">${s.subs.map((u) => `<li><span class="t">${esc(LOC_LABEL[u.location])}</span><span>${esc(u.label)}<br><span class="muted">${esc(u.text)}</span></span></li>`).join('')}</ul>` : ''}
    ${talks.length ? `<h4>최근 서찰</h4><ul class="mini">${talks.map((c) => `<li><span class="t">${hhmm(c.ts)}</span><span>${esc(nameOf(c.from))} → ${esc(c.to ? nameOf(c.to) : c.toLabel || '?')}: ${esc(c.text.replace(/\s+/g, ' ').slice(0, 60))}</span></li>`).join('')}</ul>` : ''}
    <h4>최근 공무</h4>
    <ul class="mini">${recent.map((f) => `<li><span class="t">${hhmm(f.ts)}</span><span>${f.aid ? '<span class="muted">[도깨비]</span> ' : ''}${esc(f.text)}</span></li>`).join('') || '<li class="muted">없사옵니다</li>'}</ul>
    <button class="btn wide ${s.hidden ? '' : 'btn-red'}" data-act="hide">${s.hidden ? '지도에 다시 모시기' : '지도에서 물리기'}</button>
  </div>`;
}

function renderBuilding(key) {
  const b = BUILDING[key];
  const here = visibleSessions().filter((s) => s.location === key);
  const subs = visibleSessions().flatMap((s) => s.subs.filter((u) => u.location === key).map((u) => ({ ...u, parent: s })));
  const events = [...state.feed].reverse().filter((f) => f.loc === key).slice(0, 15);
  return `<div class="detail">
    <div class="side-title"><button class="btn" data-act="back">← 명부</button></div>
    <h3 style="color:${b.color}">${esc(b.label)} <span class="muted">${esc(b.hanja)}</span></h3>
    <p class="muted" style="margin:4px 0 10px">${esc(b.desc)}</p>
    <h4>지금 여기 (${here.length + subs.length})</h4>
    <div class="sess-list">${here.map(sessCard).join('')}${subs.map((u) => `<div class="sess px-parch"><div class="portrait">${portrait(GOBLIN_LOOK)}</div><div><div class="name">도깨비</div><div class="sub">${esc(u.parent.name)} 소속 · ${esc(u.label)}</div></div></div>`).join('') || '<div class="muted">아무도 없사옵니다</div>'}</div>
    <h4>최근 이곳 공무</h4>
    <ul class="mini">${events.map((f) => `<li><span class="t">${hhmm(f.ts)}</span><span><b>${esc(nameOf(f.sid))}</b> ${esc(f.text)}</span></li>`).join('') || '<li class="muted">없사옵니다</li>'}</ul>
  </div>`;
}

function renderKing() {
  const waiting = visibleSessions().filter((s) => s.status === 'waiting');
  return `<div class="detail">
    <div class="side-title"><button class="btn" data-act="back">← 명부</button></div>
    <div class="head"><div class="portrait">${portrait(KING_LOOK, 64)}</div><div><h3>전하</h3><div class="muted">에이전트 조정의 임금</div></div></div>
    <div class="row"><span>윤허를 청하는 신하</span><span>${waiting.length}명</span></div>
    <div class="row"><span>오늘 내리신 어명</span><span>${(state.stats?.prompts ?? 0)}건</span></div>
    <div class="row"><span>웹으로 내리신 어명</span><span>${state.instructions.filter((i) => i.status !== 'canceled').length}건</span></div>
    <p class="muted" style="line-height:1.6;margin-top:10px">신하를 누르시면 그 신하에게 바로 어명을 내리실 수 있사옵니다.</p>
  </div>`;
}

let sidePointer = false, sidePending = false;
const sideEl = $('#side');
sideEl.addEventListener('pointerdown', () => { sidePointer = true; });
window.addEventListener('pointerup', () => setTimeout(() => { sidePointer = false; if (sidePending) { sidePending = false; renderSide(); } }, 0));
const busyTyping = () => ['nameInput', 'cmpText'].includes(document.activeElement?.id);

function renderSide(force = false) {
  if (!force && (busyTyping() || sidePointer)) { sidePending = true; return; }
  const scroll = sideEl.scrollTop;
  if (selected?.type === 'session') {
    const s = sessionById(selected.id);
    if (!s) { selected = null; sideEl.innerHTML = renderList(); }
    else { sideEl.innerHTML = renderDetail(s); bindComposer(s); }
  } else if (selected?.type === 'building') sideEl.innerHTML = renderBuilding(selected.key);
  else if (selected?.type === 'king') sideEl.innerHTML = renderKing();
  else sideEl.innerHTML = renderList();
  sideEl.scrollTop = scroll;
  scene.selectedId = selected?.type === 'session' ? selected.id : null;
  scene.selectedBuilding = selected?.type === 'building' ? selected.key : null;
}
function select(sel) {
  selected = sel; renderSide(true); sideEl.scrollTop = 0;
  if (sel?.type === 'session') scene.focus(sel.id);
  else if (sel?.type === 'building') scene.focusBuilding(sel.key);
}

// ── 어명 작성란 ─────────────────────────────────────────
function readImage(file) {
  return new Promise((ok, fail) => {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return fail(new Error('이미지(png·jpg·gif·webp)만 첨부할 수 있사옵니다'));
    if (file.size > 10 * 1024 * 1024) return fail(new Error('이미지 한 장은 10MB까지이옵니다'));
    const r = new FileReader();
    r.onload = () => ok({ name: file.name || 'clipboard.png', dataUrl: r.result });
    r.onerror = () => fail(r.error);
    r.readAsDataURL(file);
  });
}
async function addFiles(files) {
  for (const f of files) {
    try { if (composerDraft.atts.length < 8) composerDraft.atts.push(await readImage(f)); } catch (err) { toast({ kind: 'approval', emo: EMO.cross, title: '첨부하지 못하였사옵니다', body: err.message, ttl: 4000 }); }
  }
  composerDraft.text = $('#cmpText')?.value ?? composerDraft.text;
  renderSide(true);
  $('#cmpText')?.focus();
}
function bindComposer(s) {
  const box = $('#composer'), ta = $('#cmpText');
  if (!box) return;
  ta.addEventListener('input', () => { composerDraft.text = ta.value; });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendInstruction(s); } });
  ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  $('#cmpFile').addEventListener('change', (e) => addFiles([...e.target.files]));
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drop'); });
  box.addEventListener('dragleave', () => box.classList.remove('drop'));
  box.addEventListener('drop', (e) => { e.preventDefault(); box.classList.remove('drop'); addFiles([...e.dataTransfer.files]); });
}
async function sendInstruction(s) {
  const text = ($('#cmpText')?.value ?? composerDraft.text).trim();
  if (!text && !composerDraft.atts.length) { toast({ kind: 'approval', emo: EMO.ask, title: '어명 내용이 비었사옵니다', ttl: 3000 }); return; }
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(s.id)}/instructions`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-farm': '1' },
      body: JSON.stringify({ text, attachments: composerDraft.atts }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || res.status);
    composerDraft.text = ''; composerDraft.atts = [];
    toast({ kind: 'info', look: KING_LOOK, title: `${s.name}에게 어명을 내리셨사옵니다`, body: j.status === 'queued' ? '하던 일이 끝나는 대로 전해 올리겠사옵니다' : '전달하였사옵니다', ttl: 4000 });
    SFX.sent();
    scene.emote(s.id, 'bang2', 2000);
    renderSide(true);
  } catch (err) {
    toast({ kind: 'approval', emo: EMO.cross, title: '어명을 전하지 못하였사옵니다', body: String(err.message || err), ttl: 6000 });
  }
}

async function patchSession(id, body) {
  await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-farm': '1' }, body: JSON.stringify(body) });
}
sideEl.addEventListener('click', async (e) => {
  const prev = e.target.closest('[data-prev]');
  if (prev) return openImage(prev.src, prev.title);
  const rm = e.target.closest('[data-rm]');
  if (rm) { composerDraft.atts.splice(+rm.dataset.rm, 1); composerDraft.text = $('#cmpText')?.value ?? composerDraft.text; return renderSide(true); }
  const cancel = e.target.closest('[data-cancel]');
  if (cancel) { await fetch(`/api/instructions/${cancel.dataset.cancel}/cancel`, { method: 'POST', headers: { 'x-farm': '1' } }); return; }
  const btn = e.target.closest('[data-act]');
  const sess = e.target.closest('.sess[data-sid]');
  if (btn) {
    const act = btn.dataset.act;
    const s = selected?.type === 'session' ? sessionById(selected.id) : null;
    if (act === 'back') return select(null);
    if (act === 'toggle-hidden') { showHidden = !showHidden; scene.sync(visibleSessions()); return renderSide(true); }
    if (act === 'save-name' && s) return patchSession(s.id, { name: $('#nameInput').value });
    if (act === 'role' && s) return patchSession(s.id, { role: btn.dataset.role });
    if (act === 'hide' && s) return patchSession(s.id, { hidden: !s.hidden });
    if (act === 'send' && s) return sendInstruction(s);
    return;
  }
  if (sess) select({ type: 'session', id: sess.dataset.sid });
});
sideEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'nameInput' && selected?.type === 'session') patchSession(selected.id, { name: e.target.value }); });

// ── 하단 막대 ───────────────────────────────────────────
function renderBars() {
  const by = state.stats?.byCat || {};
  const total = Object.values(by).reduce((a, b) => a + b, 0) || 1;
  $('#bars').innerHTML = BUILDINGS.map((b) => {
    const n = by[b.key] || 0;
    const pct = Math.round((n / total) * 100);
    return `<div class="bar"><div class="lbl"><span>${esc(b.label)}</span><b>${n}회 · ${pct}%</b></div><div class="track"><div class="fill" style="width:${pct}%;background:${b.color}"></div></div></div>`;
  }).join('');
}

// ── 자료 보기 ───────────────────────────────────────────
const viewer = { list: [], idx: 0, item: null };
function openViewer(mediaId, idx) {
  const m = state.media.find((x) => x.id === mediaId);
  if (!m) return;
  viewer.item = m; viewer.list = m.files; viewer.idx = idx;
  paintViewer();
}
function openImage(src, name) {
  viewer.item = { title: name || '첨부 그림', sid: null, ts: Date.now(), note: '' };
  viewer.list = [{ url: src, name, mime: 'image/*' }]; viewer.idx = 0;
  paintViewer();
}
async function paintViewer() {
  const f = viewer.list[viewer.idx];
  const url = f.url || `/media/${f.id}`;
  $('#vTitle').textContent = viewer.item.title;
  $('#vMeta').textContent = `${viewer.item.sid ? nameOf(viewer.item.sid) + ' · ' + hhmm(viewer.item.ts) + ' · ' : ''}${f.name}`;
  $('#vNote').textContent = viewer.item.note || '';
  $('#vIdx').textContent = viewer.list.length > 1 ? `${viewer.idx + 1} / ${viewer.list.length}` : '';
  $('#vPrev').hidden = $('#vNext').hidden = viewer.list.length < 2;
  $('#vOpen').href = url;
  const body = $('#vBody');
  if (isImage(f.mime)) {
    body.innerHTML = `<img src="${esc(url)}" alt="${esc(f.name)}">`;
    body.querySelector('img').addEventListener('click', (e) => e.target.classList.toggle('zoom'));
  } else if (f.mime === 'application/pdf' || f.mime === 'text/html') {
    body.innerHTML = `<iframe src="${esc(url)}" title="${esc(f.name)}"></iframe>`;
  } else {
    body.innerHTML = '<pre>불러오는 중…</pre>';
    try { body.querySelector('pre').textContent = await (await fetch(url)).text(); } catch { body.querySelector('pre').textContent = '불러오지 못하였사옵니다'; }
  }
  $('#viewer').hidden = false;
}
const closeViewer = () => { $('#viewer').hidden = true; $('#vBody').innerHTML = ''; };
$('#vClose').addEventListener('click', closeViewer);
$('#viewer').addEventListener('click', (e) => { if (e.target.id === 'viewer') closeViewer(); });
$('#vPrev').addEventListener('click', () => { viewer.idx = (viewer.idx - 1 + viewer.list.length) % viewer.list.length; paintViewer(); });
$('#vNext').addEventListener('click', () => { viewer.idx = (viewer.idx + 1) % viewer.list.length; paintViewer(); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (!$('#viewer').hidden) closeViewer(); else select(null); }
  if (!$('#viewer').hidden && e.key === 'ArrowRight') $('#vNext').click();
  if (!$('#viewer').hidden && e.key === 'ArrowLeft') $('#vPrev').click();
});

// ── 지도 입력 ───────────────────────────────────────────
function bindCanvas(canvas) {
  canvas.addEventListener('mousemove', (ev) => {
    const h = scene.hitTest(ev);
    scene.hover = h;
    canvas.style.cursor = h ? 'pointer' : 'grab';
    if (!h) { tooltip.hidden = true; return; }
    let html;
    if (h.type === 'actor') {
      const a = h.a;
      if (a.kind === 'sub') html = `<b>도깨비</b> <span class="muted">(${esc(a.parent?.name)} 소속)</span><br>${esc(a.sub?.label)}<br><span class="muted">${esc(a.sub?.text)}</span>`;
      else { const s = a.session; html = `<b>${esc(s.name)}</b> <span class="muted">${ROLE_LABEL[s.role]} · ${esc(s.project)}</span><br>${STATUS_LABEL[effStatus(s)]} · ${esc(LOC_LABEL[s.location])}<br><span class="muted">${esc(s.text)}</span>`; }
    } else if (h.type === 'king') html = '<b>전하</b><br><span class="muted">윤허를 청하는 신하가 있으면 근심하시옵니다</span>';
    else { const b = BUILDING[h.key]; html = `<b>${esc(b.label)}</b> <span class="muted">${esc(b.hanja)}</span><br><span class="muted">${esc(b.desc)}</span>`; }
    tooltip.className = 'tooltip px-parch';
    tooltip.innerHTML = html;
    tooltip.hidden = false;
    const wr = wrap.getBoundingClientRect();
    tooltip.style.left = `${Math.min(ev.clientX - wr.left + 14, wr.width - 270)}px`;
    tooltip.style.top = `${ev.clientY - wr.top + 14}px`;
  });
  canvas.addEventListener('mouseleave', () => { scene.hover = null; tooltip.hidden = true; });
  canvas.addEventListener('click', (ev) => {
    if (scene.justDragged) return;
    const h = scene.hitTest(ev);
    if (!h) return select(null);
    if (h.type === 'actor') { selected = { type: 'session', id: h.a.kind === 'sub' ? h.a.parent.id : h.a.session.id }; return renderSide(true); }
    if (h.type === 'king') return select({ type: 'king' });
    selected = { type: 'building', key: h.key }; renderSide(true);
  });
}

// ── 상단 버튼 ───────────────────────────────────────────
const nightModes = [null, 'day', 'night'];
const nightLabel = { null: '🌗 시각대로', day: '☀ 낮', night: '🌙 밤' };
$('#nightBtn').addEventListener('click', () => {
  const i = (nightModes.indexOf(scene.nightOverride) + 1) % nightModes.length;
  scene.nightOverride = nightModes[i];
  $('#nightBtn').textContent = nightLabel[scene.nightOverride];
});
const paintSound = () => { $('#soundBtn').textContent = soundOn ? '🔊 소리' : '🔇 소리'; $('#soundBtn').classList.toggle('on', soundOn); };
$('#soundBtn').addEventListener('click', () => { soundOn = !soundOn; try { localStorage.setItem('farm.sound', soundOn ? '1' : '0'); } catch { /* 무시 */ } paintSound(); if (soundOn) SFX.join(); });
const paintNotify = () => { $('#notifyBtn').textContent = notifyOn ? '🔔 알림 켜짐' : '🔕 알림 꺼짐'; $('#notifyBtn').classList.toggle('on', notifyOn); };
$('#notifyBtn').addEventListener('click', async () => {
  notifyOn = !notifyOn;
  if (notifyOn && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  try { localStorage.setItem('farm.notify', notifyOn ? '1' : '0'); } catch { /* 무시 */ }
  paintNotify();
});
paintSound(); paintNotify();

function tickClock() {
  const d = new Date();
  $('#clock').textContent = hhmmss(d);
  $('#sijin').textContent = SIJIN[Math.floor(((d.getHours() + 1) % 24) / 2)];
  const waiting = visibleSessions().filter((s) => s.status === 'waiting').length;
  const working = visibleSessions().filter((s) => s.status === 'working').length;
  $('#subtitle').textContent = waiting ? `윤허를 청하는 신하가 ${waiting}명 있사옵니다` : working ? `신하 ${working}명이 공무를 보고 있사옵니다` : '조정이 평안하옵니다';
}

// ── 연결 ────────────────────────────────────────────────
function connect() {
  const es = new EventSource('/api/stream');
  const conn = $('#conn');
  es.onopen = () => { conn.textContent = '● 파발 연결'; conn.className = 'chip on'; };
  es.onerror = () => { conn.textContent = '● 파발 끊김 — 재시도'; conn.className = 'chip off'; };
  es.addEventListener('state', (msg) => {
    state = JSON.parse(msg.data);
    scene.sync(visibleSessions());
    react();
    renderChanged();
  });
}

// 판넬은 내용이 바뀐 것만 다시 그린다 (렉 줄이기)
const sigs = {};
function changed(key, val) { const v = typeof val === 'string' ? val : JSON.stringify(val); if (sigs[key] === v) return false; sigs[key] = v; return true; }
function renderChanged() {
  const vis = visibleSessions().map((s) => [s.id, s.name, s.role, s.status, s.location, s.text, s.queued, s.listening, s.subs.length, s.hidden, s.provider, s.canReceiveOrders]);
  if (changed('stats', [state.stats, vis])) renderStats();
  if (changed('feed', state.feed.length ? state.feed[state.feed.length - 1] : 0) || changed('names', vis.map((v) => v[1]))) renderFeed();
  if (changed('convo', [state.convo.length, state.convo[state.convo.length - 1]?.id, [...expanded]])) renderConvo();
  if (changed('media', state.media.length)) renderMedia();
  if (changed('alerts', vis.filter((v) => v[3] === 'waiting'))) renderAlerts();
  if (changed('bars', state.stats?.byCat)) renderBars();
  renderBadges();
  if (changed('side', [selected, vis, state.instructions.length, state.instructions[state.instructions.length - 1]?.status])) renderSide();
}
// "n초 전" 같은 상대 시각은 30초마다만 새로 그린다
setInterval(() => { tickClock(); }, 1000);
setInterval(() => { renderAlerts(); if (!busyTyping()) renderSide(); }, 30_000);

function load(src) { return new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; }); }
async function main() {
  await loadSprites();
  const map = await load(MAP_IMAGE);
  await Promise.all(['12px "Gowun Batang"', 'bold 12px "Gowun Batang"', '15px "Song Myung"'].map((f) => document.fonts.load(f).catch(() => {})));
  const canvas = $('#map');
  scene = new Scene(canvas, { map });
  $('#zIn').addEventListener('click', () => scene.zoomAt(scene.cw / 2, scene.ch / 2, 1.3));
  $('#zOut').addEventListener('click', () => scene.zoomAt(scene.cw / 2, scene.ch / 2, 1 / 1.3));
  $('#zAll').addEventListener('click', () => scene.showAll());
  scene.fit(wrap);
  new ResizeObserver(() => scene.fit(wrap)).observe(wrap);
  bindCanvas(canvas);
  tickClock(); renderSide(true); renderStats(); renderBars();
  const hm = /#media=([\w.-]+)/.exec(location.hash);
  connect();
  if (hm) setTimeout(() => { const m = state.media.find((x) => x.files.some((f) => f.id === hm[1])); if (m) openViewer(m.id, m.files.findIndex((f) => f.id === hm[1])); }, 800);
  let lastDraw = 0;
  const loop = (t) => { if (t - lastDraw >= 33) { lastDraw = t; scene.frame(t); } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
main();
