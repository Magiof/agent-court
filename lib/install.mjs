import {
  readFileSync, writeFileSync, mkdirSync, copyFileSync, renameSync, unlinkSync,
  statSync, lstatSync, realpathSync, chmodSync, existsSync, constants,
} from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MARKER = 'agent-court:recorder:v1';
const OWNED_MARKERS = [MARKER, 'claude-farm:recorder:v1'];
export const PROVIDER_EVENTS = {
  claude: ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification', 'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact'],
  codex: ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact', 'Interrupt'],
};

export function defaultDataDir(home = homedir()) {
  const current = join(home, '.agent-court', 'data'), legacy = join(home, '.claude-farm', 'data');
  if (!existsSync(current) && existsSync(legacy) && statSync(legacy).isDirectory()) return legacy;
  return current;
}
export const shellQuote = (value) => `'${String(value).replaceAll("'", "'\"'\"'")}'`;
export function assertSupportedPlatform(platform = process.platform) {
  if (platform !== 'darwin' && platform !== 'linux') throw new Error('This installer supports macOS and Linux. Windows is not supported yet.');
}
function providersFor(provider) {
  if (provider === 'both') return ['claude', 'codex'];
  if (Object.hasOwn(PROVIDER_EVENTS, provider)) return [provider];
  throw new Error('Choose claude, codex, or both.');
}
export function createHookCommand(provider, dataDir, options = {}) {
  providersFor(provider);
  if (provider === 'both') throw new Error('A hook command needs one provider.');
  const args = [resolve(options.execPath || process.execPath), resolve(options.hookPath || join(ROOT, 'hooks', 'farm-hook.mjs')),
    '--provider', provider, '--data-dir', resolve(dataDir), '--observe-only'];
  return `${args.map(shellQuote).join(' ')} # ${MARKER}:${provider}`;
}
export function isAgentCourtHandler(handler, provider) {
  return handler?.type === 'command' && typeof handler.command === 'string'
    && OWNED_MARKERS.some((marker) => handler.command.endsWith(` # ${marker}:${provider}`));
}
function readConfig(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { if (lstatSync(path).isSymbolicLink()) throw new Error(`Broken settings symlink: ${path}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { raw: null, document: {}, writePath: path, mode: 0o600 };
  }
  let document;
  try { document = JSON.parse(raw); }
  catch { throw new Error(`Invalid JSON in ${path}; nothing was changed.`); }
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error(`Expected a JSON object in ${path}.`);
  if (document.hooks !== undefined && (!document.hooks || typeof document.hooks !== 'object' || Array.isArray(document.hooks))) {
    throw new Error(`Expected a hooks object in ${path}.`);
  }
  return { raw, document, writePath: realpathSync(path), mode: statSync(path).mode & 0o777 };
}
function withoutOwnedHooks(groups, provider, path, event) {
  if (!Array.isArray(groups)) throw new Error(`Expected an array at hooks.${event} in ${path}.`);
  const result = [];
  for (const group of groups) {
    if (!group || typeof group !== 'object' || !Array.isArray(group.hooks)) throw new Error(`Expected hook groups at hooks.${event} in ${path}.`);
    const hooks = group.hooks.filter((handler) => !isAgentCourtHandler(handler, provider));
    if (hooks.length) result.push(hooks.length === group.hooks.length ? group : { ...group, hooks });
    else if (!group.hooks.length) result.push(group);
  }
  return result;
}
function prepare(action, provider, options) {
  const home = resolve(provider === 'claude'
    ? options.claudeHome || process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
    : options.codexHome || process.env.CODEX_HOME || join(homedir(), '.codex'));
  const path = join(home, provider === 'claude' ? 'settings.json' : 'hooks.json');
  const original = readConfig(path), document = structuredClone(original.document);
  const dataDir = resolve(options.dataDir || defaultDataDir());
  const command = action === 'connect' ? createHookCommand(provider, dataDir, options) : null;
  if (document.hooks) for (const [event, groups] of Object.entries(document.hooks)) {
    const next = withoutOwnedHooks(groups, provider, path, event);
    if (next.length) document.hooks[event] = next;
    else if (groups.length) delete document.hooks[event];
  }
  if (action === 'connect') {
    document.hooks ||= {};
    for (const event of PROVIDER_EVENTS[provider]) {
      const handler = { type: 'command', command, timeout: 3 };
      if (event !== 'SessionEnd' && event !== 'Interrupt') handler.async = true;
      (document.hooks[event] ||= []).push({ hooks: [handler] });
    }
  }
  return {
    provider, path, dataDir, events: PROVIDER_EVENTS[provider], command,
    status: JSON.stringify(original.document) === JSON.stringify(document) ? 'unchanged' : original.raw === null ? 'create' : 'update',
    ...original, nextRaw: `${JSON.stringify(document, null, 2)}\n`,
  };
}
function unchangedSinceRead(plan) {
  try { return readFileSync(plan.path, 'utf8') === plan.raw; }
  catch (error) { if (error.code === 'ENOENT') return plan.raw === null; throw error; }
}
function writePlan(plan) {
  if (plan.status === 'unchanged') return null;
  if (!unchangedSinceRead(plan)) throw new Error(`Settings changed during installation: ${plan.path}. Run the command again.`);
  mkdirSync(dirname(plan.writePath), { recursive: true, mode: 0o700 });
  let backup = null;
  if (plan.raw !== null) {
    backup = `${plan.writePath}.agent-court-backup.${new Date().toISOString().replaceAll(':', '-')}.${randomUUID()}`;
    copyFileSync(plan.writePath, backup, constants.COPYFILE_EXCL);
    chmodSync(backup, plan.mode);
  }
  const temporary = `${plan.writePath}.agent-court-tmp.${randomUUID()}`;
  try {
    writeFileSync(temporary, plan.nextRaw, { flag: 'wx', mode: plan.mode });
    if (!unchangedSinceRead(plan)) throw new Error(`Settings changed during installation: ${plan.path}. Run the command again.`);
    renameSync(temporary, plan.writePath);
  } finally {
    try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return backup;
}

// 모든 대상 설정을 먼저 읽고 검증한다. dry-run은 디렉터리·백업도 만들지 않는다.
export function installHooks(action, provider, options = {}) {
  assertSupportedPlatform(options.platform);
  if (action !== 'connect' && action !== 'disconnect') throw new Error('Choose connect or disconnect.');
  const plans = providersFor(provider).map((name) => prepare(action, name, options));
  const results = [];
  for (const plan of plans) {
    const backup = options.dryRun ? null : writePlan(plan);
    results.push({ provider: plan.provider, path: plan.path, dataDir: plan.dataDir, events: plan.events, command: plan.command, status: plan.status, backup, dryRun: !!options.dryRun });
  }
  return results;
}
