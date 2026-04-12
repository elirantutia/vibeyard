import { describe, it, expect } from 'vitest';
import { resolveCliSessionPtyCwd } from './session-pty-cwd.js';

describe('resolveCliSessionPtyCwd', () => {
  const root = '/repo/main';

  it('uses project path for CLI session without gitWorktreePath', () => {
    expect(resolveCliSessionPtyCwd(root, {})).toBe(root);
  });

  it('uses trimmed gitWorktreePath for CLI session', () => {
    expect(resolveCliSessionPtyCwd(root, { gitWorktreePath: '  /repo/wt-feature  ' })).toBe('/repo/wt-feature');
  });

  it('falls back to project path when gitWorktreePath is only whitespace', () => {
    expect(resolveCliSessionPtyCwd(root, { gitWorktreePath: '   ' })).toBe(root);
  });

  it('ignores gitWorktreePath when session has a special type', () => {
    expect(resolveCliSessionPtyCwd(root, { type: 'mcp-inspector', gitWorktreePath: '/repo/wt' })).toBe(root);
    expect(resolveCliSessionPtyCwd(root, { type: 'diff-viewer', gitWorktreePath: '/repo/wt' })).toBe(root);
  });
});
