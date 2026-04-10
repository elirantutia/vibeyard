import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as child_process from 'child_process';

vi.mock('./store', () => ({
  loadState: vi.fn(() => ({
    version: 1,
    projects: [],
    activeProjectId: null,
    preferences: { wslEnabled: true, wslDistro: 'Ubuntu' },
  })),
}));

vi.mock('./wsl', () => ({
  getEffectiveDistro: vi.fn(() => 'Ubuntu'),
}));

vi.mock('./platform', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./platform')>();
  return {
    ...mod,
    isWin: true,
    isWslMode: vi.fn(() => true),
  };
});

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    execFileSync: vi.fn(),
    execSync: vi.fn(),
  };
});

import { checkPythonAvailable } from './prerequisites';

describe('checkPythonAvailable (WSL mode)', () => {
  beforeEach(() => {
    vi.mocked(child_process.execFileSync).mockReset();
    vi.mocked(child_process.execSync).mockReset();
  });

  it('returns null when python3 works in WSL', () => {
    vi.mocked(child_process.execFileSync).mockReturnValue('Python 3.12.0');
    expect(checkPythonAvailable()).toBeNull();
    expect(child_process.execFileSync).toHaveBeenCalledWith(
      'wsl.exe',
      ['-d', 'Ubuntu', '--', 'python3', '--version'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('falls back to /usr/bin/python3 when python3 fails', () => {
    vi.mocked(child_process.execFileSync)
      .mockImplementationOnce(() => {
        throw new Error('missing');
      })
      .mockReturnValueOnce('Python 3.12.0');
    expect(checkPythonAvailable()).toBeNull();
    expect(child_process.execFileSync).toHaveBeenCalledTimes(2);
    expect(child_process.execFileSync).toHaveBeenLastCalledWith(
      'wsl.exe',
      ['-d', 'Ubuntu', '--', '/usr/bin/python3', '--version'],
      expect.any(Object),
    );
  });

  it('returns help when both interpreters are missing', () => {
    vi.mocked(child_process.execFileSync).mockImplementation(() => {
      throw new Error('missing');
    });
    const msg = checkPythonAvailable();
    expect(msg).toContain('Python 3 not found in WSL');
  });
});
