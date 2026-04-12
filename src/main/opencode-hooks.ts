import * as fs from 'fs';
import * as path from 'path';
import { STATUS_DIR } from './hook-status';
import { readFileSafe } from './fs-utils';
import type { SettingsValidationResult } from '../shared/types';

export const OPENCODE_HOOK_MARKER = '// vibeyard-hook';
export const SESSION_ID_VAR = 'VIBEYARD_SESSION_ID';

const PLUGIN_FILENAME = 'vibeyard-status.js';

// Events handled by the plugin — used for validation
const EXPECTED_HOOK_EVENTS = [
  'session.created',
  'session.idle',
  'tool.execute.before',
  'tool.execute.after',
];

// The last project path we installed hooks for. validateSettings() and
// reinstallSettings() are called without a projectPath from the IPC layer,
// so we remember the last one here.
let lastProjectPath: string | null = null;

function pluginFilePath(projectPath: string): string {
  return path.join(projectPath, '.opencode', 'plugins', PLUGIN_FILENAME);
}

function buildPluginContent(): string {
  const statusDir = STATUS_DIR.replace(/\\/g, '/');
  return `${OPENCODE_HOOK_MARKER}
import * as fs from 'fs';
import * as path from 'path';

const STATUS_DIR = '${statusDir}';
const SID_VAR = '${SESSION_ID_VAR}';

function sid() { return process.env[SID_VAR] || ''; }

function writeStatus(eventName, status) {
  try {
    const id = sid();
    if (!id) return;
    fs.mkdirSync(STATUS_DIR, { recursive: true });
    fs.writeFileSync(path.join(STATUS_DIR, id + '.status'), eventName + ':' + status);
  } catch {}
}

function appendEvt(obj) {
  try {
    const id = sid();
    if (!id) return;
    fs.mkdirSync(STATUS_DIR, { recursive: true });
    fs.appendFileSync(path.join(STATUS_DIR, id + '.events'), JSON.stringify(obj) + '\\n');
  } catch {}
}

export const VibeyardStatus = async () => ({
  event: async ({ event }) => {
    if (!sid()) return;
    const t = Date.now();
    if (event.type === 'session.created') {
      writeStatus('session.created', 'waiting');
      appendEvt({ type: 'session_start', timestamp: t, hookEvent: 'session.created' });
    } else if (event.type === 'session.idle') {
      writeStatus('session.idle', 'completed');
      appendEvt({ type: 'stop', timestamp: t, hookEvent: 'session.idle' });
    } else if (event.type === 'session.error') {
      writeStatus('session.error', 'working');
      appendEvt({ type: 'tool_failure', timestamp: t, hookEvent: 'session.error' });
    } else if (event.type === 'session.status') {
      writeStatus('session.status', 'working');
      appendEvt({ type: 'user_prompt', timestamp: t, hookEvent: 'session.status' });
    } else if (event.type === 'permission.asked') {
      writeStatus('permission.asked', 'input');
      appendEvt({ type: 'permission_asked', timestamp: t, hookEvent: 'permission.asked' });
    }
  },
  'tool.execute.before': async (input) => {
    if (!sid()) return;
    writeStatus('tool.execute.before', 'working');
    appendEvt({ type: 'pre_tool_use', timestamp: Date.now(), hookEvent: 'tool.execute.before', tool_name: input.tool || '' });
  },
  'tool.execute.after': async (input) => {
    if (!sid()) return;
    appendEvt({ type: 'tool_use', timestamp: Date.now(), hookEvent: 'tool.execute.after', tool_name: input.tool || '' });
  },
});
`;
}

function isVibeyardPlugin(content: string): boolean {
  return content.includes(OPENCODE_HOOK_MARKER) && content.includes(SESSION_ID_VAR);
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

export function installOpenCodeHooks(projectPath?: string): void {
  const target = projectPath ?? lastProjectPath;
  if (!target) return;
  lastProjectPath = target;

  const filePath = pluginFilePath(target);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const content = buildPluginContent();
  // Skip write when content is byte-identical — spawnPty calls this on every
  // OpenCode session, and the payload is deterministic across spawns.
  if (readFileSafe(filePath) !== content) {
    fs.writeFileSync(filePath, content);
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateOpenCodeHooks(projectPath?: string): SettingsValidationResult {
  const target = projectPath ?? lastProjectPath;
  const hookDetails: Record<string, boolean> = Object.fromEntries(
    EXPECTED_HOOK_EVENTS.map((e) => [e, false]),
  );

  if (!target) {
    return { statusLine: 'vibeyard', hooks: 'missing', hookDetails };
  }

  const content = readFileSafe(pluginFilePath(target));
  if (!content || !isVibeyardPlugin(content)) {
    return { statusLine: 'vibeyard', hooks: 'missing', hookDetails };
  }

  let found = 0;
  for (const event of EXPECTED_HOOK_EVENTS) {
    const present = content.includes(event);
    hookDetails[event] = present;
    if (present) found++;
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

export function cleanupOpenCodeHooks(projectPath?: string): void {
  const target = projectPath ?? lastProjectPath;
  if (!target) return;
  try {
    fs.unlinkSync(pluginFilePath(target));
  } catch {
    // already gone
  }
}

/** @internal Test-only: reset module state */
export function _resetForTesting(): void {
  lastProjectPath = null;
}
