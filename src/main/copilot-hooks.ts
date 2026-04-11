import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { STATUS_DIR, SCRIPT_DIR } from './hook-status';
import { statusCmd as mkStatusCmd, installEventScript, installHookScripts } from './hook-commands';
import { readJsonSafe } from './fs-utils';
import { pythonBin } from './platform';
import type { SettingsValidationResult } from '../shared/types';

export const COPILOT_HOOK_MARKER = '# vibeyard-hook';

const COPILOT_DIR = path.join(homedir(), '.copilot');
const CONFIG_JSON_PATH = path.join(COPILOT_DIR, 'config.json');

export const SESSION_ID_VAR = 'VIBEYARD_SESSION_ID';

// TODO: verify event names (sessionStart, userPromptSubmitted, postToolUse, sessionEnd)
// and the `sessionId` field name against actual Copilot CLI hook documentation.
const STATUS_EVENTS: Record<string, string> = {
  sessionStart: 'waiting',
  userPromptSubmitted: 'working',
  postToolUse: 'working',
  sessionEnd: 'completed',
};

const EXPECTED_HOOK_EVENTS = Object.keys(STATUS_EVENTS);

interface HookEntry {
  type?: string;
  command?: string;
  bash?: string;
  powershell?: string;
  [key: string]: unknown;
}

type HooksConfig = Record<string, HookEntry[]>;

function isIdeHook(h: HookEntry): boolean {
  return !!(
    h.command?.includes(COPILOT_HOOK_MARKER) ||
    h.bash?.includes(COPILOT_HOOK_MARKER) ||
    h.powershell?.includes(COPILOT_HOOK_MARKER)
  );
}

function cleanHooks(existing: HooksConfig): HooksConfig {
  const cleaned: HooksConfig = {};
  for (const [event, entries] of Object.entries(existing)) {
    const filtered = entries.filter((h) => !isIdeHook(h));
    if (filtered.length > 0) {
      cleaned[event] = filtered;
    }
  }
  return cleaned;
}

function captureSessionIdCopilotCmd(): string {
  const scriptName = 'copilot_session_id_capture.py';
  const pyCode = `import sys,json,os
try:
    d=json.load(sys.stdin)
except:
    sys.exit(0)
sid_env=os.environ.get(sys.argv[1],'')
status_dir=sys.argv[2]
copilot_sid=d.get('sessionId','')
if sid_env and copilot_sid:
    with open(os.path.join(status_dir,sid_env+'.sessionid'),'w') as f:
        f.write(copilot_sid)
`;
  installEventScript(scriptName, pyCode);
  const pyPath = path.join(SCRIPT_DIR, scriptName).replace(/\\/g, '/');
  const dir = STATUS_DIR.replace(/\\/g, '/');
  return `${pythonBin} "${pyPath}" "${SESSION_ID_VAR}" "${dir}" "${COPILOT_HOOK_MARKER}"`;
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

export function installCopilotHooks(): void {
  fs.mkdirSync(COPILOT_DIR, { recursive: true });

  installHookScripts();

  const raw = (readJsonSafe(CONFIG_JSON_PATH) ?? {}) as Record<string, unknown>;
  const existingHooks: HooksConfig = (raw.hooks ?? {}) as HooksConfig;
  const cleaned = cleanHooks(existingHooks);

  const statusCmdFn = (event: string, status: string) =>
    mkStatusCmd(event, status, SESSION_ID_VAR, COPILOT_HOOK_MARKER);

  const captureSessionId = captureSessionIdCopilotCmd();

  for (const [event, status] of Object.entries(STATUS_EVENTS)) {
    const existing = cleaned[event] ?? [];
    const entries: HookEntry[] = [{ type: 'command', command: statusCmdFn(event, status) }];
    if (event === 'sessionStart' || event === 'userPromptSubmitted') {
      entries.push({ type: 'command', command: captureSessionId });
    }
    cleaned[event] = [...existing, ...entries];
  }

  const output = { ...raw, hooks: cleaned };
  fs.writeFileSync(CONFIG_JSON_PATH, JSON.stringify(output, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateCopilotHooks(): SettingsValidationResult {
  const raw = readJsonSafe(CONFIG_JSON_PATH);
  const existingHooks: HooksConfig = ((raw as Record<string, unknown>)?.hooks ?? {}) as HooksConfig;
  const hookDetails: Record<string, boolean> = Object.fromEntries(
    EXPECTED_HOOK_EVENTS.map((e) => [e, false]),
  );
  let found = 0;

  for (const event of EXPECTED_HOOK_EVENTS) {
    const entries = existingHooks[event];
    const installed = entries?.some((h) => isIdeHook(h)) ?? false;
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

export function cleanupCopilotHooks(): void {
  const raw = readJsonSafe(CONFIG_JSON_PATH);
  if (!raw) return;

  const config = raw as Record<string, unknown>;
  const existingHooks: HooksConfig = (config.hooks ?? {}) as HooksConfig;
  const cleaned = cleanHooks(existingHooks);

  if (Object.keys(cleaned).length === 0) {
    delete config.hooks;
  } else {
    config.hooks = cleaned;
  }

  fs.writeFileSync(CONFIG_JSON_PATH, JSON.stringify(config, null, 2) + '\n');
}
