// 데모 모드: 실제 세션 없이 가짜 이벤트로 마을을 움직여 본다. (data-demo/ 에만 기록, 실데이터와 분리)
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'data-demo');
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
process.env.FARM_DATA_DIR = DIR;
process.env.FARM_PORT ||= '4546';

const S = [
  { sid: 'demo-boss-0001', cwd: '/demo/poppop-be', name: '보스', role: 'boss' },
  { sid: 'demo-mem1-0002', cwd: '/demo/poppop-be', name: '팀원1', role: 'member' },
  { sid: 'demo-mem2-0003', cwd: '/demo/poppop-fe', name: '팀원2', role: 'member' },
];
writeFileSync(join(DIR, 'meta.json'), JSON.stringify({ sessions: Object.fromEntries(S.map((s) => [s.sid, { name: s.name, role: s.role }])) }));

const FILE = join(DIR, 'events.jsonl');
const emit = (s, e) => appendFileSync(FILE, JSON.stringify({ ts: Date.now(), sid: s.sid, cwd: s.cwd, ...e }) + '\n');

for (const s of S) emit(s, { ev: 'SessionStart', source: 'startup' });

await import('../server.mjs');

// 시작 3초 뒤 보스가 결재를 요청하는 장면 (알림 확인용)
setTimeout(() => {
  emit(S[0], { ev: 'PreToolUse', tool: 'Bash', cat: 'build', detail: '커밋 생성' });
  emit(S[0], { ev: 'PermissionRequest', tool: 'Bash', cat: 'build', detail: '커밋 생성' });
  busy.set(S[0].sid, true);
  setTimeout(() => { emit(S[0], { ev: 'PostToolUse', tool: 'Bash', cat: 'build' }); busy.set(S[0].sid, false); }, 15000);
}, 3000);

const ACTIONS = [
  { tool: 'Read', cat: 'research', detail: 'apps/bo/src/context/shopping/orders/orders.service.ts' },
  { tool: 'Grep', cat: 'research' },
  { tool: 'Edit', cat: 'build', detail: 'apps/bo/src/context/shopping/claims/claims.service.ts' },
  { tool: 'Write', cat: 'build', detail: 'apps/fo/src/context/catalog/search/dto/query.dto.ts' },
  { tool: 'Bash', cat: 'test', detail: 'claims 단위테스트 실행' },
  { tool: 'Bash', cat: 'test', detail: '타입체크' },
  { tool: 'Bash', cat: 'check', detail: '변경 파일 확인' },
  { tool: 'SendMessage', cat: 'inbox', detail: '→ 팀원1' },
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const busy = new Map();

setInterval(() => {
  const s = pick(S);
  if (busy.get(s.sid)) return;
  const r = Math.random();
  if (r < 0.08) {
    emit(s, { ev: 'PreToolUse', tool: 'Bash', cat: 'build', detail: '커밋 생성' });
    emit(s, { ev: 'PermissionRequest', tool: 'Bash', cat: 'build', detail: '커밋 생성' });
    busy.set(s.sid, true);
    setTimeout(() => { emit(s, { ev: 'PostToolUse', tool: 'Bash', cat: 'build' }); busy.set(s.sid, false); }, 6000);
  } else if (r < 0.14) {
    emit(s, { ev: 'UserPromptSubmit' });
  } else if (r < 0.2) {
    emit(s, { ev: 'Stop' });
  } else if (r < 0.25) {
    const aid = `sub-${Date.now()}`;
    emit(s, { ev: 'PreToolUse', tool: 'Agent', cat: 'inbox', detail: 'PPT 슬라이드 대조', stype: 'Explore' });
    emit(s, { ev: 'SubagentStart', aid, atype: 'Explore' });
    let n = 0;
    const t = setInterval(() => {
      const a = pick(ACTIONS.slice(0, 2));
      emit(s, { ev: 'PreToolUse', aid, ...a });
      if (++n > 5) { clearInterval(t); emit(s, { ev: 'SubagentStop', aid }); }
    }, 1500);
  } else {
    emit(s, { ev: 'PreToolUse', ...pick(ACTIONS) });
  }
}, 900);
