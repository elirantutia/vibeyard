import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { ctlInvocation, forwardResult } = require('../../bin/ctl-forward.js');

describe('ctlInvocation', () => {
  it('invokes python on ctl.py directly (no shell)', () => {
    expect(ctlInvocation('/home/u', false)).toEqual({ command: '/usr/bin/python3', script: '/home/u/.vibeyard/run/bin/ctl.py' });
    expect(ctlInvocation('C:\\Users\\u', true).command).toBe('python');
  });
});

describe('forwardResult', () => {
  it('reports a spawn error as a timeout JSON and exits 2', () => {
    const r = forwardResult({ status: null, error: new Error('spawn python ENOENT') }, 'python');
    expect(r.code).toBe(2);
    expect(JSON.parse(r.output)).toEqual({ ok: false, error: { code: 'timeout', message: 'cannot run python: spawn python ENOENT' } });
  });

  it('passes a normal exit status through without output', () => {
    expect(forwardResult({ status: 1 }, 'python')).toEqual({ code: 1 });
    expect(forwardResult({ status: 0 }, 'python')).toEqual({ code: 0 });
  });

  it('exits 2 with no output when killed by a signal', () => {
    const r = forwardResult({ status: null, signal: 'SIGTERM' }, 'python');
    expect(r).toEqual({ code: 2 });
    expect(r.output).toBeUndefined();
  });
});
