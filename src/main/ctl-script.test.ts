// src/main/ctl-script.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync, spawn } from 'child_process';
import { pythonBin } from './platform';
import { buildCtlPython } from './ctl-script';

let root: string;
let dir: string;
let pyFile: string;
let errFile: string;

let pythonAvailable: boolean | undefined;
function hasPython(): boolean {
  if (pythonAvailable === undefined) pythonAvailable = spawnSync(pythonBin, ['--version']).status === 0;
  return pythonAvailable;
}

function ctlEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { VIBEYARD_CTL_TOKEN: 'tok', VIBEYARD_CTL_DIR: dir, ...extra };
}

function run(args: string[], env: Record<string, string> = ctlEnv(), timeoutEnv = '2') {
  return spawnSync(pythonBin, [pyFile, ...args], {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', VIBEYARD_CTL_TIMEOUT: timeoutEnv, ...env },
    encoding: 'utf-8',
  });
}

// A fake server: answers each request with { ok: true, result: <the request> }.
function startResponder(): () => void {
  const timer = setInterval(() => {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json') || f.endsWith('.result.json')) continue;
      const full = path.join(dir, f);
      const body = JSON.parse(fs.readFileSync(full, 'utf-8'));
      fs.rmSync(full);
      const reqId = f.slice(0, -5);
      fs.writeFileSync(path.join(dir, `${reqId}.result.json`), JSON.stringify({ ok: true, result: body }));
    }
  }, 20);
  return () => clearInterval(timer);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-ctlpy-'));
  dir = path.join(root, 'commands', '4242-0a0b0c0d');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  pyFile = path.join(root, 'ctl.py');
  errFile = `${dir}.error`;
  fs.writeFileSync(pyFile, buildCtlPython());
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe.skipIf(!hasPython())('vibeyard-ctl client', () => {
  it('exits 1 with unauthorized when no token is in the environment', () => {
    fs.writeFileSync(path.join(dir, '.enabled'), '1');
    const r = run(['list'], ctlEnv({ VIBEYARD_CTL_TOKEN: '' }));
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).error.code).toBe('unauthorized');
  });

  it('exits 1 with unauthorized when no commands folder is in the environment', () => {
    fs.writeFileSync(path.join(dir, '.enabled'), '1');
    const r = run(['list'], ctlEnv({ VIBEYARD_CTL_DIR: '' }));
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).error).toEqual({
      code: 'unauthorized',
      message: 'vibeyard-ctl only works inside a Vibeyard tab (VIBEYARD_CTL_TOKEN/VIBEYARD_CTL_DIR not set)',
    });
  });

  it('answers disabled when its instance folder is gone (that Vibeyard quit or turned control off)', () => {
    const r = run(['list'], ctlEnv({ VIBEYARD_CTL_DIR: path.join(root, 'commands', '4243-0a0b0c0d') }));
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).error.code).toBe('disabled');
  });

  it('sends requests to the folder named by VIBEYARD_CTL_DIR only', () => {
    const other = path.join(root, 'commands', '4244-0a0b0c0d');
    fs.mkdirSync(other, { mode: 0o700 });
    fs.writeFileSync(path.join(other, '.enabled'), '1');
    fs.writeFileSync(path.join(dir, '.enabled'), '1');
    const r = run(['list'], undefined, '0.3');
    expect(JSON.parse(r.stdout).error.code).toBe('timeout');
    expect(fs.readdirSync(other)).toEqual(['.enabled']);
  });

  it('exits 1 with disabled when the app has external control off', () => {
    const r = run(['list']);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).error.code).toBe('disabled');
  });

  it('keeps the preferences message when external control is simply off', () => {
    const r = run(['list']);
    expect(JSON.parse(r.stdout).error).toEqual({ code: 'disabled', message: 'external control is disabled in Vibeyard preferences' });
  });

  it('reports why external control could not start when the app left a start-error file', () => {
    fs.rmSync(dir, { recursive: true });
    fs.writeFileSync(errFile, '/home/u/.vibeyard/commands is not a real directory');
    const r = run(['list']);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).error).toEqual({
      code: 'disabled',
      message: 'external control could not start: /home/u/.vibeyard/commands is not a real directory',
    });
  });

  it('ignores a start-error file while external control is running', () => {
    fs.writeFileSync(path.join(dir, '.enabled'), '1');
    fs.writeFileSync(errFile, 'stale');
    const r = run(['list'], undefined, '0.3');
    expect(JSON.parse(r.stdout).error.code).toBe('timeout');
  });

  it('falls back to the 10 s default for a non-numeric VIBEYARD_CTL_TIMEOUT instead of crashing', async () => {
    fs.writeFileSync(path.join(dir, '.enabled'), '1');
    const stop = startResponder();
    const r = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(pythonBin, [pyFile, 'list'], { env: { ...process.env, ...ctlEnv({ VIBEYARD_CTL_TIMEOUT: 'soon' }) } });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (status) => resolve({ status, stdout: out, stderr: err }));
    });
    stop();
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).result.command).toEqual({ action: 'list' });
  });

  it('--help tells Windows users to pass special characters via --prompt-file', () => {
    const r = run(['--help']);
    expect(r.status).toBe(0);
    const help = r.stdout.replace(/\s+/g, ' ');
    expect(help).toContain('--prompt-file');
    expect(help).toMatch(/Windows/);
    expect(help).toContain('%');
  });

  it('exits 2 with timeout and removes its own request when nobody answers', () => {
    fs.writeFileSync(path.join(dir, '.enabled'), '1');
    const r = run(['list'], undefined, '0.3');
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).error.code).toBe('timeout');
    expect(fs.readdirSync(dir)).toEqual(['.enabled']);
  });

  it('exits 1 with invalid_request on bad arguments (never argparse exit 2)', () => {
    fs.writeFileSync(path.join(dir, '.enabled'), '1');
    const r = run(['new-session']); // missing --name
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).error.code).toBe('invalid_request');
  });

  it('sends new-session fields verbatim, including quotes, newlines, unicode and shell metacharacters', async () => {
    fs.writeFileSync(path.join(dir, '.enabled'), '1');
    const stop = startResponder();
    const promptFile = path.join(root, 'p.md');
    const prompt = 'line1\n"quoted" $(rm -rf /) `x` ünï\n';
    fs.writeFileSync(promptFile, prompt);
    const r = await new Promise<{ status: number | null; stdout: string }>((resolve) => {
      const child = spawn(pythonBin, [pyFile, 'new-session', '--name', 'DR-1 bug "x"', '--prompt-file', promptFile, '--args', '--model sonnet', '--focus'], {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...ctlEnv() },
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('close', (status) => resolve({ status, stdout: out }));
    });
    stop();
    expect(r.status).toBe(0);
    const echoed = JSON.parse(r.stdout).result;
    expect(echoed).toEqual({ v: 1, token: 'tok', command: { action: 'new-session', name: 'DR-1 bug "x"', prompt, args: '--model sonnet', focus: true } });
  });

  it('rejects a prompt file over 64 KB before sending', () => {
    fs.writeFileSync(path.join(dir, '.enabled'), '1');
    const big = path.join(root, 'big.md');
    fs.writeFileSync(big, 'x'.repeat(64 * 1024 + 1));
    const r = run(['new-session', '--name', 'n', '--prompt-file', big]);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).error.code).toBe('invalid_request');
    expect(fs.readdirSync(dir)).toEqual(['.enabled']);
  });

  it('maps rename, close and list --mine to commands', async () => {
    fs.writeFileSync(path.join(dir, '.enabled'), '1');
    const stop = startResponder();
    const call = (args: string[]) => new Promise<unknown>((resolve) => {
      const child = spawn(pythonBin, [pyFile, ...args], { env: { ...process.env, ...ctlEnv() } });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('close', () => resolve(JSON.parse(out).result.command));
    });
    expect(await call(['rename', 's1', 'new name'])).toEqual({ action: 'rename', sessionId: 's1', name: 'new name' });
    expect(await call(['close', 's1'])).toEqual({ action: 'close', sessionId: 's1' });
    expect(await call(['list', '--mine'])).toEqual({ action: 'list', mine: true });
    stop();
  });

  it('keeps stdout pure ASCII so a non-UTF-8 stdout encoding (Windows pipes) cannot crash it', async () => {
    fs.writeFileSync(path.join(dir, '.enabled'), '1');
    const stop = startResponder();
    const name = 'ünï 日本 🚀';
    const env: Record<string, string | undefined> = { ...process.env, ...ctlEnv(), PYTHONIOENCODING: 'ascii' };
    const r = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(pythonBin, [pyFile, 'rename', 's1', name], { env: env as NodeJS.ProcessEnv });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (status) => resolve({ status, stdout: out, stderr: err }));
    });
    stop();
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^[\x00-\x7F]*$/);
    expect(JSON.parse(r.stdout).result.command.name).toBe(name);
  });
});
