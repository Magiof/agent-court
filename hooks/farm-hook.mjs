#!/usr/bin/env node
// Claude + Codex 작업 마을 — 훅 이벤트 기록기
// stdin JSON을 받아 최소 정보만 events.jsonl에 한 줄 추가.
// 원칙: 명령 원문·파일 내용·프롬프트 본문·도구 출력은 절대 적지 않는다. 실패해도 세션에 영향 0 (항상 exit 0, stdout 없음).
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

function options(args) {
  const out = { provider: 'claude', explicitProvider: false, observeOnly: false };
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split(/=(.*)/s);
    if (flag === '--observe-only' && inline === undefined) { out.observeOnly = true; continue; }
    if (flag !== '--provider' && flag !== '--data-dir') return null;
    const value = inline ?? args[++i];
    if (flag === '--provider') {
      if (value !== 'claude' && value !== 'codex') return null;
      out.provider = value; out.explicitProvider = true;
    } else {
      if (typeof value !== 'string' || !isAbsolute(value)) return null;
      out.dataDir = value;
    }
  }
  return out;
}
const OPTIONS = options(process.argv.slice(2));
const DATA_DIR = OPTIONS?.dataDir || process.env.FARM_DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const EVENTS = join(DATA_DIR, 'events.jsonl');
const MAX_PAYLOAD_BYTES = 1024 * 1024;

const cut = (s, n = 60) => {
  if (typeof s !== 'string') return undefined;
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
};

const relPath = (p, cwd) => {
  if (typeof p !== 'string' || !p) return undefined;
  if (cwd && isAbsolute(p)) {
    const r = relative(cwd, p);
    if (!r.startsWith('..')) return cut(r, 70);
  }
  return cut(basename(p), 70);
};

// Bash 명령 분류 — 원문은 기록하지 않고 분류 결과만 남긴다
const TEST_RE = /\b(jest|vitest|mocha|pytest|tsc|eslint|lint|playwright|cypress)\b|\bnpm\s+(run\s+)?test\b|\bnpx\s+(jest|tsc)\b/;
const CHECK_RE = /\bgit\s+(diff|status|log|show|blame)\b/;
const READ_RE = /^\s*(cat|head|tail|less|ls|grep|rg|find|sed\s+-n|wc|tree)\b/;

function classifyBash(cmd = '') {
  if (typeof cmd !== 'string') return 'build';
  if (TEST_RE.test(cmd)) return 'test';
  if (CHECK_RE.test(cmd)) return 'check';
  if (READ_RE.test(cmd)) return 'research';
  return 'build';
}

// 첫 실행 토큰만 (환경변수 할당 FOO=bar 는 건너뜀 — 값이 비밀일 수 있음)
function firstToken(cmd = '') {
  for (const t of cmd.trim().split(/\s+/)) {
    if (!t.includes('=')) return cut(t, 20);
  }
  return undefined;
}

const RESEARCH_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'ToolSearch', 'NotebookRead', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'ListAgents']);
const BUILD_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Artifact']);
const INBOX_TOOLS = new Set(['SendMessage', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'Agent', 'Task', 'Workflow']);
const APPROVAL_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
const CHECK_TOOLS = new Set(['Monitor', 'ReportFindings']);
// https://learn.chatgpt.com/docs/hooks documents Bash, apply_patch and spawn_agent/Agent.
// Other local function tools keep their actual names; these sets only choose a map destination.
const CODEX_TOOL_ALIASES = new Map([['exec_command', 'Bash'], ['apply_patch', 'Edit'], ['spawn_agent', 'Agent']]);
const CODEX_RESEARCH_TOOLS = new Set(['web_search', 'read_resource', 'read_mcp_resource', 'list_resources', 'list_mcp_resources', 'list_resource_templates', 'list_mcp_resource_templates', 'list_agents']);
const CODEX_INBOX_TOOLS = new Set(['send_message', 'send_input', 'wait', 'wait_agent', 'wait_agents', 'update_plan', 'close_agent', 'resume_agent', 'interrupt_agent']);
const CODEX_APPROVAL_TOOLS = new Set(['request_user_input', 'request_user_input_async']);

function classifyTool(name, input) {
  if (!name) return undefined;
  if (name === 'Bash') return classifyBash(input?.command);
  if (RESEARCH_TOOLS.has(name)) return 'research';
  if (BUILD_TOOLS.has(name)) return 'build';
  if (INBOX_TOOLS.has(name)) return 'inbox';
  if (APPROVAL_TOOLS.has(name)) return 'approval';
  if (CHECK_TOOLS.has(name)) return 'check';
  if (name === 'Skill') return /review|security/.test(input?.skill || '') ? 'check' : 'research';
  if (name.startsWith('mcp__')) return 'research';
  return 'build';
}

function detailFor(name, input, cwd) {
  if (!name || !input) return undefined;
  switch (name) {
    case 'Read': case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit':
      return relPath(input.file_path || input.notebook_path, cwd);
    case 'Bash':
      return cut(input.description, 50) || firstToken(input.command);
    case 'Agent': case 'Task':
      return cut(input.description, 50);
    case 'SendMessage':
      return input.to ? `→ ${cut(String(input.to), 30)}` : undefined;
    case 'Skill':
      return cut(input.skill, 30);
    case 'WebFetch':
      try { return new URL(input.url).hostname; } catch { return undefined; }
    default:
      if (name.startsWith('mcp__')) return cut(name.replace(/^mcp__/, '').replace(/__/g, ' · '), 50);
      return undefined;
  }
}

function build(h, opts) {
  const ev = h.hook_event_name;
  const codex = opts.provider === 'codex', privateRecord = codex || opts.observeOnly;
  const e = { ts: Date.now(), ev, sid: codex ? `codex-${h.session_id}` : h.session_id, cwd: typeof h.cwd === 'string' && h.cwd.length <= 4096 ? h.cwd : undefined };
  if (codex || opts.explicitProvider) e.provider = opts.provider;
  if (codex) e.rawSid = h.session_id;
  if (privateRecord) e.readOnly = true;
  if (h.agent_id) e.aid = h.agent_id;
  if (h.agent_type) e.atype = cut(h.agent_type, 30);
  if (h.tool_use_id) e.tuid = h.tool_use_id;
  if (h.tool_name) {
    e.tool = codex ? CODEX_TOOL_ALIASES.get(h.tool_name) || h.tool_name : h.tool_name;
    if (e.tool !== h.tool_name) e.rawTool = h.tool_name;
    e.cat = codex && CODEX_RESEARCH_TOOLS.has(h.tool_name) ? 'research' : codex && CODEX_INBOX_TOOLS.has(h.tool_name) ? 'inbox' : codex && CODEX_APPROVAL_TOOLS.has(h.tool_name) ? 'approval' : classifyTool(e.tool, h.tool_input);
    const d = privateRecord ? undefined : detailFor(h.tool_name, h.tool_input, h.cwd);
    if (d) e.detail = d;
    // 세션 간 대화는 대시보드 '회의록'에 보여주려고 본문까지 남긴다 (매니저님 요청, 26-10-01)
    if (!privateRecord && h.tool_name === 'SendMessage' && h.hook_event_name === 'PreToolUse' && h.tool_input) {
      if (typeof h.tool_input.to === 'string') e.to = h.tool_input.to.slice(0, 120);
      if (typeof h.tool_input.message === 'string') e.msg = h.tool_input.message.slice(0, 4000);
      if (typeof h.tool_input.summary === 'string') e.summary = cut(h.tool_input.summary, 80);
    }
    if ((h.tool_name === 'Agent' || h.tool_name === 'Task') && h.tool_input) {
      if (h.tool_input.run_in_background) e.bg = true;
      if (h.tool_input.subagent_type) e.stype = cut(h.tool_input.subagent_type, 30);
    }
  }
  if (ev === 'Notification') {
    e.ntype = privateRecord ? (['permission_prompt', 'idle_prompt', 'auth_success', 'elicitation_dialog'].includes(h.notification_type) ? h.notification_type : undefined) : h.notification_type;
    if (!privateRecord) e.detail = cut(h.message, 70);
  }
  if (ev === 'SessionStart') e.source = privateRecord ? (['startup', 'resume', 'clear', 'compact'].includes(h.source) ? h.source : undefined) : h.source;
  if (ev === 'SessionEnd') e.reason = privateRecord ? (['clear', 'logout', 'prompt_input_exit', 'other'].includes(h.reason) ? h.reason : undefined) : h.reason;
  return e;
}

let raw = '', bytes = 0, oversized = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  bytes += Buffer.byteLength(c, 'utf8');
  if (bytes > MAX_PAYLOAD_BYTES) { oversized = true; raw = ''; }
  if (!oversized) raw += c;
});
process.stdin.on('error', () => {});
process.stdin.on('end', () => {
  try {
    if (!OPTIONS || oversized) return;
    const h = JSON.parse(raw);
    if (!h || Array.isArray(h) || typeof h !== 'object') return;
    if (typeof h.session_id !== 'string' || !h.session_id || h.session_id.length > 256 || typeof h.hook_event_name !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(h.hook_event_name)) return;
    for (const key of ['agent_id', 'agent_type', 'tool_use_id', 'tool_name']) if (h[key] !== undefined && (typeof h[key] !== 'string' || h[key].length > 256)) return;
    if (h.tool_name && !/^[A-Za-z][\w.:-]*$/.test(h.tool_name)) return;
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(EVENTS, JSON.stringify(build(h, OPTIONS)) + '\n');
  } catch {
    // 조용히 무시 — 대시보드 기록 실패가 세션을 방해하면 안 된다
  }
});
