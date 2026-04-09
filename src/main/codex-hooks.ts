import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { STATUS_DIR } from './hook-status';
import { statusCmd as mkStatusCmd, captureSessionIdCmd as mkCaptureSessionIdCmd, installEventScript, wrapPythonHookCmd, installHookScripts, VIBEYARD_HOOK_MARKER } from './hook-commands';
import { readFileSafe, readJsonSafe } from './fs-utils';
import type { InspectorEventType, SettingsValidationResult } from '../shared/types';

export const CODEX_HOOK_MARKER = VIBEYARD_HOOK_MARKER;

const CODEX_DIR = path.join(homedir(), '.codex');
const HOOKS_JSON_PATH = path.join(CODEX_DIR, 'hooks.json');
const CONFIG_TOML_PATH = path.join(CODEX_DIR, 'config.toml');

export const SESSION_ID_VAR = 'VIBEYARD_SESSION_ID';

const EXPECTED_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop'];

interface HookHandler {
  type: string;
  command: string;
}

interface HookMatcherEntry {
  matcher?: string;
  hooks: HookHandler[];
}

type HooksConfig = Record<string, HookMatcherEntry[]>;

function isIdeHook(h: HookHandler): boolean {
  return h.command?.includes(CODEX_HOOK_MARKER) ?? false;
}

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

function isCodexHooksFeatureEnabled(): boolean {
  const content = readFileSafe(CONFIG_TOML_PATH);
  if (!content) return false;

  let inFeatures = false;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (/^\[.+\]$/.test(trimmed)) {
      inFeatures = trimmed === '[features]';
      continue;
    }
    if (inFeatures && /^codex_hooks\s*=\s*true/.test(trimmed)) {
      return true;
    }
  }
  return false;
}

function ensureCodexHooksFeatureFlag(): void {
  fs.mkdirSync(CODEX_DIR, { recursive: true });

  const content = readFileSafe(CONFIG_TOML_PATH);
  if (!content) {
    fs.writeFileSync(CONFIG_TOML_PATH, '[features]\ncodex_hooks = true\n');
    return;
  }

  if (isCodexHooksFeatureEnabled()) return;

  const lines = content.split('\n');
  let featuresSectionIdx = -1;
  let codexHooksLineIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '[features]') {
      featuresSectionIdx = i;
      continue;
    }
    if (featuresSectionIdx !== -1 && /^\[.+\]$/.test(trimmed)) {
      break; // entered next section
    }
    if (featuresSectionIdx !== -1 && /^codex_hooks\s*=/.test(trimmed)) {
      codexHooksLineIdx = i;
      break;
    }
  }

  if (codexHooksLineIdx !== -1) {
    lines[codexHooksLineIdx] = 'codex_hooks = true';
  } else if (featuresSectionIdx !== -1) {
    lines.splice(featuresSectionIdx + 1, 0, 'codex_hooks = true');
  } else {
    const trailing = content.endsWith('\n') ? '' : '\n';
    lines.push(`${trailing}[features]`, 'codex_hooks = true');
  }

  fs.writeFileSync(CONFIG_TOML_PATH, lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Hook installation
// ---------------------------------------------------------------------------

function cleanHooks(existing: HooksConfig): HooksConfig {
  const cleaned: HooksConfig = {};
  for (const [event, matchers] of Object.entries(existing)) {
    const filteredMatchers = matchers
      .map((m) => ({
        ...m,
        hooks: (m.hooks ?? []).filter((h) => !isIdeHook(h)),
      }))
      .filter((m) => m.hooks.length > 0);
    if (filteredMatchers.length > 0) {
      cleaned[event] = filteredMatchers;
    }
  }
  return cleaned;
}

export function installCodexHooks(): void {
  ensureCodexHooksFeatureFlag();

  const raw = readJsonSafe(HOOKS_JSON_PATH) ?? {};
  const existingHooks: HooksConfig = (raw.hooks ?? {}) as HooksConfig;
  const cleaned = cleanHooks(existingHooks);

  installHookScripts();

  const statusCmd = (event: string, status: string) =>
    mkStatusCmd(event, status, SESSION_ID_VAR, CODEX_HOOK_MARKER);

  const captureSessionIdCmd = mkCaptureSessionIdCmd(SESSION_ID_VAR, CODEX_HOOK_MARKER);

  const captureEventCmd = (hookEvent: string, eventType: string) => {
    const pyCode = `import sys,json,os,time
try:
 d=json.load(sys.stdin)
except:
 sys.exit(0)
sid=os.environ.get("${SESSION_ID_VAR}","")
if not sid:
 sys.exit(0)
e={"type":"${eventType}","timestamp":int(time.time()*1000),"hookEvent":"${hookEvent}"}
tn=d.get("tool_name","")
if tn:
 e["tool_name"]=tn
ti=d.get("tool_input")
if ti:
 e["tool_input"]=ti
for fld in ("session_id","cwd","model","turn_id"):
 v=d.get(fld,"")
 if v:
  e[fld]=v
status_dir=r'${STATUS_DIR}'
with open(os.path.join(status_dir,sid+".events"),"a") as f:
 f.write(json.dumps(e)+"\\n")
`;
    const scriptName = `codex_event_${hookEvent}.py`;
    installEventScript(scriptName, pyCode);
    return wrapPythonHookCmd(scriptName, pyCode, CODEX_HOOK_MARKER);
  };

  // Status-changing events
  const ideEvents: Record<string, string> = {
    SessionStart: 'waiting',
    UserPromptSubmit: 'working',
    PostToolUse: 'working',
    Stop: 'completed',
  };

  const eventTypeMap: Record<string, InspectorEventType> = {
    SessionStart: 'session_start',
    UserPromptSubmit: 'user_prompt',
    PostToolUse: 'tool_use',
    Stop: 'stop',
  };

  for (const [event, status] of Object.entries(ideEvents)) {
    const existing = cleaned[event] ?? [];
    const hooks: HookHandler[] = [{ type: 'command', command: statusCmd(event, status) }];
    if (event === 'SessionStart' || event === 'UserPromptSubmit') {
      hooks.push({ type: 'command', command: captureSessionIdCmd });
    }
    hooks.push({ type: 'command', command: captureEventCmd(event, eventTypeMap[event]) });
    existing.push({ matcher: '', hooks });
    cleaned[event] = existing;
  }

  // Inspector-only events
  const inspectorOnlyEvents: Record<string, InspectorEventType> = {
    PreToolUse: 'pre_tool_use',
  };

  for (const [event, eventType] of Object.entries(inspectorOnlyEvents)) {
    const existing = cleaned[event] ?? [];
    existing.push({
      matcher: '',
      hooks: [{ type: 'command', command: captureEventCmd(event, eventType) }],
    });
    cleaned[event] = existing;
  }

  const output = { ...raw, hooks: cleaned };
  fs.writeFileSync(HOOKS_JSON_PATH, JSON.stringify(output, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateCodexHooks(): SettingsValidationResult {
  if (!isCodexHooksFeatureEnabled()) {
    const hookDetails: Record<string, boolean> = Object.fromEntries(EXPECTED_HOOK_EVENTS.map(e => [e, false]));
    return { statusLine: 'vibeyard', hooks: 'missing', hookDetails };
  }

  // Check hooks.json
  const raw = readJsonSafe(HOOKS_JSON_PATH);
  const existingHooks: HooksConfig = (raw?.hooks ?? {}) as HooksConfig;
  const hookDetails: Record<string, boolean> = Object.fromEntries(EXPECTED_HOOK_EVENTS.map(e => [e, false]));
  let found = 0;

  for (const event of EXPECTED_HOOK_EVENTS) {
    const matchers = existingHooks[event];
    const installed = matchers?.some(m => m.hooks?.some(h => isIdeHook(h))) ?? false;
    hookDetails[event] = installed;
    if (installed) found++;
  }

  let hooks: SettingsValidationResult['hooks'] = 'missing';
  if (found === EXPECTED_HOOK_EVENTS.length) {
    hooks = 'complete';
  } else if (found > 0) {
    hooks = 'partial';
  }

  return { statusLine: 'vibeyard', hooks, hookDetails };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function cleanupCodexHooks(): void {
  const raw = readJsonSafe(HOOKS_JSON_PATH);
  if (!raw) return;

  const config = raw as Record<string, unknown>;
  const existingHooks: HooksConfig = (config.hooks ?? {}) as HooksConfig;
  const cleaned = cleanHooks(existingHooks);

  if (Object.keys(cleaned).length === 0) {
    delete config.hooks;
  } else {
    config.hooks = cleaned;
  }

  fs.writeFileSync(HOOKS_JSON_PATH, JSON.stringify(config, null, 2) + '\n');
}
