// src/main/ctl-server.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { spawnSync } from 'child_process';
import { syncBuiltinESMExports } from 'module';
import * as fs from 'fs';
import fsDefault from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createCtlServer, type CtlServer } from './ctl-server';
import { isWin } from './platform';
import type { CtlCommand } from '../shared/ctl-protocol';

let root: string;
let dir: string;
let server: CtlServer | null;
let dispatched: Array<{ reqId: string; callerId: string; command: CtlCommand }>;
let clock: number;
let errFile: string;

const tokens: Record<string, string> = { 'good-token': 'caller-1' };

function make() {
  server = createCtlServer({
    commandsDir: dir,
    resolveToken: (t) => tokens[t],
    dispatch: (reqId, callerId, command) => dispatched.push({ reqId, callerId, command }),
    now: () => clock,
    pollMs: 60_000, // tests drive scan() directly
    startErrorPath: errFile,
  });
  return server;
}

function drop(reqId: string, body: unknown) {
  fs.writeFileSync(path.join(dir, `${reqId}.json`), typeof body === 'string' ? body : JSON.stringify(body));
}

function readResult(reqId: string) {
  return JSON.parse(fs.readFileSync(path.join(dir, `${reqId}.result.json`), 'utf-8'));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-ctl-'));
  dir = path.join(root, 'commands');
  errFile = path.join(root, 'bin', 'ctl-start-error');
  dispatched = [];
  clock = 1_000_000;
  server = null;
});

afterEach(() => {
  server?.stop();
  fs.rmSync(root, { recursive: true, force: true });
});

const listReq = { v: 1, token: 'good-token', command: { action: 'list' } };

describe('ctl server', () => {
  it('creates the folder 0700 and writes the .enabled marker on start; removes it on stop', () => {
    const s = make();
    expect(s.start()).toEqual({ ok: true });
    expect(fs.existsSync(path.join(dir, '.enabled'))).toBe(true);
    if (!isWin) expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    s.stop();
    expect(fs.existsSync(path.join(dir, '.enabled'))).toBe(false);
  });

  it.skipIf(isWin)('refuses to start when the folder is a symlink', () => {
    const real = path.join(root, 'real');
    fs.mkdirSync(real, { mode: 0o700 });
    fs.symlinkSync(real, dir);
    expect(make().start()).toMatchObject({ ok: false });
  });

  it.skipIf(isWin)('refuses to start when the folder is group/world accessible', () => {
    fs.mkdirSync(dir, { mode: 0o755 });
    fs.chmodSync(dir, 0o755);
    expect(make().start()).toMatchObject({ ok: false });
  });

  it('clears leftover requests and results on start', () => {
    fs.mkdirSync(dir, { mode: 0o700 });
    drop('stale-req-1', listReq);
    fs.writeFileSync(path.join(dir, 'stale-req-2.result.json'), '{}');
    make().start();
    expect(fs.readdirSync(dir).sort()).toEqual(['.enabled']);
  });

  it('dispatches a valid request with the caller id, deleting the request file', () => {
    const s = make(); s.start(); s.onRendererReady();
    drop('req-00000001', listReq);
    s.scan();
    expect(dispatched).toEqual([{ reqId: 'req-00000001', callerId: 'caller-1', command: { action: 'list' } }]);
    expect(fs.existsSync(path.join(dir, 'req-00000001.json'))).toBe(false);
  });

  it('handles a request exactly once even if scanned twice (watch + poll race)', () => {
    const s = make(); s.start(); s.onRendererReady();
    drop('req-00000002', listReq);
    s.scan(); s.scan();
    expect(dispatched).toHaveLength(1);
  });

  it('answers unauthorized for an unknown token without dispatching', () => {
    const s = make(); s.start(); s.onRendererReady();
    drop('req-00000003', { ...listReq, token: 'stale-token' });
    s.scan();
    expect(dispatched).toHaveLength(0);
    expect(readResult('req-00000003')).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
  });

  it('answers invalid_request for malformed JSON and for oversize files', () => {
    const s = make(); s.start(); s.onRendererReady();
    drop('req-00000004', '{nope');
    drop('req-00000005', JSON.stringify({ ...listReq, pad: 'x'.repeat(130 * 1024) }));
    s.scan();
    expect(readResult('req-00000004').error.code).toBe('invalid_request');
    expect(readResult('req-00000005').error.code).toBe('invalid_request');
    expect(dispatched).toHaveLength(0);
  });

  it('ignores .tmp files, result files and names that are not request ids', () => {
    const s = make(); s.start(); s.onRendererReady();
    fs.writeFileSync(path.join(dir, 'req-00000006.json.tmp'), JSON.stringify(listReq));
    // A result file holding a perfectly valid request body must still not be taken as a request.
    fs.writeFileSync(path.join(dir, 'req-00000030.result.json'), JSON.stringify(listReq));
    drop('bad id!', listReq);
    s.scan();
    expect(dispatched).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, 'req-00000006.json.tmp'))).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'req-00000030.result.json'), 'utf-8')).toBe(JSON.stringify(listReq));
    expect(fs.existsSync(path.join(dir, 'bad id!.json'))).toBe(true);
  });

  it('holds requests until the renderer is ready, then dispatches; drops ones older than 8 s (before the 10 s client gives up)', () => {
    const s = make(); s.start();
    drop('req-00000007', listReq);
    s.scan();
    expect(dispatched).toHaveLength(0);
    clock += 8_500;
    drop('req-00000008', listReq);
    s.scan();
    s.onRendererReady();
    expect(dispatched.map((d) => d.reqId)).toEqual(['req-00000008']);
    expect(readResult('req-00000007')).toMatchObject({ ok: false, error: { code: 'timeout' } });
  });

  it('writes results atomically with mode 0600', () => {
    const s = make(); s.start(); s.onRendererReady();
    drop('req-00000009', listReq);
    s.scan();
    s.reply('req-00000009', { ok: true, result: [] });
    expect(readResult('req-00000009')).toEqual({ ok: true, result: [] });
    expect(fs.existsSync(path.join(dir, 'req-00000009.result.json.tmp'))).toBe(false);
    if (!isWin) expect(fs.statSync(path.join(dir, 'req-00000009.result.json')).mode & 0o777).toBe(0o600);
  });

  it('ignores replies for request ids it never dispatched', () => {
    const s = make(); s.start(); s.onRendererReady();
    s.reply('never-dispatched', { ok: true, result: 1 });
    expect(fs.existsSync(path.join(dir, 'never-dispatched.result.json'))).toBe(false);
  });

  it('sweeps result files older than 60 s', () => {
    const s = make(); s.start(); s.onRendererReady();
    drop('req-00000010', listReq);
    s.scan();
    s.reply('req-00000010', { ok: true, result: [] });
    const old = (clock - 61_000) / 1000;
    fs.utimesSync(path.join(dir, 'req-00000010.result.json'), old, old);
    s.sweep();
    expect(fs.existsSync(path.join(dir, 'req-00000010.result.json'))).toBe(false);
  });

  it('turning off drops queued requests: they never execute and their files are gone', () => {
    const s = make(); s.start();
    drop('req-00000011', listReq);
    s.scan();          // queued (renderer not ready)
    drop('req-00000012', listReq); // not yet scanned
    s.stop();
    s.onRendererReady();
    expect(dispatched).toHaveLength(0);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.json'))).toEqual([]);
  });

  it('a stopped server does nothing on scan', () => {
    const s = make();
    fs.mkdirSync(dir, { mode: 0o700 });
    drop('req-00000013', listReq);
    s.scan();
    expect(dispatched).toHaveLength(0);
  });

  it.skipIf(isWin)('does not follow planted symlinks when writing a result', () => {
    const s = make(); s.start(); s.onRendererReady();
    const victim = path.join(root, 'victim.txt');
    fs.writeFileSync(victim, 'precious');
    drop('req-00000020', listReq);
    s.scan();
    fs.symlinkSync(victim, path.join(dir, 'req-00000020.result.json.tmp'));
    fs.symlinkSync(victim, path.join(dir, 'req-00000020.result.json'));
    s.reply('req-00000020', { ok: true, result: [1] });
    expect(fs.readFileSync(victim, 'utf-8')).toBe('precious');
    const final = path.join(dir, 'req-00000020.result.json');
    expect(fs.lstatSync(final).isFile()).toBe(true);
    expect(fs.statSync(final).mode & 0o777).toBe(0o600);
    expect(readResult('req-00000020')).toEqual({ ok: true, result: [1] });
  });

  it.skipIf(isWin)('does not dispatch a request file that is a symlink', () => {
    const s = make(); s.start(); s.onRendererReady();
    const outside = path.join(root, 'outside.json');
    fs.writeFileSync(outside, JSON.stringify(listReq));
    fs.symlinkSync(outside, path.join(dir, 'req-00000021.json'));
    s.scan();
    expect(dispatched).toHaveLength(0);
    expect(fs.existsSync(outside)).toBe(true);
  });

  it.skipIf(isWin)('does not block on a FIFO named like a request', () => {
    const s = make(); s.start(); s.onRendererReady();
    const mk = spawnSync('mkfifo', [path.join(dir, 'req-00000022.json')]);
    if (mk.status !== 0) return; // mkfifo unavailable
    s.scan();
    expect(dispatched).toHaveLength(0);
  });

  it('survives a watcher error and keeps scanning', () => {
    const fake = Object.assign(new EventEmitter(), { close: vi.fn() });
    const spy = vi.spyOn(fsDefault, 'watch').mockReturnValue(fake as unknown as fs.FSWatcher);
    syncBuiltinESMExports();
    try {
      const s = make(); s.start(); s.onRendererReady();
      expect(() => fake.emit('error', new Error('boom'))).not.toThrow();
      expect(fake.close).toHaveBeenCalled();
      drop('req-00000023', listReq);
      s.scan();
      expect(dispatched).toHaveLength(1);
    } finally { spy.mockRestore(); syncBuiltinESMExports(); }
  });

  describe('start-error status file', () => {
    it.skipIf(isWin)('writes the start failure reason (mode 0600) and clears it on a later successful start', () => {
      const real = path.join(root, 'real');
      fs.mkdirSync(real, { mode: 0o700 });
      fs.symlinkSync(real, dir);
      const s = make();
      const r = s.start();
      expect(r).toMatchObject({ ok: false });
      expect(fs.readFileSync(errFile, 'utf-8')).toBe((r as { reason: string }).reason);
      expect(fs.statSync(errFile).mode & 0o777).toBe(0o600);
      expect(fs.readdirSync(path.dirname(errFile))).toEqual(['ctl-start-error']); // no temp file left behind
      fs.unlinkSync(dir); // drop the symlink; start() then creates a real folder
      expect(s.start()).toEqual({ ok: true });
      expect(fs.existsSync(errFile)).toBe(false);
    });

    it('removes a leftover start-error file on stop', () => {
      fs.mkdirSync(path.dirname(errFile), { recursive: true });
      fs.writeFileSync(errFile, 'old reason');
      make().stop();
      expect(fs.existsSync(errFile)).toBe(false);
    });
  });

  describe('stop() on a folder it never validated', () => {
    it.skipIf(isWin)('does not clean files or the marker through a symlinked commands folder', () => {
      const userDir = path.join(root, 'user-folder');
      fs.mkdirSync(userDir);
      fs.writeFileSync(path.join(userDir, 'notes.json'), 'keep me');
      fs.writeFileSync(path.join(userDir, 'draft.tmp'), 'keep me too');
      fs.writeFileSync(path.join(userDir, '.enabled'), 'not ours');
      fs.symlinkSync(userDir, dir);
      make().stop();
      expect(fs.readdirSync(userDir).sort()).toEqual(['.enabled', 'draft.tmp', 'notes.json']);
    });

    it.skipIf(isWin)('does not clean a group/world-accessible folder it never ran in', () => {
      fs.mkdirSync(dir, { mode: 0o755 });
      fs.chmodSync(dir, 0o755);
      fs.writeFileSync(path.join(dir, 'data.json'), 'keep');
      make().stop();
      expect(fs.existsSync(path.join(dir, 'data.json'))).toBe(true);
    });

    it('does not create the folder', () => {
      make().stop();
      expect(fs.existsSync(dir)).toBe(false);
    });

    it('still cleans a safe folder, e.g. leftovers from a crash', () => {
      fs.mkdirSync(dir, { mode: 0o700 });
      fs.writeFileSync(path.join(dir, '.enabled'), '123');
      drop('req-00000031', listReq);
      make().stop();
      expect(fs.readdirSync(dir)).toEqual([]);
    });
  });
});
