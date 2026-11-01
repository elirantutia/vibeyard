// Wire format for external control (vibeyard-ctl). Requests are untrusted
// input from a local process, so every field is type- and size-checked and
// unknown fields are dropped. new-session deliberately has no args/env: a
// worker always runs with its project's saved defaults, so an agent cannot add
// CLI flags (e.g. --dangerously-skip-permissions) or env (NODE_OPTIONS, PATH).

export const CTL_PROTOCOL_VERSION = 1;
export const CTL_MAX_REQUEST_BYTES = 128 * 1024;
export const CTL_MAX_PROMPT_CHARS = 64 * 1024;
export const CTL_MAX_NAME_CHARS = 200;
export const CTL_REQ_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
/** Name of one Vibeyard instance's folder under ~/.vibeyard/commands: `<pid>-<8 hex>`. */
export const CTL_INSTANCE_RE = /^(\d+)-[0-9a-f]{8}$/;

export type CtlErrorCode =
  | 'disabled' | 'unauthorized' | 'not_owner' | 'unknown_session'
  | 'unknown_project' | 'invalid_request' | 'unsupported' | 'timeout';

export type CtlCommand =
  | { action: 'new-session'; name: string; project?: string; prompt?: string; provider?: string; profile?: string; focus?: boolean }
  | { action: 'rename'; sessionId: string; name: string }
  | { action: 'close'; sessionId: string }
  | { action: 'list'; project?: string; mine?: boolean };

export type CtlResult =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: CtlErrorCode; message: string } };

export type CtlSessionStatus = 'not_started' | 'idle' | 'working' | 'input' | 'exited';

export interface CtlListEntry {
  projectId: string;
  sessionId: string;
  name: string;
  cliSessionId: string | null;
  providerId: string;
  status: CtlSessionStatus;
  createdBy: string | null;
  createdAt: string;
  cost: { totalCostUsd: number } | null;
  userRenamed: boolean;
}

export function ctlError(code: CtlErrorCode, message: string): CtlResult {
  return { ok: false, error: { code, message } };
}

type Parsed = { ok: true; token: string; command: CtlCommand } | { ok: false; error: { code: CtlErrorCode; message: string } };

class Invalid extends Error {}

function str(o: Record<string, unknown>, key: string, opts: { required?: boolean; max: number; nonBlank?: boolean }): string | undefined {
  const v = o[key];
  if (v === undefined) {
    if (opts.required) throw new Invalid(`'${key}' is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw new Invalid(`'${key}' must be a string`);
  if (v.length > opts.max) throw new Invalid(`'${key}' is longer than ${opts.max} characters`);
  if (opts.nonBlank && v.trim() === '') throw new Invalid(`'${key}' must not be empty`);
  return v;
}

function bool(o: Record<string, unknown>, key: string): boolean | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw new Invalid(`'${key}' must be true or false`);
  return v;
}

function defined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

function parseCommand(c: Record<string, unknown>): CtlCommand {
  switch (c.action) {
    case 'new-session':
      // Rejected rather than dropped, so a caller never believes its flags or env were applied.
      for (const key of ['args', 'env']) {
        if (c[key] !== undefined) throw new Invalid(`'${key}' is not supported: new sessions use the project's saved default args and env`);
      }
      return defined({
        action: 'new-session' as const,
        name: str(c, 'name', { required: true, max: CTL_MAX_NAME_CHARS, nonBlank: true })!,
        project: str(c, 'project', { max: 4096 }),
        prompt: str(c, 'prompt', { max: CTL_MAX_PROMPT_CHARS }),
        provider: str(c, 'provider', { max: 64 }),
        profile: str(c, 'profile', { max: 256 }),
        focus: bool(c, 'focus'),
      });
    case 'rename':
      return {
        action: 'rename',
        sessionId: str(c, 'sessionId', { required: true, max: 128, nonBlank: true })!,
        name: str(c, 'name', { required: true, max: CTL_MAX_NAME_CHARS, nonBlank: true })!,
      };
    case 'close':
      return { action: 'close', sessionId: str(c, 'sessionId', { required: true, max: 128, nonBlank: true })! };
    case 'list':
      return defined({ action: 'list' as const, project: str(c, 'project', { max: 4096 }), mine: bool(c, 'mine') });
    default:
      throw new Invalid(`unknown action '${String(c.action)}'`);
  }
}

export function parseCtlRequest(raw: string): Parsed {
  try {
    let data: unknown;
    try { data = JSON.parse(raw); } catch { throw new Invalid('request is not valid JSON'); }
    if (!data || typeof data !== 'object') throw new Invalid('request must be a JSON object');
    const o = data as Record<string, unknown>;
    if (o.v !== CTL_PROTOCOL_VERSION) throw new Invalid(`unsupported protocol version '${String(o.v)}'`);
    if (typeof o.token !== 'string' || o.token === '') throw new Invalid('missing token');
    if (!o.command || typeof o.command !== 'object') throw new Invalid('missing command');
    return { ok: true, token: o.token, command: parseCommand(o.command as Record<string, unknown>) };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: { code: 'invalid_request', message: e.message } };
    throw e;
  }
}
