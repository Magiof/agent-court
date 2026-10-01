#!/usr/bin/env node
// Agent Court — 기존 Claude 웹 어명 수신기
// Stop 훅(asyncRewake)으로 실행된다. 세션이 대기에 들어가면 대시보드 서버에 어명이 오는지 기다리고,
// 어명이 오면 stderr로 내용을 내보낸 뒤 exit 2 → Claude Code가 세션을 깨워 그 내용을 전달한다.
// 어명이 없으면 조용히 끝난다(exit 0). 어떤 실패도 세션을 방해하지 않는다.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.FARM_DATA_DIR || join(ROOT, 'data');
const PORT = Number(process.env.FARM_PORT || 4545);
const MAX_MS = Number(process.env.FARM_LISTEN_MAX_MS || 6 * 3600_000 - 60_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function token() {
  try { return readFileSync(join(DATA_DIR, 'token'), 'utf8').trim(); } catch { return ''; }
}

function render(ins) {
  const lines = [
    '[전하의 웹 어명] 매니저님이 Agent Court 대시보드에서 이 세션에 직접 내린 지시이옵니다.',
    '',
    ins.text || '(본문 없음)',
  ];
  if (ins.attachments?.length) {
    lines.push('', `첨부 이미지 ${ins.attachments.length}개 — Read 도구로 열어 확인하시오:`);
    for (const a of ins.attachments) lines.push(`- ${a.path}  (원본 이름: ${a.name})`);
  }
  return lines.join('\n');
}

async function main(sid) {
  const lid = randomUUID();
  const t0 = Date.now();
  let failures = 0;
  while (Date.now() - t0 < MAX_MS) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/listen?sid=${encodeURIComponent(sid)}&lid=${lid}`, {
        headers: { 'x-farm-token': token() },
        signal: AbortSignal.timeout(40_000),
      });
      const j = await res.json();
      failures = 0;
      if (j.type === 'instruction') {
        process.stderr.write(render(j.instruction));
        process.exit(2);
      }
      if (j.type === 'superseded' || j.type === 'disabled') return;
    } catch {
      failures++;
      await sleep(Math.min(30_000, 2_000 * failures));
    }
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', async () => {
  try {
    const h = JSON.parse(raw);
    if (!h.session_id) return;
    await main(h.session_id);
  } catch { /* 무시 */ }
  process.exit(0);
});
