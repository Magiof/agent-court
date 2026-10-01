// 배포본을 임시 전역 설치하고 실제 설치 명령·생성 훅·서버를 함께 확인한다.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const archive = resolve(process.argv[2] || join(ROOT, 'output/release/agent-court-0.2.0.tgz'));
const dir = mkdtempSync(join(tmpdir(), 'farm-package-'));
let server;
const run = (command, args, options = {}) => {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000, ...options });
  assert.equal(r.status, 0, `${command} failed: ${r.stderr || r.error || r.stdout}`);
  return r.stdout;
};
try {
  const files = run('tar', ['-tzf', archive]).trim().split('\n');
  assert.equal(files.some(f => /(^|\/)(data|data-demo|\.secrets|output|vendor)(\/|$)/.test(f)), false);
  assert.equal(files.some(f => /(^|\/)(token|events\.jsonl|instructions\.json|auth\.json|settings\.json)$/.test(f)), false);
  const prefix = join(dir, 'global');
  run('npm', ['install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', archive]);
  const cli = join(prefix, 'bin', 'agent-court');
  assert.match(run(cli, ['help']), /agent-court connect/);
  const claudeHome = join(dir, 'claude settings'), codexHome = join(dir, 'codex settings'), dataDir = join(dir, 'records');
  mkdirSync(claudeHome); mkdirSync(codexHome);
  writeFileSync(join(claudeHome, 'settings.json'), JSON.stringify({ permissions: { allow: ['Read'] }, model: 'keep-existing' }));
  const args = ['both', '--claude-home', claudeHome, '--codex-home', codexHome, '--data-dir', dataDir];
  run(cli, ['connect', ...args]);
  const config = {
    claude: JSON.parse(readFileSync(join(claudeHome, 'settings.json'), 'utf8')),
    codex: JSON.parse(readFileSync(join(codexHome, 'hooks.json'), 'utf8')),
  };
  assert.deepEqual(config.claude.permissions, { allow: ['Read'] });
  assert.equal(config.claude.model, 'keep-existing');
  for (const provider of ['claude', 'codex']) assert.equal(Object.keys(config[provider].hooks).length, 12);
  const sid = '11111111-2222-3333-4444-555555555555';
  const emit = (provider, hook_event_name, more = {}) => {
    const command = config[provider].hooks[hook_event_name][0].hooks[0].command;
    run('/bin/sh', ['-c', command], { input: JSON.stringify({ session_id: sid, cwd: `/demo/${provider}-project`, hook_event_name, ...more }) });
  };
  emit('claude', 'SessionStart', { source: 'startup' }); emit('claude', 'UserPromptSubmit', { prompt: 'DO_NOT_RECORD_PROMPT' });
  emit('codex', 'SessionStart', { source: 'startup' });
  emit('codex', 'PreToolUse', { tool_name: 'apply_patch', tool_use_id: 'patch1', tool_input: { command: 'DO_NOT_RECORD_PATCH' } });
  const log = readFileSync(join(dataDir, 'events.jsonl'), 'utf8');
  assert.equal(log.includes('DO_NOT_RECORD'), false);
  const portServer = createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening');
  const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));
  server = spawn(cli, ['start', '--data-dir', dataDir, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = '';
  server.stderr.on('data', b => { diagnostics += b; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`package server timeout: ${diagnostics}`)), 5000);
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`package server exited ${code}: ${diagnostics}`)); });
    server.stdout.on('data', b => { if (String(b).includes(`localhost:${port}`)) { clearTimeout(timer); resolve(); } });
  });
  const base = `http://127.0.0.1:${port}`;
  let state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.sessions.length, 2);
  assert.deepEqual(state.sessions.map(s => s.provider).sort(), ['claude', 'codex']);
  assert.equal(state.sessions.every(s => s.canReceiveOrders === false), true);
  assert.equal(state.sessions.find(s => s.provider === 'codex').counts.edits, 1);
  const index = await (await fetch(`${base}/assets/sprites/index.json`)).json();
  for (const entry of Object.values(index)) assert.equal((await fetch(`${base}/assets/sprites/${entry.file}`)).status, 200);
  assert.equal((await fetch(`${base}/assets/joseon/v2/map-concept-v1.png`)).status, 200);
  assert.match(await (await fetch(base)).text(), /Agent Court/);
  // 서버를 켜 둔 상태의 새 훅이 실제 tail에 반영되는지 확인한다.
  emit('codex', 'Stop', { last_assistant_message: 'DO_NOT_RECORD_REPLY' });
  for (let n = 0; n < 30; n++) {
    state = await (await fetch(`${base}/api/state`)).json();
    if (state.sessions.find(s => s.provider === 'codex').status === 'idle') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(state.sessions.find(s => s.provider === 'codex').status, 'idle');
  run(cli, ['disconnect', ...args]);
  assert.deepEqual(JSON.parse(readFileSync(join(claudeHome, 'settings.json'), 'utf8')).permissions, { allow: ['Read'] });
  assert.equal(Object.keys(JSON.parse(readFileSync(join(codexHome, 'hooks.json'), 'utf8')).hooks).length, 0);
  assert.equal(readFileSync(join(dataDir, 'events.jsonl'), 'utf8').includes('DO_NOT_RECORD'), false);
  const report = { at: new Date().toISOString(), archive, sha256: createHash('sha256').update(readFileSync(archive)).digest('hex'),
    packageFiles: files.length, privateDataIncluded: false, globalSymlinkCli: 'passed', preservedExistingSettings: 'passed',
    generatedHookCommands: { claude: 'passed', codex: 'passed' }, providers: 2, spriteAssets: Object.keys(index).length,
    runningServerTail: 'passed', disconnect: 'passed', actualProviderModelRuns: false };
  const reportPath = join(ROOT, 'output/qa/personal-package-validation-20261001.json');
  mkdirSync(dirname(reportPath), { recursive: true }); writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); }
  rmSync(dir, { recursive: true, force: true });
}
