#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { constants } from 'node:os';
import { assertSupportedPlatform, defaultDataDir, installHooks } from '../lib/install.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const HELP = `Agent Court (에이전트 조정) — your local Claude Code / Codex activity map

Usage:
  agent-court connect claude|codex|both [options]
  agent-court disconnect claude|codex|both [options]
  agent-court start [--data-dir path] [--port N]
  agent-court help

Connect/disconnect options:
  --dry-run             Show changes without writing files
  --claude-home path    Claude config directory (default ~/.claude)
  --codex-home path     Codex config directory (default ~/.codex)
  --data-dir path       Map records (default ~/.agent-court/data)

If the new data directory does not exist, existing ~/.claude-farm/data records are reused.

Connections only record activity. Continue giving instructions in your usual CLI/app.
Existing settings and other hooks are preserved; changed settings are backed up.
After connecting Codex, review/trust the new command hooks in the app's Hooks settings or CLI /hooks.
macOS and Linux are supported; Windows is not supported yet.
`;
const OPTION_NAMES = { '--data-dir': 'dataDir', '--claude-home': 'claudeHome', '--codex-home': 'codexHome', '--port': 'port' };
export function parseArgs(args) {
  const [command = 'help', ...remaining] = args;
  if (command === 'help' || command === '--help' || command === '-h' || remaining.includes('--help') || remaining.includes('-h')) return { command: 'help', options: {} };
  if (!['connect', 'disconnect', 'start'].includes(command)) throw new Error(`Unknown command: ${command}. Use agent-court help.`);
  const options = {}, positional = [];
  for (let i = 0; i < remaining.length; i++) {
    const argument = remaining[i];
    if (argument === '--dry-run') { options.dryRun = true; continue; }
    if (!argument.startsWith('-')) { positional.push(argument); continue; }
    const equals = argument.indexOf('='), flag = equals === -1 ? argument : argument.slice(0, equals);
    const name = OPTION_NAMES[flag];
    if (!name) throw new Error(`Unknown option: ${flag}. Use agent-court help.`);
    const value = equals === -1 ? remaining[++i] : argument.slice(equals + 1);
    if (!value || (equals === -1 && value.startsWith('--'))) throw new Error(`Missing value for ${flag}.`);
    options[name] = value;
  }
  if (command === 'start') {
    if (positional.length || options.claudeHome || options.codexHome || options.dryRun) throw new Error('Use agent-court start [--data-dir path] [--port N].');
    if (options.port !== undefined && (!/^\d+$/.test(options.port) || Number(options.port) < 1 || Number(options.port) > 65535)) throw new Error('Port must be an integer from 1 to 65535.');
  } else {
    if (positional.length !== 1 || !['claude', 'codex', 'both'].includes(positional[0])) throw new Error(`Use agent-court ${command} claude|codex|both [options].`);
    if (options.port !== undefined) throw new Error('--port is only supported by agent-court start.');
  }
  return { command, provider: positional[0], options };
}
export function startServer(options = {}, dependencies = {}) {
  assertSupportedPlatform(dependencies.platform);
  const spawnChild = dependencies.spawn || spawn, signals = dependencies.signals || process;
  const env = dependencies.env || process.env;
  const child = spawnChild(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    cwd: ROOT, stdio: 'inherit', env: { ...env, FARM_DATA_DIR: resolve(options.dataDir || defaultDataDir()),
      FARM_PORT: String(options.port || env.FARM_PORT || 4545), FARM_NO_AGENTS: env.FARM_NO_AGENTS ?? '1' },
  });
  const handlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const handler = () => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); };
    handlers.set(signal, handler); signals.on(signal, handler);
  }
  const clean = () => { for (const [signal, handler] of handlers) signals.removeListener(signal, handler); };
  return new Promise((ok, fail) => {
    child.once('error', (error) => { clean(); fail(error); });
    child.once('exit', (code, signal) => { clean(); ok(code ?? 128 + (constants.signals[signal] || 1)); });
  });
}
export async function main(args = process.argv.slice(2)) {
  const { command, provider, options } = parseArgs(args);
  if (command === 'help') { process.stdout.write(HELP); return 0; }
  if (command === 'start') return startServer(options);
  const results = installHooks(command, provider, options);
  for (const result of results) {
    const prefix = result.dryRun ? '[dry-run] ' : '';
    console.log(`${prefix}${result.provider}: ${result.status} ${result.path}`);
    if (result.backup) console.log(`Backup: ${result.backup}`);
    if (command === 'connect') console.log(`Records: ${result.dataDir}`);
  }
  if (command === 'connect' && results.some((r) => r.provider === 'codex')) console.log('Codex: review/trust the installed command hooks in app Hooks settings or CLI /hooks. This installer does not grant trust.');
  if (command === 'connect') console.log('Observation only: keep using your usual Claude Code / Codex CLI or app for instructions.');
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(`agent-court: ${error.message}`); process.exitCode = 1; });
}
