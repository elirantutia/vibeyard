import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';

vi.mock('fs');
vi.mock('child_process');

import { validatePrerequisites } from './prerequisites';

const isWin = process.platform === 'win32';

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

  it('returns ok when which finds claude', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(child_process.execSync).mockReturnValue('/some/other/path/claude\n');

    const result = validatePrerequisites();
    expect(result.ok).toBe(true);
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
  });
});
