import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('personal providers survive Claude roster polling and cannot queue unsupported orders', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'farm-providers-'));
  const rawSid = '11111111-2222-3333-4444-555555555555';
  const codexSid = `codex-${rawSid}`;
  const ts = Date.now() - 180_000;
  const events = [
    { ts, sid: rawSid, cwd: '/demo/claude-project', provider: 'claude', readOnly: true, ev: 'SessionStart' },
    { ts, sid: codexSid, rawSid, cwd: '/demo/codex-project', provider: 'codex', readOnly: true, ev: 'SessionStart' },
    { ts, sid: codexSid, provider: 'codex', ev: 'PreToolUse', tool: 'Edit', cat: 'build' },
    { ts, sid: 'legacy-claude-session', cwd: '/demo/legacy', ev: 'SessionStart' },
  ];
  writeFileSync(join(dir, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
  const claude = join(dir, 'empty-claude');
  writeFileSync(claude, '#!/bin/sh\nprintf "[]"\n');
  chmodSync(claude, 0o700);
  const env = { ...process.env, FARM_DATA_DIR: dir, FARM_PORT: '0', CLAUDE_BIN: claude };
  delete env.FARM_NO_AGENTS;
  const server = spawn(process.execPath, [join(ROOT, 'server.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = '';
  server.stderr.on('data', c => { diagnostics += c; });
  try {
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`server timeout: ${diagnostics}`)), 5000);
      server.on('exit', code => { clearTimeout(timeout); reject(new Error(`server exited ${code}: ${diagnostics}`)); });
      server.stdout.on('data', c => {
        const m = /localhost:(\d+)/.exec(String(c));
        if (m) { clearTimeout(timeout); resolve(Number(m[1])); }
      });
    });
    const base = `http://127.0.0.1:${port}`;
    let state;
    for (let n = 0; n < 30; n++) {
      state = await (await fetch(`${base}/api/state`)).json();
      if (!state.sessions.some(s => s.id === 'legacy-claude-session')) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(state.sessions.length, 2, 'roster cleanup must retain hook-only personal sessions');
    const claudeState = state.sessions.find(s => s.id === rawSid);
    const codexState = state.sessions.find(s => s.id === codexSid);
    assert.equal(claudeState.provider, 'claude');
    assert.equal(codexState.provider, 'codex');
    assert.equal(codexState.name, 'codex-project·1111');
    assert.equal(codexState.counts.edits, 1);
    for (const s of [claudeState, codexState]) {
      assert.equal(s.canReceiveOrders, false);
      const response = await fetch(`${base}/api/sessions/${s.id}/instructions`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-farm': '1' }, body: JSON.stringify({ text: 'should not queue' }),
      });
      assert.equal(response.status, 409);
    }
    assert.deepEqual((await (await fetch(`${base}/api/state`)).json()).instructions, []);
    assert.match(await (await fetch(base)).text(), /Agent Court/);
    assert.equal(readFileSync(join(dir, 'events.jsonl'), 'utf8').includes('should not queue'), false);
  } finally {
    if (server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); }
    rmSync(dir, { recursive: true, force: true });
  }
});
