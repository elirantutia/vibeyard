/**
 * SSH-remote Claude sessions.
 *
 * A project with `remoteHost` runs every CLI session on that host: the local
 * PTY runs `ssh -t <host> …`, and the remote command starts `claude` in the
 * project path with `CLAUDE_IDE_SESSION_ID` set and `--settings <file>`
 * pointing at a Vibeyard-only settings file (hooks + statusLine). The user's
 * remote `~/.claude/settings.json` is never touched; Claude merges hooks from
 * `--settings` with the user's own.
 *
 * Status flows back through a second, long-lived SSH connection per host
 * running `mirror.py`, which polls the remote status dir and streams changes
 * as JSON lines. They are written into the local STATUS_DIR under the same
 * file names, so the existing hook-status watcher handles remote sessions
 * exactly like local ones (status, cost, context, name, inspector events).
 *
 * Remote layout (under the remote $HOME):
 *   .vibeyard/remote/run/       hook scripts, statusline, mirror.py
 *   .vibeyard/remote/status/    status files written by the hooks
 *   .vibeyard/remote/settings.json
 *
 * The hook scripts are not re-implemented here: `installHooksOnly` is run
 * against a throwaway local config dir, and its output (settings + the Python
 * scripts it writes into SCRIPT_DIR) is rewritten with remote paths.
 */
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { STATUS_DIR, SCRIPT_DIR, buildStatusLinePython } from './hook-status';
import { installHooksOnly } from './claude-cli';
import { isWin, pythonBin } from './platform';
import { isValidSshHost } from '../shared/ssh-host';

export interface RemoteInfo {
  host: string;
  home: string;
  scriptDir: string;
  statusDir: string;
  /** 0700 dir for one-shot session env files (see `stageRemoteEnv`). */
  envDir: string;
  settingsPath: string;
}

/** Status-file extensions the mirror forwards (kept in sync with hook-status.ts). */
const MIRROR_EXTENSIONS = ['.status', '.sessionid', '.cost', '.name', '.toolfailure', '.events', '.subagents'];

/** Upper bound for one mirrored status file. */
const MAX_MIRRORED_FILE_BYTES = 8 * 1024 * 1024;
/** Longest valid mirror stdout line: the file base64'd (4/3) plus JSON overhead. */
const MAX_MIRROR_LINE_CHARS = Math.ceil((MAX_MIRRORED_FILE_BYTES * 4) / 3) + 1024;

const SHARED_SCRIPTS = ['status_writer.py', 'stop_status_writer.py', 'session_id_capture.py', 'tool_failure_capture.py'];

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** POSIX single-quote a string for a remote shell. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Quote a remote path for `cd`, keeping a leading `~` / `~/` expandable
 * (a quoted tilde is literal).
 */
export function shQuotePath(p: string): string {
  if (p === '~') return '"$HOME"';
  if (p.startsWith('~/')) return `"$HOME"/${shQuote(p.slice(2))}`;
  return shQuote(p);
}

export { isValidSshHost };

export function remoteLayout(host: string, home: string): RemoteInfo {
  const base = `${home.replace(/\/+$/, '')}/.vibeyard/remote`;
  return {
    host,
    home,
    scriptDir: `${base}/run`,
    statusDir: `${base}/status`,
    envDir: `${base}/env`,
    settingsPath: `${base}/settings.json`,
  };
}

/**
 * The single command string handed to `ssh -t <host>`. The remote login shell
 * parses it; `bash -lc` then gives claude the login PATH (e.g. ~/.local/bin),
 * which a plain non-interactive ssh command does not have.
 */
export function buildRemoteClaudeCommand(opts: {
  sessionId: string;
  remotePath: string;
  settingsPath: string;
  claudeArgs: string[];
  /**
   * Remote file holding the session env (see `stageRemoteEnv`). Sourced inside
   * the login shell, so the profile cannot clobber it, then deleted. The values
   * never appear in this command line, which `ps` shows to every user on both
   * machines.
   */
  envFile?: string;
}): string {
  const claudeArgs = ['--settings', opts.settingsPath, ...opts.claudeArgs].map(shQuote).join(' ');
  const f = opts.envFile ? shQuote(opts.envFile) : '';
  const loadEnv = f ? `. ${f}; rc=$?; rm -f ${f}; [ "$rc" = 0 ] && ` : '';
  const inner = `${loadEnv}cd ${shQuotePath(opts.remotePath)} && exec claude ${claudeArgs}`;
  // `env VAR=…` rather than a `VAR=…` prefix: the remote *login* shell parses
  // this line, and csh/tcsh/old fish have no prefix-assignment syntax.
  return `exec env CLAUDE_IDE_SESSION_ID=${shQuote(opts.sessionId)} bash -lc ${shQuote(inner)}`;
}

/** `export` lines for the session env; names that are not shell identifiers are dropped. */
export function buildEnvScript(env: Record<string, string>): string {
  return Object.entries(env)
    .filter(([k]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k))
    .map(([k, v]) => `export ${k}=${shQuote(v)}\n`)
    .join('');
}

/** Remote path of a session's one-shot env file. */
export function remoteEnvFile(info: RemoteInfo, sessionId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new Error(`invalid session id: ${sessionId}`);
  return `${info.envDir}/${sessionId}.sh`;
}

/**
 * True when a mirrored file name belongs to one of `sessions` (`<sid><ext>`).
 * A remote host may only touch the status files of sessions it runs; without
 * this check a compromised host could spoof status/name/events for any local
 * session by writing `<otherSid>.status` into its own status dir.
 */
export function isMirrorFileFor(file: string, sessions: ReadonlySet<string>): boolean {
  const ext = MIRROR_EXTENSIONS.find((e) => file.endsWith(e));
  if (!ext) return false;
  const base = file.slice(0, -ext.length);
  if (sessions.has(base)) return true;
  if (ext !== '.toolfailure') return false;
  // Tool failures are `<sid>-<suffix>.toolfailure` (see mirror.py's sid_of).
  for (const sid of sessions) if (base.startsWith(`${sid}-`)) return true;
  return false;
}

/** Ordered [from, to] replacements mapping local Vibeyard paths to remote ones. */
export function pathReplacements(
  local: { scriptDir: string; statusDir: string },
  remote: { scriptDir: string; statusDir: string },
): Array<[string, string]> {
  const jsonInner = (s: string) => JSON.stringify(s).slice(1, -1);
  const fwd = (s: string) => s.replace(/\\/g, '/');
  const pairs: Array<[string, string]> = [
    // JSON-escaped form first (as embedded in generated Python via pyLiteral).
    [jsonInner(local.statusDir), jsonInner(remote.statusDir)],
    [jsonInner(local.scriptDir), jsonInner(remote.scriptDir)],
    [fwd(local.statusDir), remote.statusDir],
    [fwd(local.scriptDir), remote.scriptDir],
    [local.statusDir, remote.statusDir],
    [local.scriptDir, remote.scriptDir],
  ];
  // Dedupe (on POSIX several forms coincide) and drop no-ops; longest first so
  // a shorter form never clobbers part of a longer one.
  const seen = new Set<string>();
  return pairs
    .filter(([from, to]) => from && from !== to && !seen.has(from) && seen.add(from))
    .sort((a, b) => b[0].length - a[0].length);
}

export function applyReplacements(text: string, pairs: Array<[string, string]>): string {
  let out = text;
  for (const [from, to] of pairs) out = out.split(from).join(to);
  return out;
}

/** Rewrite one local hook command for the remote host. */
export function translateHookCommand(cmd: string, pairs: Array<[string, string]>, localPython: string = pythonBin): string {
  let out = applyReplacements(cmd, pairs);
  if (out.startsWith(`${localPython} `)) out = `python3 ${out.slice(localPython.length + 1)}`;
  return out;
}

type HooksConfig = Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string; timeout?: number }> }>>;

export function translateHooks(hooks: HooksConfig, pairs: Array<[string, string]>, localPython: string = pythonBin): HooksConfig {
  const out: HooksConfig = {};
  for (const [event, matchers] of Object.entries(hooks)) {
    out[event] = matchers.map((m) => ({
      ...m,
      hooks: m.hooks.map((h) => ({ ...h, command: translateHookCommand(h.command, pairs, localPython) })),
    }));
  }
  return out;
}

export interface MirrorMessage {
  op: 'ready' | 'w' | 'a' | 'd';
  f?: string;
  b?: string;
}

/** Parse one mirror stdout line; returns null for anything malformed or unsafe. */
export function parseMirrorLine(line: string): MirrorMessage | null {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as MirrorMessage;
  if (m.op === 'ready') return m;
  if (m.op !== 'w' && m.op !== 'a' && m.op !== 'd') return null;
  if (typeof m.f !== 'string') return null;
  // Only plain status-file names: no separators, no traversal.
  if (!/^[A-Za-z0-9_.-]+$/.test(m.f) || m.f.startsWith('.')) return null;
  if (!MIRROR_EXTENSIONS.some((ext) => m.f!.endsWith(ext))) return null;
  if (m.op !== 'd' && typeof m.b !== 'string') return null;
  return m;
}

export interface SshHostEntry {
  alias: string;
  hostName?: string;
  user?: string;
  port?: string;
}

/**
 * Parse `Host` blocks from ssh_config text. Wildcard/negated patterns are
 * skipped (they are defaults, not destinations), and so are git-hosting
 * entries (`User git`), which are never a shell target. `Include` lines are
 * returned separately so the caller can resolve them against the filesystem.
 */
export function parseSshConfig(text: string): { hosts: SshHostEntry[]; includes: string[]; items: SshConfigItem[] } {
  const items: SshConfigItem[] = [];
  let current: SshHostEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^(\S+?)\s*(?:=\s*|\s+)(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'include') {
      for (const pattern of value.split(/\s+/)) items.push({ include: pattern });
    } else if (key === 'host') {
      current = value
        .split(/\s+/)
        .filter((a) => !/[*?!]/.test(a))
        .map((alias) => ({ alias }));
      for (const host of current) items.push({ host });
    } else if (key === 'match') {
      current = [];
    } else {
      for (const h of current) {
        if (key === 'hostname' && !h.hostName) h.hostName = value;
        else if (key === 'user' && !h.user) h.user = value;
        else if (key === 'port' && !h.port) h.port = value;
      }
    }
  }
  const kept = items.filter((i) => !('host' in i) || i.host.user !== 'git');
  return {
    items: kept,
    hosts: kept.flatMap((i) => ('host' in i ? [i.host] : [])),
    includes: kept.flatMap((i) => ('include' in i ? [i.include] : [])),
  };
}

/** One `Host` alias or `Include` pattern, in file order (Include is processed in place). */
export type SshConfigItem = { host: SshHostEntry } | { include: string };

/** Hosts from ~/.ssh/config (and its Include files), de-duplicated by alias. */
export function listSshHosts(configPath: string = path.join(os.homedir(), '.ssh', 'config')): SshHostEntry[] {
  const sshDir = path.dirname(configPath);
  const seenFiles = new Set<string>();
  const out = new Map<string, SshHostEntry>();

  const expandInclude = (pattern: string): string[] => {
    let p = pattern.startsWith('~') ? path.join(os.homedir(), pattern.slice(1)) : pattern;
    if (!path.isAbsolute(p)) p = path.join(sshDir, p);
    const dir = path.dirname(p);
    const base = path.basename(p);
    if (!/[*?]/.test(base)) return [p];
    const re = new RegExp('^' + base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    try {
      return fs.readdirSync(dir).filter((f) => re.test(f)).sort().map((f) => path.join(dir, f));
    } catch {
      return [];
    }
  };

  const visit = (file: string, depth: number) => {
    if (depth > 4 || seenFiles.has(file)) return;
    seenFiles.add(file);
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf-8');
    } catch {
      return;
    }
    for (const item of parseSshConfig(text).items) {
      if ('host' in item) {
        if (!out.has(item.host.alias)) out.set(item.host.alias, item.host);
      } else {
        for (const f of expandInclude(item.include)) visit(f, depth + 1);
      }
    }
  };

  visit(configPath, 0);
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Remote scripts
// ---------------------------------------------------------------------------

/**
 * Remote status mirror. Reads commands on stdin (`reset <sid>`, `watch <sid>`,
 * `unwatch <sid>`) and emits JSON lines for changes to watched sessions' files.
 * Exits when stdin closes, so it never outlives the local connection.
 */
export const MIRROR_PY = `import os,sys,time,json,base64,threading
d=sys.argv[1]
os.makedirs(d,exist_ok=True)
EXT=${JSON.stringify(MIRROR_EXTENSIONS)}
watched=set()
state={}
lock=threading.Lock()
def out(o):
    sys.stdout.write(json.dumps(o)+'\\n')
    sys.stdout.flush()
def sid_of(n):
    for e in EXT:
        if n.endswith(e):
            b=n[:-len(e)]
            if e=='.toolfailure':
                i=b.rfind('-')
                if i>=0:
                    b=b[:i]
            return b
    return None
def reader():
    for line in sys.stdin:
        p=line.split()
        if len(p)!=2:
            continue
        cmd,sid=p
        with lock:
            if cmd=='reset':
                try:
                    names=os.listdir(d)
                except OSError:
                    names=[]
                for n in names:
                    if sid_of(n)==sid:
                        try:
                            os.remove(os.path.join(d,n))
                        except OSError:
                            pass
                        state.pop(n,None)
                watched.add(sid)
            elif cmd=='watch':
                watched.add(sid)
                for n in list(state):
                    if sid_of(n)==sid:
                        state.pop(n)
            elif cmd=='unwatch':
                watched.discard(sid)
                for n in list(state):
                    if sid_of(n)==sid:
                        state.pop(n)
    os._exit(0)
threading.Thread(target=reader,daemon=True).start()
out({'op':'ready'})
while True:
    with lock:
        try:
            names=os.listdir(d)
        except OSError:
            names=[]
        seen=set()
        for n in names:
            s=sid_of(n)
            if s is None or s not in watched:
                continue
            seen.add(n)
            p=os.path.join(d,n)
            try:
                st=os.stat(p)
            except OSError:
                continue
            prev=state.get(n)
            if prev and prev[0]==st.st_mtime_ns and prev[1]==st.st_size:
                continue
            try:
                with open(p,'rb') as f:
                    if n.endswith('.events') and prev and st.st_size>prev[1]:
                        f.seek(prev[1])
                        data=f.read()
                        op='a'
                        size=prev[1]+len(data)
                    else:
                        data=f.read()
                        op='w'
                        size=len(data)
            except OSError:
                continue
            state[n]=(st.st_mtime_ns,size)
            out({'op':op,'f':n,'b':base64.b64encode(data).decode('ascii')})
        for n in list(state):
            if n not in seen and sid_of(n) in watched:
                state.pop(n)
                out({'op':'d','f':n})
    time.sleep(0.25)
`;

/**
 * statusLine wrapper for remote sessions. `--settings` *replaces* the user's
 * statusLine (hooks merge, statusLine does not), so this feeds the payload to
 * Vibeyard's statusline.py (writes status files, prints nothing) and then to
 * the user's own statusLine command from their remote settings, whose output
 * is what Claude displays. The user's command is looked up on every render so
 * edits to their settings apply without re-running setup.
 */
export function buildStatusLineChainPython(statusDir: string): string {
  return `import sys,os,json,subprocess
data=sys.stdin.buffer.read()
here=os.path.dirname(os.path.abspath(__file__))
status_dir=${JSON.stringify(statusDir)}
try:
    with open(os.path.join(status_dir,'statusline.log'),'ab') as log:
        subprocess.run([sys.executable,os.path.join(here,'statusline.py')],input=data,stdout=subprocess.DEVNULL,stderr=log,timeout=5)
except Exception:
    pass
cmd=''
try:
    cfg=os.environ.get('CLAUDE_CONFIG_DIR') or os.path.expanduser('~/.claude')
    with open(os.path.join(cfg,'settings.json')) as f:
        sl=json.load(f).get('statusLine') or {}
    if isinstance(sl,dict):
        cmd=sl.get('command') or ''
except Exception:
    pass
if cmd and '.vibeyard' not in cmd:
    try:
        r=subprocess.run(cmd,shell=True,input=data,stdout=subprocess.PIPE,timeout=10)
        sys.stdout.buffer.write(r.stdout)
    except Exception:
        pass
`;
}

// ---------------------------------------------------------------------------
// SSH process helpers
// ---------------------------------------------------------------------------

export function resolveSshBinary(): string {
  if (isWin) {
    const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe');
    if (fs.existsSync(sys32)) return sys32;
    return 'ssh.exe';
  }
  return 'ssh';
}

const BATCH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=30'];

function runSsh(host: string, remoteCmd: string, stdin?: string, timeoutMs = 30_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(resolveSshBinary(), [...BATCH_OPTS, host, remoteCmd], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr || String(err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

/**
 * Write the session env to a 0600 file on the host, sent over ssh stdin, and
 * return its path for `buildRemoteClaudeCommand({ envFile })`. Returns
 * undefined when there is nothing to export.
 */
export async function stageRemoteEnv(info: RemoteInfo, sessionId: string, env: Record<string, string>): Promise<string | undefined> {
  const script = buildEnvScript(env);
  if (!script) return undefined;
  const file = remoteEnvFile(info, sessionId);
  // envDir is created 0700 by the per-host setup (buildUploadScript).
  const res = await runSsh(info.host, `umask 077 && cat > ${shQuote(file)}`, script);
  if (res.code !== 0) throw new Error(`could not stage session env on ${info.host}: ${res.stderr.trim() || `code ${res.code}`}`);
  return file;
}

/** Resolve (and verify) a directory on the remote host; returns its absolute path. */
export async function resolveRemoteDir(host: string, remotePath: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (!isValidSshHost(host)) return { ok: false, error: `invalid SSH host: ${host}` };
  const res = await runSsh(host, `cd ${shQuotePath(remotePath)} && pwd`);
  if (res.code !== 0) {
    const msg = res.stderr.trim().split('\n').pop() || `ssh exited with code ${res.code}`;
    return { ok: false, error: msg };
  }
  const abs = res.stdout.trim().split('\n').pop() || '';
  return abs ? { ok: true, path: abs } : { ok: false, error: 'empty path from remote' };
}

/**
 * Non-hidden subdirectory names of `remoteDir` on `host` (for path
 * autocomplete). Returns [] on any failure — a missing dir while typing is normal.
 */
export async function listRemoteDirs(host: string, remoteDir: string): Promise<string[]> {
  if (!isValidSshHost(host)) return [];
  const res = await runSsh(host, `cd ${shQuotePath(remoteDir || '~')} 2>/dev/null && for d in */; do [ -d "$d" ] && printf '%s\\n' "\${d%/}"; done`, undefined, 15_000);
  if (res.code !== 0) return [];
  return res.stdout.split(/\r?\n/).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Remote setup (once per host per app run)
// ---------------------------------------------------------------------------

const setupCache = new Map<string, Promise<RemoteInfo>>();

/** Collect the remote files: path relative to scriptDir/base -> content. */
function buildRemoteFiles(info: RemoteInfo): Map<string, string> {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'vibeyard-remote-'));
  try {
    // Generates settings.json in `stage` and (re)writes the Python scripts
    // into the local SCRIPT_DIR, exactly as for a local session.
    installHooksOnly(stage);
    const settings = JSON.parse(fs.readFileSync(path.join(stage, 'settings.json'), 'utf-8'));
    const pairs = pathReplacements({ scriptDir: SCRIPT_DIR, statusDir: STATUS_DIR }, info);

    const files = new Map<string, string>();
    const scripts = fs.readdirSync(SCRIPT_DIR).filter((f) => SHARED_SCRIPTS.includes(f) || /^claude_event_.+\.py$/.test(f));
    for (const name of scripts) {
      const content = fs.readFileSync(path.join(SCRIPT_DIR, name), 'utf-8');
      files.set(`${info.scriptDir}/${name}`, applyReplacements(content, pairs));
    }
    files.set(`${info.scriptDir}/statusline.py`, buildStatusLinePython(info.statusDir));
    files.set(`${info.scriptDir}/statusline_chain.py`, buildStatusLineChainPython(info.statusDir));
    files.set(
      `${info.scriptDir}/statusline.sh`,
      `#!/bin/sh\nexec python3 ${shQuote(`${info.scriptDir}/statusline_chain.py`)} 2>>${shQuote(`${info.statusDir}/statusline.log`)}\n`,
    );
    files.set(`${info.scriptDir}/mirror.py`, MIRROR_PY);
    files.set(
      info.settingsPath,
      JSON.stringify(
        {
          hooks: translateHooks(settings.hooks ?? {}, pairs),
          statusLine: { type: 'command', command: `${info.scriptDir}/statusline.sh` },
        },
        null,
        2,
      ) + '\n',
    );
    return files;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

/** A bash script that writes every file via base64 (no quoting hazards). */
function buildUploadScript(info: RemoteInfo, files: Map<string, string>): string {
  const lines = [
    'set -e',
    `mkdir -p ${shQuote(info.scriptDir)} ${shQuote(info.statusDir)} ${shQuote(info.envDir)}`,
    `chmod 700 ${shQuote(info.statusDir)} ${shQuote(info.envDir)}`,
  ];
  for (const [file, content] of files) {
    const b64 = Buffer.from(content, 'utf-8').toString('base64');
    lines.push(`printf %s ${shQuote(b64)} | base64 -d > ${shQuote(file)}`);
  }
  lines.push(`chmod +x ${shQuote(`${info.scriptDir}/statusline.sh`)}`);
  lines.push('echo VIBEYARD_SETUP_OK');
  return lines.join('\n') + '\n';
}

async function setupRemote(host: string): Promise<RemoteInfo> {
  const probe = await runSsh(host, `printf '%s\\n' "$HOME"; command -v python3 >/dev/null 2>&1 && echo PY_OK; command -v base64 >/dev/null 2>&1 && echo B64_OK`);
  if (probe.code !== 0) {
    throw new Error(probe.stderr.trim() || `ssh ${host} failed (code ${probe.code})`);
  }
  const out = probe.stdout.trim().split(/\r?\n/);
  const home = out[0]?.trim();
  if (!home || !home.startsWith('/')) throw new Error(`could not determine remote $HOME on ${host}`);
  if (!out.includes('PY_OK')) throw new Error(`python3 not found on ${host} (needed for Vibeyard status hooks)`);
  if (!out.includes('B64_OK')) throw new Error(`base64 not found on ${host}`);

  const info = remoteLayout(host, home);
  const upload = await runSsh(host, 'bash -s', buildUploadScript(info, buildRemoteFiles(info)), 60_000);
  if (upload.code !== 0 || !upload.stdout.includes('VIBEYARD_SETUP_OK')) {
    throw new Error(`remote setup failed on ${host}: ${upload.stderr.trim() || `code ${upload.code}`}`);
  }
  return info;
}

export function ensureRemoteSetup(host: string): Promise<RemoteInfo> {
  if (!isValidSshHost(host)) return Promise.reject(new Error(`invalid SSH host: ${host}`));
  let p = setupCache.get(host);
  if (!p) {
    p = setupRemote(host);
    setupCache.set(host, p);
    p.catch(() => setupCache.delete(host));
  }
  return p;
}

// ---------------------------------------------------------------------------
// Status mirror (one long-lived connection per host)
// ---------------------------------------------------------------------------

interface Mirror {
  host: string;
  info: RemoteInfo;
  child: ChildProcess | null;
  sessions: Set<string>;
  restartTimer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
}

const mirrors = new Map<string, Mirror>();

function applyMirrorMessage(msg: MirrorMessage, sessions: ReadonlySet<string>): void {
  if (msg.op === 'ready' || !msg.f || !isMirrorFileFor(msg.f, sessions)) return;
  const target = path.join(STATUS_DIR, msg.f);
  try {
    if (msg.op === 'd') {
      fs.rmSync(target, { force: true });
    } else {
      const data = Buffer.from(msg.b ?? '', 'base64');
      // A remote host must not be able to fill the local disk.
      const existing = msg.op === 'a' ? (fs.statSync(target, { throwIfNoEntry: false })?.size ?? 0) : 0;
      if (existing + data.length > MAX_MIRRORED_FILE_BYTES) {
        console.warn('[remote-ssh] dropping oversized mirror write', msg.f, existing + data.length);
        return;
      }
      if (msg.op === 'a') fs.appendFileSync(target, data);
      else fs.writeFileSync(target, data);
    }
  } catch (err) {
    console.warn('[remote-ssh] failed to apply mirror message', msg.op, msg.f, err);
  }
}

function sendToMirror(m: Mirror, line: string): void {
  try {
    m.child?.stdin?.write(line + '\n');
  } catch {
    // Dead pipe: the exit handler restarts the mirror and re-watches.
  }
}

function startMirrorProcess(m: Mirror): void {
  if (m.stopped) return;
  const remoteCmd = `exec python3 -u ${shQuote(`${m.info.scriptDir}/mirror.py`)} ${shQuote(m.info.statusDir)}`;
  const child = spawn(resolveSshBinary(), [...BATCH_OPTS, '-o', 'ServerAliveCountMax=3', m.host, remoteCmd], { windowsHide: true });
  m.child = child;
  try {
    fs.mkdirSync(STATUS_DIR, { recursive: true });
  } catch {
    // Each write then fails on its own and is logged by applyMirrorMessage.
  }

  let buf = '';
  child.stdout?.on('data', (chunk) => {
    // Only the new chunk can hold a newline the previous scan has not seen.
    let scanFrom = buf.length;
    buf += chunk.toString();
    let start = 0;
    let idx: number;
    while ((idx = buf.indexOf('\n', Math.max(start, scanFrom))) !== -1) {
      const line = buf.slice(start, idx).trim();
      start = idx + 1;
      scanFrom = start;
      const msg = line ? parseMirrorLine(line) : null;
      if (msg) applyMirrorMessage(msg, m.sessions);
    }
    buf = buf.slice(start);
    if (buf.length > MAX_MIRROR_LINE_CHARS) {
      console.warn(`[remote-ssh] mirror ${m.host}: discarding oversized line`);
      buf = '';
    }
  });
  child.stderr?.on('data', (d) => console.warn(`[remote-ssh] mirror ${m.host}:`, d.toString().trim()));
  child.on('error', (err) => console.warn(`[remote-ssh] mirror ${m.host} spawn error:`, err));
  child.on('close', () => {
    if (m.child === child) m.child = null;
    if (m.stopped || m.sessions.size === 0) return;
    // Connection dropped while sessions are live: reconnect and re-watch.
    m.restartTimer = setTimeout(() => {
      m.restartTimer = null;
      startMirrorProcess(m);
      for (const sid of m.sessions) sendToMirror(m, `watch ${sid}`);
    }, 3000);
  });
}

/**
 * Start mirroring `sessionId` on `info.host`. `reset` clears the session's
 * remote status files first (fresh spawn), mirroring what the local watcher
 * gets from cleanupSessionStatus on every exit.
 */
export function watchRemoteSession(info: RemoteInfo, sessionId: string): void {
  let m = mirrors.get(info.host);
  if (!m) {
    m = { host: info.host, info, child: null, sessions: new Set(), restartTimer: null, stopped: false };
    mirrors.set(info.host, m);
  }
  if (!m.child) {
    // Reconnect now rather than after the restart backoff, so the reset below
    // reaches the mirror instead of being dropped while it is disconnected.
    if (m.restartTimer) clearTimeout(m.restartTimer);
    m.restartTimer = null;
    startMirrorProcess(m);
    for (const sid of m.sessions) sendToMirror(m, `watch ${sid}`);
  }
  m.sessions.add(sessionId);
  sendToMirror(m, `reset ${sessionId}`);
}

export function unwatchRemoteSession(sessionId: string): void {
  for (const m of mirrors.values()) {
    if (!m.sessions.delete(sessionId)) continue;
    sendToMirror(m, `unwatch ${sessionId}`);
  }
}

export function stopAllRemoteMirrors(): void {
  for (const m of mirrors.values()) {
    m.stopped = true;
    if (m.restartTimer) clearTimeout(m.restartTimer);
    try {
      m.child?.stdin?.end();
      m.child?.kill();
    } catch {
      // ignore
    }
  }
  mirrors.clear();
}
