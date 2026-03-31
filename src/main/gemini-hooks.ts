import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { STATUS_DIR } from './hook-status';
import { readJsonSafe } from './fs-utils';
import type { InspectorEventType, SettingsValidationResult } from '../shared/types';

export const GEMINI_HOOK_MARKER = '# vibeyard-hook';

const GEMINI_DIR = path.join(homedir(), '.gemini');
const SETTINGS_PATH = path.join(GEMINI_DIR, 'settings.json');

export const SESSION_ID_VAR = 'VIBEYARD_SESSION_ID';

const EXPECTED_HOOK_EVENTS = ['SessionStart', 'BeforeAgent', 'AfterTool', 'AfterAgent', 'SessionEnd'];

interface HookHandler {
  type: string;
  command: string;
  name?: string;
}

interface HookMatcherEntry {
  matcher?: string;
  hooks: HookHandler[];
}

type HooksConfig = Record<string, HookMatcherEntry[]>;

function isIdeHook(h: HookHandler): boolean {
  return h.command?.includes(GEMINI_HOOK_MARKER) ?? false;
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

export function installGeminiHooks(): void {
  fs.mkdirSync(GEMINI_DIR, { recursive: true });

  const settings = readJsonSafe(SETTINGS_PATH) ?? {};
  const existingHooks: HooksConfig = (settings.hooks ?? {}) as HooksConfig;
  const cleaned = cleanHooks(existingHooks);

  const statusCmd = (event: string, status: string) =>
    `sh -c 'mkdir -p ${STATUS_DIR} && echo ${event}:${status} > ${STATUS_DIR}/$${SESSION_ID_VAR}.status ${GEMINI_HOOK_MARKER}'`;

  const captureEventCmd = (hookEvent: string, eventType: string) =>
    `sh -c 'cat | /usr/bin/python3 -c "import sys,json,os,time
try:
 d=json.load(sys.stdin)
except:
 sys.exit(0)
sid=os.environ.get(\\"${SESSION_ID_VAR}\\",\\"\\")
if not sid:
 sys.exit(0)
e={\\"type\\":\\"${eventType}\\",\\"timestamp\\":int(time.time()*1000),\\"hookEvent\\":\\"${hookEvent}\\"}
tn=d.get(\\"tool_name\\",\\"\\")
if tn:
 e[\\"tool_name\\"]=tn
ti=d.get(\\"tool_input\\")
if ti:
 e[\\"tool_input\\"]=ti
for fld in (\\"session_id\\",\\"cwd\\"):
 v=d.get(fld,\\"\\")
 if v:
  e[fld]=v
with open(f\\"${STATUS_DIR}/\\"+sid+\\".events\\",\\"a\\") as f:
 f.write(json.dumps(e)+\\"\\\\n\\")
" 2>/dev/null ${GEMINI_HOOK_MARKER}'`;

  // Status-changing events
  const ideEvents: Record<string, string> = {
    SessionStart: 'waiting',
    BeforeAgent: 'working',
    AfterTool: 'working',
    AfterAgent: 'completed',
    SessionEnd: 'completed',
  };

  const eventTypeMap: Record<string, InspectorEventType> = {
    SessionStart: 'session_start',
    BeforeAgent: 'user_prompt',
    AfterTool: 'tool_use',
    AfterAgent: 'stop',
    SessionEnd: 'stop',
  };

  for (const [event, status] of Object.entries(ideEvents)) {
    const existing = cleaned[event] ?? [];
    const hooks: HookHandler[] = [
      { type: 'command', command: statusCmd(event, status), name: 'vibeyard-status' },
      { type: 'command', command: captureEventCmd(event, eventTypeMap[event]), name: 'vibeyard-events' },
    ];
    existing.push({ matcher: '', hooks });
    cleaned[event] = existing;
  }

  const output = { ...settings, hooks: cleaned };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(output, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateGeminiHooks(): SettingsValidationResult {
  const settings = readJsonSafe(SETTINGS_PATH);
  const existingHooks: HooksConfig = (settings?.hooks ?? {}) as HooksConfig;
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

export function cleanupGeminiHooks(): void {
  const settings = readJsonSafe(SETTINGS_PATH);
  if (!settings) return;

  const existingHooks: HooksConfig = (settings.hooks ?? {}) as HooksConfig;
  const cleaned = cleanHooks(existingHooks);

  if (Object.keys(cleaned).length === 0) {
    delete (settings as Record<string, unknown>).hooks;
  } else {
    (settings as Record<string, unknown>).hooks = cleaned;
  }

  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
}
