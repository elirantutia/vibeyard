import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';

vi.mock('fs');
vi.mock('child_process');

import { validatePrerequisites } from './prerequisites';
import { isWin } from './platform';

describe('validatePrerequisites', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns ok when a candidate path exists', () => {
    const candidatePath = isWin
      ? path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd')
      : '/usr/local/bin/claude';

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return p === candidatePath;
    });

    const result = validatePrerequisites();
    expect(result.ok).toBe(true);
  });

  it('returns ok when claude is found on the augmented PATH', () => {
    const oldPath = process.env.PATH;
    try {
      // Give the PATH fallback a dir to search that no hardcoded candidate uses,
      // then make existsSync succeed only for a `claude` binary in that dir.
      process.env.PATH = path.join(os.tmpdir(), 'vibeyard-prefix');
      const found = path.join(os.tmpdir(), 'vibeyard-prefix', 'claude');
      vi.mocked(fs.existsSync).mockImplementation((p) => String(p) === found);

      const result = validatePrerequisites();
      expect(result.ok).toBe(true);
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it('returns not ok with message when nothing found', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(child_process.execSync).mockImplementation(() => {
      throw new Error('not found');
    });

    const result = validatePrerequisites();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Claude CLI not found');
    expect(result.message).toContain('npm install -g @anthropic-ai/claude-code');
    // The PATH fallback walks directories in Node — it must not shell out to
    // `where`/`which`, whose "not found" output is localized (GBK) and garbles
    // the terminal on Chinese Windows.
    expect(child_process.execSync).not.toHaveBeenCalled();
  });
});
