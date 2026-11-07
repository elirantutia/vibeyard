import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  shQuote,
  shQuotePath,
  isValidSshHost,
  remoteLayout,
  buildRemoteClaudeCommand,
  pathReplacements,
  applyReplacements,
  translateHookCommand,
  translateHooks,
  parseMirrorLine,
  MIRROR_PY,
  parseSshConfig,
  listSshHosts,
  buildStatusLineChainPython,
  buildEnvScript,
  remoteEnvFile,
  isMirrorFileFor,
} from './remote-ssh';
import { pythonBin } from './platform';

const pythonAvailable = spawnSync(pythonBin, ['-c', 'pass']).status === 0;

describe('shQuote / shQuotePath', () => {
  it('single-quotes and escapes embedded quotes', () => {
    expect(shQuote('a b')).toBe(`'a b'`);
    expect(shQuote(`it's`)).toBe(`'it'\\''s'`);
  });

  it('keeps a leading tilde expandable', () => {
    expect(shQuotePath('~')).toBe('"$HOME"');
    expect(shQuotePath('~/my repo')).toBe(`"$HOME"/'my repo'`);
    expect(shQuotePath('/srv/x')).toBe(`'/srv/x'`);
  });
});

describe('isValidSshHost', () => {
  it('accepts aliases and user@host', () => {
    expect(isValidSshHost('dev-linux')).toBe(true);
    expect(isValidSshHost('raphael@10.0.0.2')).toBe(true);
  });

  it('rejects options and shell metacharacters', () => {
    expect(isValidSshHost('-oProxyCommand=x')).toBe(false);
    expect(isValidSshHost('host;rm')).toBe(false);
    expect(isValidSshHost('a b')).toBe(false);
    expect(isValidSshHost('')).toBe(false);
  });
});

describe('remoteLayout', () => {
  it('places everything under ~/.vibeyard/remote', () => {
    expect(remoteLayout('h', '/home/u/')).toEqual({
      host: 'h',
      home: '/home/u/',
      scriptDir: '/home/u/.vibeyard/remote/run',
      statusDir: '/home/u/.vibeyard/remote/status',
      envDir: '/home/u/.vibeyard/remote/env',
      settingsPath: '/home/u/.vibeyard/remote/settings.json',
    });
  });
});

describe('buildRemoteClaudeCommand', () => {
  it('sets the session id, cds into the project and passes --settings first', () => {
    const cmd = buildRemoteClaudeCommand({
      sessionId: 'sid-1',
      remotePath: '/home/u/my repo',
      settingsPath: '/home/u/.vibeyard/remote/settings.json',
      claudeArgs: ['-r', 'abc', `it's`],
    });
    expect(cmd.startsWith(`exec env CLAUDE_IDE_SESSION_ID='sid-1' bash -lc `)).toBe(true);
    // The inner script, once the outer single-quoting is undone:
    const inner = cmd.slice(cmd.indexOf('bash -lc ') + 'bash -lc '.length);
    const unquoted = inner.slice(1, -1).split(`'\\''`).join(`'`);
    expect(unquoted).toBe(
      `cd '/home/u/my repo' && exec claude '--settings' '/home/u/.vibeyard/remote/settings.json' '-r' 'abc' 'it'\\''s'`,
    );
  });

  it.runIf(process.platform !== 'win32' && spawnSync('bash', ['-c', 'true']).status === 0)(
    'round-trips through a real shell',
    () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-remote-'));
      try {
        const bin = path.join(tmp, 'claude');
        fs.writeFileSync(bin, '#!/bin/sh\nprintf "%s|" "$CLAUDE_IDE_SESSION_ID" "$PWD" "$@"\n', { mode: 0o755 });
        const cmd = buildRemoteClaudeCommand({ sessionId: 's', remotePath: tmp, settingsPath: '/x.json', claudeArgs: [`a b`, `c'd`] })
          .replace('exec bash -lc', 'exec bash -c');
        const res = spawnSync('bash', ['-c', cmd], { env: { ...process.env, PATH: `${tmp}:${process.env.PATH}` }, encoding: 'utf-8' });
        expect(res.stdout).toBe(`s|${fs.realpathSync(tmp)}|--settings|/x.json|a b|c'd|`);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  );
});

describe('buildRemoteClaudeCommand env', () => {
  const unquote = (cmd: string) => {
    const inner = cmd.slice(cmd.indexOf('bash -lc ') + 'bash -lc '.length);
    return inner.slice(1, -1).split(`'\\''`).join(`'`);
  };

  it('sources and deletes the env file inside the login shell, before cd', () => {
    const cmd = buildRemoteClaudeCommand({ sessionId: 's', remotePath: '/p', settingsPath: '/x.json', claudeArgs: [], envFile: '/h/env/s.sh' });
    expect(unquote(cmd)).toBe(`. '/h/env/s.sh'; rc=$?; rm -f '/h/env/s.sh'; [ "$rc" = 0 ] && cd '/p' && exec claude '--settings' '/x.json'`);
  });

  it('never puts env values on the command line', () => {
    const cmd = buildRemoteClaudeCommand({ sessionId: 's', remotePath: '/p', settingsPath: '/x.json', claudeArgs: [], envFile: '/h/env/s.sh' });
    expect(cmd).not.toContain('export');
  });

  it('has no env prelude without an env file', () => {
    const cmd = buildRemoteClaudeCommand({ sessionId: 's', remotePath: '/p', settingsPath: '/x.json', claudeArgs: [] });
    expect(unquote(cmd)).toBe(`cd '/p' && exec claude '--settings' '/x.json'`);
  });

  it.runIf(process.platform !== 'win32' && spawnSync('bash', ['-c', 'true']).status === 0)('runs claude with the env loaded and removes the file', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-env-'));
    const envFile = path.join(tmp, 's.sh');
    fs.writeFileSync(envFile, buildEnvScript({ FOO: `a b'c` }));
    fs.writeFileSync(path.join(tmp, 'claude'), '#!/bin/sh\nprintf %s "$FOO"\n', { mode: 0o755 });
    const cmd = buildRemoteClaudeCommand({ sessionId: 's', remotePath: tmp, settingsPath: '/x.json', claudeArgs: [], envFile });
    const res = spawnSync('bash', ['-c', cmd], { env: { ...process.env, PATH: `${tmp}:${process.env.PATH}` }, encoding: 'utf-8' });
    expect(res.stdout).toBe(`a b'c`);
    expect(fs.existsSync(envFile)).toBe(false);
  });
});

describe('buildEnvScript / remoteEnvFile', () => {
  it('quotes values and drops names that are not shell identifiers', () => {
    expect(buildEnvScript({ FOO: `a b'c`, 'BAD;rm': 'x', OK: 'y' })).toBe(`export FOO='a b'\\''c'\nexport OK='y'\n`);
    expect(buildEnvScript({})).toBe('');
  });

  it('places the env file in env/ next to settings.json', () => {
    expect(remoteEnvFile(remoteLayout('h', '/home/u'), 'abc-1')).toBe('/home/u/.vibeyard/remote/env/abc-1.sh');
  });

  it('rejects session ids that could escape the env dir', () => {
    const info = remoteLayout('h', '/home/u');
    expect(() => remoteEnvFile(info, '../x')).toThrow();
    expect(() => remoteEnvFile(info, 'a/b')).toThrow();
  });
});

describe('isMirrorFileFor', () => {
  const sessions = new Set(['abc-1']);
  it('accepts status files of watched sessions only', () => {
    expect(isMirrorFileFor('abc-1.status', sessions)).toBe(true);
    expect(isMirrorFileFor('abc-1.events', sessions)).toBe(true);
    expect(isMirrorFileFor('other.status', sessions)).toBe(false);
    expect(isMirrorFileFor('abc-1x.status', sessions)).toBe(false);
    expect(isMirrorFileFor('abc-1.sh', sessions)).toBe(false);
    expect(isMirrorFileFor('abc-1-1712345.toolfailure', sessions)).toBe(true);
    expect(isMirrorFileFor('other-1712345.toolfailure', sessions)).toBe(false);
    expect(isMirrorFileFor('abc-1-9.status', sessions)).toBe(false);
  });
});

describe('path translation', () => {
  const local = { scriptDir: 'C:\\Users\\R\\.vibeyard\\run', statusDir: 'C:\\Users\\R\\AppData\\Local\\Temp\\vibeyard' };
  const remote = { scriptDir: '/home/u/.vibeyard/remote/run', statusDir: '/home/u/.vibeyard/remote/status' };
  const pairs = pathReplacements(local, remote);

  it('rewrites a Windows hook command, including the python binary', () => {
    const cmd = `python "C:/Users/R/.vibeyard/run/status_writer.py" "Stop" "completed" "CLAUDE_IDE_SESSION_ID" "C:/Users/R/AppData/Local/Temp/vibeyard" "# vibeyard-hook"`;
    expect(translateHookCommand(cmd, pairs, 'python')).toBe(
      `python3 "/home/u/.vibeyard/remote/run/status_writer.py" "Stop" "completed" "CLAUDE_IDE_SESSION_ID" "/home/u/.vibeyard/remote/status" "# vibeyard-hook"`,
    );
  });

  it('rewrites a POSIX sh -c status command', () => {
    const posixPairs = pathReplacements({ scriptDir: '/Users/r/.vibeyard/run', statusDir: '/tmp/vibeyard' }, remote);
    const cmd = `sh -c 'mkdir -p /tmp/vibeyard && echo Stop:completed > /tmp/vibeyard/$CLAUDE_IDE_SESSION_ID.status # vibeyard-hook'`;
    expect(translateHookCommand(cmd, posixPairs, '/usr/bin/python3')).toBe(
      `sh -c 'mkdir -p /home/u/.vibeyard/remote/status && echo Stop:completed > /home/u/.vibeyard/remote/status/$CLAUDE_IDE_SESSION_ID.status # vibeyard-hook'`,
    );
  });

  it('rewrites a status dir embedded as a JSON/Python literal', () => {
    const py = `status_dir=${JSON.stringify(local.statusDir)}\n`;
    expect(applyReplacements(py, pairs)).toBe(`status_dir="/home/u/.vibeyard/remote/status"\n`);
  });

  it('translates every command in a hooks config, keeping other fields', () => {
    const hooks = {
      SessionEnd: [{ matcher: '', hooks: [{ type: 'command', command: `python "C:/Users/R/.vibeyard/run/x.py" "# vibeyard-hook"`, timeout: 5 }] }],
    };
    expect(translateHooks(hooks, pairs, 'python')).toEqual({
      SessionEnd: [{ matcher: '', hooks: [{ type: 'command', command: `python3 "/home/u/.vibeyard/remote/run/x.py" "# vibeyard-hook"`, timeout: 5 }] }],
    });
  });
});

describe('parseMirrorLine', () => {
  it('accepts well-formed messages', () => {
    expect(parseMirrorLine('{"op":"ready"}')).toEqual({ op: 'ready' });
    expect(parseMirrorLine('{"op":"w","f":"abc-1.status","b":"eA=="}')).toEqual({ op: 'w', f: 'abc-1.status', b: 'eA==' });
    expect(parseMirrorLine('{"op":"d","f":"abc.cost"}')).toEqual({ op: 'd', f: 'abc.cost' });
  });

  it('rejects traversal, unknown extensions and garbage', () => {
    expect(parseMirrorLine('{"op":"w","f":"../evil.status","b":""}')).toBeNull();
    expect(parseMirrorLine('{"op":"w","f":"a/b.status","b":""}')).toBeNull();
    expect(parseMirrorLine('{"op":"w","f":"x.sh","b":""}')).toBeNull();
    expect(parseMirrorLine('{"op":"w","f":"x.status"}')).toBeNull();
    expect(parseMirrorLine('{"op":"x","f":"x.status","b":""}')).toBeNull();
    expect(parseMirrorLine('not json')).toBeNull();
  });
});

describe.runIf(pythonAvailable)('mirror.py (executed)', () => {
  it('resets, streams writes/appends/deletes for watched sessions only', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-mirror-'));
    const script = path.join(tmp, 'mirror.py');
    const dir = path.join(tmp, 'status');
    fs.writeFileSync(script, MIRROR_PY);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'sid1.status'), 'Stop:completed'); // stale, must be reset
    fs.writeFileSync(path.join(dir, 'other.status'), 'x'); // not watched

    const child = spawn(pythonBin, ['-u', script, dir]);
    const msgs: Array<{ op: string; f?: string; b?: string }> = [];
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) !== -1) {
        const m = parseMirrorLine(buf.slice(0, i).trim());
        buf = buf.slice(i + 1);
        if (m) msgs.push(m);
      }
    });
    const waitFor = async (pred: () => boolean) => {
      for (let i = 0; i < 80 && !pred(); i++) await new Promise((r) => setTimeout(r, 50));
      expect(pred()).toBe(true);
    };
    const decoded = (f: string) =>
      msgs.filter((m) => m.f === f && m.op !== 'd').map((m) => `${m.op}:${Buffer.from(m.b ?? '', 'base64').toString()}`);

    try {
      await waitFor(() => msgs.some((m) => m.op === 'ready'));
      child.stdin.write('reset sid1\n');
      await waitFor(() => !fs.existsSync(path.join(dir, 'sid1.status')));

      fs.writeFileSync(path.join(dir, 'sid1.status'), 'UserPromptSubmit:working');
      await waitFor(() => decoded('sid1.status').length === 1);
      expect(decoded('sid1.status')).toEqual(['w:UserPromptSubmit:working']);

      fs.writeFileSync(path.join(dir, 'sid1.events'), '{"a":1}\n');
      await waitFor(() => decoded('sid1.events').length === 1);
      fs.appendFileSync(path.join(dir, 'sid1.events'), '{"a":2}\n');
      await waitFor(() => decoded('sid1.events').length === 2);
      expect(decoded('sid1.events')).toEqual(['w:{"a":1}\n', 'a:{"a":2}\n']);

      fs.rmSync(path.join(dir, 'sid1.status'));
      await waitFor(() => msgs.some((m) => m.op === 'd' && m.f === 'sid1.status'));

      expect(msgs.some((m) => m.f === 'other.status')).toBe(false);
    } finally {
      child.stdin.end();
      await new Promise((r) => child.once('close', r));
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 15_000);
});

describe('parseSshConfig', () => {
  it('collects concrete hosts with their HostName/User/Port', () => {
    const cfg = [
      '# comment',
      'Host dev-linux',
      '    HostName dev-linux.example.net',
      '    User raphael',
      'Host dev-linux-lan other',
      '    HostName=192.168.1.2',
      '    Port 2222',
      'Host *',
      '    ServerAliveInterval 30',
      'Host bitbucket.org',
      '    User git',
      'Include conf.d/*',
    ].join('\n');
    const { hosts, includes } = parseSshConfig(cfg);
    expect(hosts).toEqual([
      { alias: 'dev-linux', hostName: 'dev-linux.example.net', user: 'raphael' },
      { alias: 'dev-linux-lan', hostName: '192.168.1.2', port: '2222' },
      { alias: 'other', hostName: '192.168.1.2', port: '2222' },
    ]);
    expect(includes).toEqual(['conf.d/*']);
  });
});

describe('listSshHosts', () => {
  it('follows Include globs relative to the config dir and de-duplicates', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-sshcfg-'));
    try {
      fs.mkdirSync(path.join(tmp, 'conf.d'));
      fs.writeFileSync(path.join(tmp, 'config'), 'Include conf.d/*.conf\nHost a\n  HostName a.example\n');
      fs.writeFileSync(path.join(tmp, 'conf.d', 'x.conf'), 'Host b\nHost a\n  HostName ignored\n');
      expect(listSshHosts(path.join(tmp, 'config')).map((h) => [h.alias, h.hostName])).toEqual([
        ['b', undefined],
        ['a', 'ignored'],
      ]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns [] when there is no config', () => {
    expect(listSshHosts(path.join(os.tmpdir(), 'definitely-missing', 'config'))).toEqual([]);
  });
});

describe.runIf(pythonAvailable)('statusline_chain.py (executed)', () => {
  it("runs Vibeyard's statusline silently, then prints the user's own statusLine output", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-chain-'));
    try {
      const status = path.join(tmp, 'status');
      const cfg = path.join(tmp, 'cfg');
      fs.mkdirSync(status);
      fs.mkdirSync(cfg);
      // Stand-in for Vibeyard's statusline.py: records its stdin, prints noise that must be swallowed.
      fs.writeFileSync(path.join(tmp, 'statusline.py'), `import sys\nopen(${JSON.stringify(path.join(status, 'seen.txt'))},'w').write(sys.stdin.read())\nprint('SHOULD-NOT-SHOW')\n`);
      const userScript = path.join(tmp, 'user.py');
      fs.writeFileSync(userScript, `import sys,json\nprint('USER:'+json.load(sys.stdin)['model'])\n`);
      fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: `${pythonBin} "${userScript}"` } }));
      const chain = path.join(tmp, 'statusline_chain.py');
      fs.writeFileSync(chain, buildStatusLineChainPython(status));

      const res = spawnSync(pythonBin, [chain], { input: '{"model":"opus"}', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg }, encoding: 'utf-8' });
      expect(res.stdout.trim()).toBe('USER:opus');
      expect(fs.readFileSync(path.join(status, 'seen.txt'), 'utf-8')).toBe('{"model":"opus"}');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
