#!/usr/bin/env node
// Claude 작업 마을 — 매니저님께 이미지·PDF·문서를 대시보드로 보여드리기
// 사용: 프로젝트 폴더에서 node bin/farm-show.mjs <파일...> [--title "제목"] [--note "한 줄 설명"]
import { copyFileSync, statSync, mkdirSync, appendFileSync } from 'node:fs';
import { basename, extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.FARM_DATA_DIR || join(ROOT, 'data');
const MEDIA = join(DATA_DIR, 'media');
const PORT = Number(process.env.FARM_PORT || 4545);
const MAX = 50 * 1024 * 1024;
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.md': 'text/markdown', '.txt': 'text/plain', '.csv': 'text/csv', '.html': 'text/html',
};

const args = process.argv.slice(2);
let title = '', note = '';
const paths = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--title') title = args[++i] || '';
  else if (args[i] === '--note') note = args[++i] || '';
  else paths.push(args[i]);
}
if (!paths.length) {
  console.error('사용법: farm-show.mjs <파일...> [--title "제목"] [--note "설명"]  (png/jpg/gif/webp/svg/pdf/md/txt/csv/html)');
  process.exit(1);
}

mkdirSync(MEDIA, { recursive: true });
const files = [];
for (const p of paths) {
  const abs = resolve(p);
  const ext = extname(abs).toLowerCase();
  if (!MIME[ext]) { console.error(`지원하지 않는 형식이옵니다: ${p}`); process.exit(1); }
  const st = statSync(abs);
  if (st.size > MAX) { console.error(`50MB를 넘사옵니다: ${p}`); process.exit(1); }
  const id = randomUUID().replace(/-/g, '');
  copyFileSync(abs, join(MEDIA, id + ext));
  files.push({ id: id + ext, name: basename(abs), mime: MIME[ext], size: st.size });
}

const sid = process.env.CLAUDE_CODE_SESSION_ID || 'unknown';
const ev = { ts: Date.now(), ev: 'Show', sid, cwd: process.cwd(), title: title.slice(0, 80) || files[0].name, note: note.slice(0, 300), files };
appendFileSync(join(DATA_DIR, 'events.jsonl'), JSON.stringify(ev) + '\n');
console.log(`대시보드에 올렸사옵니다 (${files.length}개): http://localhost:${PORT}/#media=${files[0].id}`);
