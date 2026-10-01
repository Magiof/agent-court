import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const recorder = fileURLToPath(new URL('../hooks/farm-hook.mjs', import.meta.url));
const SECRET = 'DO_NOT_STORE_SYNTHETIC_SECRET';
const hook = (ev = 'PreToolUse', extra = {}) => ({ session_id: 'shared-session', cwd: '/example/project', hook_event_name: ev, ...extra });
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'farm-hooks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const data = join(dir, 'events');
  const run = (value, args = [], envDir = data) => {
    const result = spawnSync(process.execPath, [recorder, ...args], {
      input: typeof value === 'string' ? value : JSON.stringify(value),
      encoding: 'utf8', env: { ...process.env, FARM_DATA_DIR: envDir }, timeout: 3000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  };
  const events = (path = data) => {
    const file = join(path, 'events.jsonl');
    return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  };
  return { dir, data, run, events };
}
const withoutTs = ({ ts, ...event }) => event;

test('providers isolate identical session ids and preserve legacy Claude event shape', (t) => {
  const f = fixture(t);
  f.run(hook('UserPromptSubmit', { prompt: SECRET }));
  f.run(hook('UserPromptSubmit', { prompt: SECRET }), ['--provider', 'codex']);
  const [claude, codex] = f.events();
  assert.deepEqual(withoutTs(claude), { ev: 'UserPromptSubmit', sid: 'shared-session', cwd: '/example/project' });
  assert.deepEqual(withoutTs(codex), { ev: 'UserPromptSubmit', sid: 'codex-shared-session', cwd: '/example/project', provider: 'codex', rawSid: 'shared-session', readOnly: true });
  assert.notEqual(claude.sid, codex.sid);
});

test('absolute data-dir overrides the environment and supports paths with spaces', (t) => {
  const f = fixture(t), destination = join(f.dir, 'chosen data');
  f.run(hook('SessionStart', { source: 'startup' }), ['--provider=codex', `--data-dir=${destination}`]);
  assert.equal(f.events(destination).length, 1);
  assert.equal(f.events().length, 0);
});

test('legacy Claude manager messages and command classifications remain unchanged', (t) => {
  const f = fixture(t);
  f.run(hook('PreToolUse', { tool_name: 'SendMessage', tool_input: { to: 'minister', message: 'Authorized manager message', summary: '  A   summary  ' }, tool_use_id: 'call-1' }));
  assert.deepEqual(withoutTs(f.events()[0]), { ev: 'PreToolUse', sid: 'shared-session', cwd: '/example/project', tuid: 'call-1', tool: 'SendMessage', cat: 'inbox', detail: '→ minister', to: 'minister', msg: 'Authorized manager message', summary: 'A summary' });
  f.run(hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: `API_KEY=${SECRET} npm test` } }));
  f.run(hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: '/example/project/src/main.js', old_string: SECRET, new_string: SECRET } }));
  assert.equal(f.events()[1].detail, 'npm');
  assert.equal(f.events()[1].cat, 'test');
  assert.equal(f.events()[2].detail, 'src/main.js');
  assert.equal(f.events()[2].cat, 'build');
  assert.ok(!JSON.stringify(f.events()).includes(SECRET));
});

test('Codex stores no prompts, commands, patches, outputs, assistant replies or message bodies', (t) => {
  const f = fixture(t), args = ['--provider', 'codex'];
  const common = { prompt: SECRET, last_assistant_message: SECRET, tool_response: { output: SECRET } };
  for (const value of [
    hook('PreToolUse', { ...common, tool_name: 'Bash', tool_input: { command: `API_KEY=${SECRET} npm test`, description: SECRET } }),
    hook('PostToolUse', { ...common, tool_name: 'Bash', tool_input: { command: `echo ${SECRET}` } }),
    hook('PreToolUse', { ...common, tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Add File: secret.txt\n+${SECRET}\n*** End Patch` } }),
    hook('UserPromptSubmit', common), hook('Stop', common),
    hook('SubagentStop', { ...common, agent_id: 'child-1', agent_type: 'explorer' }),
    hook('PreToolUse', { ...common, tool_name: 'send_message', tool_input: { to: 'child-1', message: SECRET, summary: SECRET } }),
    hook('PreToolUse', { ...common, tool_name: 'SendMessage', tool_input: { to: 'child-1', message: SECRET, summary: SECRET } }),
    hook('Notification', { message: SECRET, notification_type: 'permission_prompt' }),
  ]) f.run(value, args);
  const events = f.events();
  assert.equal(events.length, 9);
  assert.ok(!JSON.stringify(events).includes(SECRET));
  for (const e of events) for (const field of ['prompt', 'command', 'tool_input', 'tool_response', 'last_assistant_message', 'msg', 'summary', 'detail', 'to']) assert.ok(!(field in e), field);
  assert.deepEqual([events[2].tool, events[2].rawTool, events[2].cat], ['Edit', 'apply_patch', 'build']);
  assert.equal(events[0].cat, 'test');
  assert.ok(events.every((e) => e.readOnly === true));
});

test('Codex canonical tools and local-function categories avoid invented aliases', (t) => {
  const f = fixture(t);
  const cases = [
    ['Bash', { command: 'npm run test' }, 'Bash', 'test'],
    ['Bash', { command: 'git diff --stat' }, 'Bash', 'check'],
    ['Bash', { command: 'rg pattern src' }, 'Bash', 'research'],
    ['exec_command', { command: 'npm run build' }, 'Bash', 'build'],
    ['apply_patch', { command: SECRET }, 'Edit', 'build'],
    ['spawn_agent', { prompt: SECRET }, 'Agent', 'inbox'],
    ['update_plan', { plan: SECRET }, 'update_plan', 'inbox'],
    ['send_message', { message: SECRET }, 'send_message', 'inbox'],
    ['wait_agent', {}, 'wait_agent', 'inbox'],
    ['read_resource', {}, 'read_resource', 'research'],
    ['list_resources', {}, 'list_resources', 'research'],
    ['web_search', { query: SECRET }, 'web_search', 'research'],
    ['request_user_input', { questions: SECRET }, 'request_user_input', 'approval'],
    ['mcp__example__read', { secret: SECRET }, 'mcp__example__read', 'research'],
    ['unknown_local_function', { command: SECRET }, 'unknown_local_function', 'build'],
    ['constructor', {}, 'constructor', 'build'],
  ];
  for (const [tool_name, tool_input] of cases) f.run(hook('PreToolUse', { tool_name, tool_input }), ['--provider', 'codex']);
  for (const [i, [name, , expectedTool, cat]] of cases.entries()) {
    const e = f.events()[i];
    assert.equal(e.tool, expectedTool); assert.equal(e.cat, cat);
    assert.equal(e.rawTool, name === expectedTool ? undefined : name);
  }
  assert.ok(!JSON.stringify(f.events()).includes(SECRET));
});

test('subagents retain their parent session identity and lifecycle events stay advisory', (t) => {
  const f = fixture(t);
  for (const ev of ['SubagentStart', 'SubagentStop']) f.run(hook(ev, { agent_id: 'child-1', agent_type: 'explorer', last_assistant_message: SECRET }), ['--provider', 'codex']);
  for (const ev of ['Interrupt', 'PostCompact', 'Stop']) f.run(hook(ev, { last_assistant_message: SECRET }), ['--provider', 'codex']);
  f.run(hook('SessionEnd', { reason: 'other' }), ['--provider', 'codex']);
  const events = f.events();
  assert.ok(events.every((e) => e.sid === 'codex-shared-session' && e.rawSid === 'shared-session'));
  assert.deepEqual(events.slice(0, 2).map((e) => [e.ev, e.aid, e.atype]), [['SubagentStart', 'child-1', 'explorer'], ['SubagentStop', 'child-1', 'explorer']]);
  assert.deepEqual(events.slice(2).map((e) => e.ev), ['Interrupt', 'PostCompact', 'Stop', 'SessionEnd']);
  assert.equal(events.at(-1).reason, 'other');
  assert.ok(!JSON.stringify(events).includes(SECRET));
});

test('new observe-only Claude sessions omit bodies while retaining their original ids', (t) => {
  const f = fixture(t);
  f.run(hook('PreToolUse', { tool_name: 'SendMessage', tool_input: { to: 'minister', message: SECRET, summary: SECRET } }), ['--provider', 'claude', '--observe-only']);
  f.run(hook('Notification', { message: SECRET, notification_type: 'idle_prompt' }), ['--provider', 'claude', '--observe-only']);
  f.run(hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: `echo ${SECRET}`, description: SECRET } }), ['--provider', 'claude', '--observe-only']);
  const events = f.events();
  assert.ok(events.every((e) => e.sid === 'shared-session' && e.provider === 'claude' && e.readOnly === true));
  assert.ok(!JSON.stringify(events).includes(SECRET));
  assert.ok(events.every((e) => !('detail' in e) && !('msg' in e)));
  assert.equal(events[1].ntype, 'idle_prompt');
});

test('malformed, oversized and invalid option inputs quietly exit zero without writes', (t) => {
  const f = fixture(t);
  for (const value of ['', '{', 'null', '[]', '123', '{}', hook('Stop', { session_id: 123 }), hook('Stop', { hook_event_name: 'malformed event' }), hook('PreToolUse', { tool_name: { secret: SECRET } }), hook('PreToolUse', { tool_name: 'not a tool name' }), JSON.stringify(hook('Stop', { output: 'x'.repeat(1024 * 1024) }))]) f.run(value, ['--provider', 'codex']);
  for (const args of [['--provider'], ['--provider', 'unknown'], ['--data-dir', 'relative/path'], ['--data-dir'], ['--observe-only=true'], ['--unknown']]) f.run(hook('Stop'), args);
  assert.equal(f.events().length, 0);
  const blocked = join(f.dir, 'not a directory'); writeFileSync(blocked, 'file');
  f.run(hook('Stop'), ['--provider', 'codex', '--data-dir', blocked]);
  assert.equal(f.events().length, 0);
});
