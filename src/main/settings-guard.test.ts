import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
import { isWin } from './platform';

const SCRIPT_DIR = path.join('/home/test', '.vibeyard', 'run');
const STATUSLINE_SCRIPT = path.join(SCRIPT_DIR, isWin ? 'statusline.py' : 'statusline.sh');
const STATUSLINE_COMMAND = isWin ? `python "${STATUSLINE_SCRIPT}"` : STATUSLINE_SCRIPT;

vi.mock('os', () => ({
  tmpdir: () => '/tmp',
  homedir: () => '/home/test',
}));

vi.mock('electron', () => ({
  BrowserWindow: {},
  ipcMain: { on: vi.fn(), once: vi.fn(), removeListener: vi.fn() },
}));

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
  rmdirSync: vi.fn(),
  rmSync: vi.fn(),
  watch: vi.fn(),
}));

import { isVibeyardStatusLine } from './settings-guard';

describe('isVibeyardStatusLine', () => {
  it('returns true for current statusline command', () => {
    expect(isVibeyardStatusLine({ command: STATUSLINE_COMMAND })).toBe(true);
  });

  it('returns true for legacy tmp-dir statusline path (unix)', () => {
    expect(isVibeyardStatusLine({
      command: '/var/folders/_k/hyr0867141z9_6ghbmwh65g80000gn/T/vibeyard/statusline.sh',
    })).toBe(true);
  });

  it('returns true for legacy /tmp/vibeyard path', () => {
    expect(isVibeyardStatusLine({ command: '/tmp/vibeyard/statusline.sh' })).toBe(true);
  });

  it('returns true for legacy windows tmp-dir statusline path', () => {
    expect(isVibeyardStatusLine({
      command: 'C:\\Users\\test\\AppData\\Local\\Temp\\vibeyard\\statusline.cmd',
    })).toBe(true);
  });

  it('returns true for windows python-wrapped statusline command', () => {
    expect(isVibeyardStatusLine({
      command: 'python "C:\\Users\\test\\.vibeyard\\run\\statusline.py"',
    })).toBe(true);
  });

  it('returns true for unix python-wrapped statusline command', () => {
    expect(isVibeyardStatusLine({
      command: '/usr/bin/python3 "/home/test/.vibeyard/run/statusline.py"',
    })).toBe(true);
  });

  it('returns false for foreign statusline', () => {
    expect(isVibeyardStatusLine({ command: '/usr/local/bin/some-other-tool.sh' })).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isVibeyardStatusLine(null)).toBe(false);
    expect(isVibeyardStatusLine(undefined)).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(isVibeyardStatusLine('string')).toBe(false);
  });

  it('returns false for object without command', () => {
    expect(isVibeyardStatusLine({ url: 'http://example.com' })).toBe(false);
  });
});
