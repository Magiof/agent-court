import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync, symlinkSync, statSync, lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { installHooks, isAgentCourtHandler, createHookCommand, PROVIDER_EVENTS, defaultDataDir, assertSupportedPlatform } from '../lib/install.mjs';
import { parseArgs, startServer, HELP } from '../bin/agent-court.mjs';

const CLI = fileURLToPath(new URL('../bin/agent-court.mjs', import.meta.url));
const fixtures = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agent-court-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, claudeHome: join(root, 'claude'), codexHome: join(root, 'codex'), dataDir: join(root, 'records') };
};
const configPath = (options, provider) => join(options[`${provider}Home`], provider === 'claude' ? 'settings.json' : 'hooks.json');
const read = (options, provider) => JSON.parse(readFileSync(configPath(options, provider), 'utf8'));
const write = (options, provider, document, mode = 0o600) => {
  const path = configPath(options, provider); mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, { mode });
};
const handlers = (document, event) => document.hooks[event].flatMap((g) => g.hooks);

test('connect preserves unrelated settings, matchers, and simultaneous hooks; backs up exact original', (t) => {
  const options = fixtures(t);
  const other = { type: 'command', command: 'echo existing', timeout: 27 };
  const unmarkedFarm = { type: 'command', command: 'node /my/farm-hook.mjs' };
  const original = { model: 'preferred-model', permissions: { allow: ['Read'] }, custom: { nested: [1, 2] }, hooks: {
    PreToolUse: [{ matcher: 'Bash', timeout: 10, hooks: [other, unmarkedFarm] }],
    Stop: [{ matcher: '*', hooks: [{ type: 'prompt', prompt: 'Check completion' }] }],
  } };
  write(options, 'claude', original, 0o640);
  const raw = readFileSync(configPath(options, 'claude'), 'utf8');
  const [result] = installHooks('connect', 'claude', options);
  assert.equal(result.status, 'update');
  assert.match(result.backup, /\.agent-court-backup\./);
  assert.equal(readFileSync(result.backup, 'utf8'), raw);
  assert.equal(statSync(configPath(options, 'claude')).mode & 0o777, 0o640);
  const next = read(options, 'claude');
  assert.equal(next.model, original.model); assert.deepEqual(next.permissions, original.permissions); assert.deepEqual(next.custom, original.custom);
  assert.deepEqual(next.hooks.PreToolUse[0], original.hooks.PreToolUse[0]);
  assert.deepEqual(next.hooks.Stop[0], original.hooks.Stop[0]);
  for (const event of PROVIDER_EVENTS.claude) {
    const owned = handlers(next, event).filter((h) => isAgentCourtHandler(h, 'claude'));
    assert.equal(owned.length, 1, event); assert.equal(owned[0].timeout, 3);
    assert.equal(owned[0].async, event === 'SessionEnd' ? undefined : true);
    assert.match(owned[0].command, /--observe-only/);
    assert.doesNotMatch(owned[0].command, /farm-listen|asyncRewake/);
  }
});

test('both providers use shared app data; Codex end and interrupt are synchronous', (t) => {
  const options = fixtures(t), results = installHooks('connect', 'both', options);
  assert.deepEqual(results.map((r) => r.provider), ['claude', 'codex']);
  const codex = read(options, 'codex');
  assert.deepEqual(Object.keys(codex.hooks), PROVIDER_EVENTS.codex);
  for (const provider of ['claude', 'codex']) for (const event of PROVIDER_EVENTS[provider]) {
    const [hook] = handlers(read(options, provider), event);
    assert.equal(hook.async, ['SessionEnd', 'Interrupt'].includes(event) ? undefined : true);
    assert.ok(hook.command.includes(createHookCommand(provider, options.dataDir)));
  }
  assert.equal(defaultDataDir(options.root), join(options.root, '.agent-court', 'data'));
});

test('repeat connect is idempotent and creates no additional backup', (t) => {
  const options = fixtures(t);
  write(options, 'claude', { hooks: {}, permissions: { deny: ['Delete'] } });
  installHooks('connect', 'claude', options);
  const path = configPath(options, 'claude'), first = readFileSync(path, 'utf8'), files = readdirSync(options.claudeHome);
  const [result] = installHooks('connect', 'claude', options);
  assert.equal(result.status, 'unchanged'); assert.equal(result.backup, null);
  assert.equal(readFileSync(path, 'utf8'), first); assert.deepEqual(readdirSync(options.claudeHome), files);
});

test('legacy recorder markers are replaced once and both marker generations disconnect safely', (t) => {
  const options = fixtures(t), userHook = { type: 'command', command: 'echo keep my hook' };
  for (const provider of ['claude', 'codex']) {
    const command = createHookCommand(provider, options.dataDir);
    const legacy = { type: 'command', command: command.replace(' # agent-court:recorder:v1:', ' # claude-farm:recorder:v1:') };
    const current = { type: 'command', command };
    const hooks = Object.fromEntries(PROVIDER_EVENTS[provider].map((event) => [event, [
      { matcher: '*', hooks: [userHook, legacy, current] },
    ]]));
    hooks.CustomEvent = [{ matcher: 'preserve', hooks: [userHook, legacy] }];
    write(options, provider, { custom: 'preserved', hooks });
  }
  installHooks('connect', 'both', options);
  for (const provider of ['claude', 'codex']) {
    const next = read(options, provider);
    assert.equal(next.custom, 'preserved');
    assert.deepEqual(next.hooks.CustomEvent, [{ matcher: 'preserve', hooks: [userHook] }]);
    for (const event of PROVIDER_EVENTS[provider]) {
      assert.deepEqual(next.hooks[event][0], { matcher: '*', hooks: [userHook] });
      const owned = handlers(next, event).filter((h) => isAgentCourtHandler(h, provider));
      assert.equal(owned.length, 1);
      assert.ok(owned[0].command.endsWith(` # agent-court:recorder:v1:${provider}`));
      assert.ok(owned[0].command.includes(fileURLToPath(new URL('../hooks/farm-hook.mjs', import.meta.url))));
    }
    next.hooks.CustomEvent[0].hooks.push({ type: 'command', command: `echo old # claude-farm:recorder:v1:${provider}` });
    write(options, provider, next);
  }
  installHooks('disconnect', 'both', options);
  for (const provider of ['claude', 'codex']) {
    const next = read(options, provider);
    for (const groups of Object.values(next.hooks)) assert.deepEqual(groups, [{ matcher: groups[0].matcher, hooks: [userHook] }]);
    assert.equal(installHooks('disconnect', provider, options)[0].status, 'unchanged');
  }
});

test('default data uses Agent Court for new installs and reuses legacy records without moving them', (t) => {
  const options = fixtures(t), current = join(options.root, '.agent-court', 'data'), legacy = join(options.root, '.claude-farm', 'data');
  assert.equal(defaultDataDir(options.root), current);
  assert.deepEqual(readdirSync(options.root), []);
  mkdirSync(legacy, { recursive: true });
  const records = join(legacy, 'events.jsonl'); writeFileSync(records, '{"event":"keep"}\n');
  assert.equal(defaultDataDir(options.root), legacy);
  assert.equal(existsSync(current), false); assert.equal(readFileSync(records, 'utf8'), '{"event":"keep"}\n');
  mkdirSync(current, { recursive: true });
  assert.equal(defaultDataDir(options.root), current);
  assert.equal(readFileSync(records, 'utf8'), '{"event":"keep"}\n');
  const otherHome = join(options.root, 'another-home'), invalidLegacy = join(otherHome, '.claude-farm', 'data');
  mkdirSync(resolve(invalidLegacy, '..'), { recursive: true }); writeFileSync(invalidLegacy, 'not a directory');
  assert.equal(defaultDataDir(otherHome), join(otherHome, '.agent-court', 'data'));
});

test('updates replace owned hooks without duplicates; disconnect removes only owned handlers', (t) => {
  const options = fixtures(t), other = { type: 'command', command: 'echo untouched' };
  installHooks('connect', 'claude', options);
  const next = read(options, 'claude');
  next.hooks.Stop[0].matcher = 'preserve-me'; next.hooks.Stop[0].hooks.unshift(other);
  next.hooks.CustomEvent = [{ hooks: [{ type: 'command', command: 'echo custom' }] }];
  write(options, 'claude', next);
  const changed = { ...options, dataDir: join(options.root, 'new records'), hookPath: join(options.root, 'new package', 'farm-hook.mjs') };
  const [updated] = installHooks('connect', 'claude', changed);
  assert.equal(updated.status, 'update');
  const doc = read(options, 'claude');
  assert.deepEqual(doc.hooks.Stop[0], { matcher: 'preserve-me', hooks: [other] });
  assert.equal(handlers(doc, 'Stop').filter((h) => isAgentCourtHandler(h, 'claude')).length, 1);
  assert.ok(handlers(doc, 'Stop').find((h) => isAgentCourtHandler(h, 'claude')).command.includes(createHookCommand('claude', changed.dataDir, changed)));
  const [removed] = installHooks('disconnect', 'claude', options);
  assert.equal(removed.status, 'update'); assert.ok(removed.backup);
  const after = read(options, 'claude');
  assert.deepEqual(after.hooks.Stop, [{ matcher: 'preserve-me', hooks: [other] }]);
  assert.deepEqual(after.hooks.CustomEvent, next.hooks.CustomEvent);
  for (const groups of Object.values(after.hooks)) for (const group of groups) assert.ok(group.hooks.every((h) => !isAgentCourtHandler(h, 'claude')));
  assert.equal(installHooks('disconnect', 'claude', options)[0].status, 'unchanged');
});

test('dry-run never writes directories, settings, or backups', (t) => {
  const options = fixtures(t), before = readdirSync(options.root);
  const result = installHooks('connect', 'both', { ...options, dryRun: true });
  assert.ok(result.every((r) => r.status === 'create' && r.backup === null));
  assert.deepEqual(readdirSync(options.root), before); assert.equal(existsSync(options.dataDir), false);
  write(options, 'codex', { settings: 'keep', hooks: {} });
  const raw = readFileSync(configPath(options, 'codex'), 'utf8'), names = readdirSync(options.codexHome);
  installHooks('connect', 'codex', { ...options, dryRun: true });
  assert.equal(readFileSync(configPath(options, 'codex'), 'utf8'), raw); assert.deepEqual(readdirSync(options.codexHome), names);
});

test('invalid JSON/schema is rejected before either provider is modified', (t) => {
  const options = fixtures(t); write(options, 'claude', { model: 'keep' });
  mkdirSync(options.codexHome); writeFileSync(configPath(options, 'codex'), '{broken');
  const first = readFileSync(configPath(options, 'claude'), 'utf8');
  assert.throws(() => installHooks('connect', 'both', options), /Invalid JSON/);
  assert.equal(readFileSync(configPath(options, 'claude'), 'utf8'), first); assert.deepEqual(readdirSync(options.claudeHome), ['settings.json']);
  write(options, 'codex', { hooks: { Stop: 'not a hook array' } });
  assert.throws(() => installHooks('connect', 'codex', options), /Expected an array/);
});

test('disconnect absent config is a read-only no-op', (t) => {
  const options = fixtures(t);
  assert.ok(installHooks('disconnect', 'both', options).every((r) => r.status === 'unchanged'));
  assert.deepEqual(readdirSync(options.root), []);
});

test('settings symlink is preserved and target is backed up', (t) => {
  const options = fixtures(t), target = join(options.root, 'synced-settings.json');
  writeFileSync(target, '{"theme":"keep"}\n'); mkdirSync(options.claudeHome);
  symlinkSync(target, configPath(options, 'claude'));
  const [result] = installHooks('connect', 'claude', options);
  assert.equal(read(options, 'claude').theme, 'keep');
  assert.equal(lstatSync(configPath(options, 'claude')).isSymbolicLink(), true);
  assert.ok(result.backup.startsWith(realpathSync(target)));
  assert.equal(readFileSync(result.backup, 'utf8'), '{"theme":"keep"}\n');
  installHooks('disconnect', 'claude', options);
  assert.equal(lstatSync(configPath(options, 'claude')).isSymbolicLink(), true);
  assert.equal(readFileSync(configPath(options, 'claude'), 'utf8'), readFileSync(target, 'utf8'));
});

test('absolute executable/hook/data paths are shell-quoted without substitutions', (t) => {
  const options = fixtures(t);
  const odd = join(options.root, "space ' dollar $value `touch injected` $(touch injected)");
  mkdirSync(odd);
  const execPath = join(odd, "node ' executable"), hookPath = join(odd, "hook '$` script.mjs"), dataDir = join(odd, "records ' $HOME `command` $(command)");
  symlinkSync(process.execPath, execPath);
  writeFileSync(hookPath, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
  const command = createHookCommand('codex', dataDir, { execPath, hookPath });
  const output = execFileSync('/bin/sh', ['-c', command], { cwd: options.root, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(output), ['--provider', 'codex', '--data-dir', dataDir, '--observe-only']);
  assert.equal(existsSync(join(options.root, 'injected')), false);
});

test('CLI dry-run works through npm-style symlink and explains Codex trust', (t) => {
  const options = fixtures(t), link = join(options.root, 'agent-court'); symlinkSync(CLI, link);
  const result = spawnSync(process.execPath, [link, 'connect', 'codex', '--dry-run', '--codex-home', options.codexHome, '--data-dir', options.dataDir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /dry-run/); assert.match(result.stdout, /\/hooks/); assert.match(result.stdout, /does not grant trust/);
  assert.equal(existsSync(options.codexHome), false);
  const help = spawnSync(process.execPath, [link, 'help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /Agent Court \(에이전트 조정\)/);
  assert.match(help.stdout, /agent-court connect/); assert.match(help.stdout, /~\/\.agent-court\/data/);
  assert.equal(help.stdout, HELP);
});

test('CLI validates providers/ports/options and explicitly rejects Windows', () => {
  assert.throws(() => parseArgs(['connect', 'unknown']), /claude\|codex\|both/);
  assert.throws(() => parseArgs(['start', '--port', '0']), /Port/);
  assert.throws(() => parseArgs(['start', '--port', '65536']), /Port/);
  assert.throws(() => parseArgs(['connect', 'both', '--port', '4545']), /only supported/);
  assert.throws(() => parseArgs(['connect', 'claude', '--data-dir']), /Missing value/);
  assert.throws(() => parseArgs(['start', '--unsafe']), /Unknown option/);
  assert.throws(() => assertSupportedPlatform('win32'), /Windows is not supported/);
  assert.equal(parseArgs(['start', '--port=5555']).options.port, '5555');
});

test('start shares app data/port, inherits stdio and forwards/removes signal handlers', async () => {
  const signals = new EventEmitter(), child = new EventEmitter();
  child.exitCode = null; child.signalCode = null;
  const killed = []; child.kill = (signal) => killed.push(signal);
  let invocation;
  const finished = startServer({ dataDir: './selected-data', port: '5757' }, {
    env: { KEEP: 'yes' }, signals, platform: 'linux', spawn: (...args) => { invocation = args; return child; },
  });
  assert.equal(invocation[0], process.execPath); assert.equal(invocation[2].stdio, 'inherit');
  assert.equal(invocation[2].env.FARM_DATA_DIR, resolve('./selected-data')); assert.equal(invocation[2].env.FARM_PORT, '5757');
  assert.equal(invocation[2].env.FARM_NO_AGENTS, '1'); assert.equal(invocation[2].env.KEEP, 'yes');
  signals.emit('SIGTERM'); assert.deepEqual(killed, ['SIGTERM']);
  child.emit('exit', null, 'SIGTERM'); assert.equal(await finished, 143);
  assert.equal(signals.listenerCount('SIGTERM'), 0); assert.equal(signals.listenerCount('SIGINT'), 0);
});
