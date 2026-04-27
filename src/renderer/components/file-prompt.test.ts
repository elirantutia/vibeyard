import { describe, it, expect, vi } from 'vitest';

vi.mock('./tab-bar.js', () => ({ promptNewSession: vi.fn() }));
vi.mock('./terminal-pane.js', () => ({ setPendingPrompt: vi.fn() }));
vi.mock('./file-viewer.js', () => ({ getFileViewerInstance: vi.fn() }));
vi.mock('./file-reader.js', () => ({ getFileReaderInstance: vi.fn() }));
vi.mock('../state.js', () => ({ appState: { activeProject: null, addPlanSession: vi.fn() } }));

const { buildPrompt } = await import('./file-prompt.js');
type PaneContext = Parameters<typeof buildPrompt>[0];

const basePane = { paneEl: {} as HTMLElement, bodyEl: {} as HTMLElement, sessionId: 's1' };

describe('buildPrompt', () => {
  it('formats a diff snippet from the file viewer', () => {
    const ctx: PaneContext = {
      ...basePane,
      kind: 'file-viewer',
      filePath: 'src/foo.ts',
      selectedText: '-  old();\n+  new();',
    };
    expect(buildPrompt(ctx, 'Explain why this changed')).toBe(
      'Regarding the following diff snippet from `src/foo.ts`:\n\n```diff\n-  old();\n+  new();\n```\n\nExplain why this changed',
    );
  });

  it('formats a single-line range from raw file reader', () => {
    const ctx: PaneContext = {
      ...basePane,
      kind: 'file-reader',
      viewMode: 'raw',
      filePath: 'src/foo.ts',
      lineStart: 12,
      lineEnd: 12,
      selectedText: 'const x = 1;',
    };
    expect(buildPrompt(ctx, 'rename x')).toBe(
      'Regarding line 12 in `src/foo.ts`:\n\n```\nconst x = 1;\n```\n\nrename x',
    );
  });

  it('formats a multi-line range from raw file reader', () => {
    const ctx: PaneContext = {
      ...basePane,
      kind: 'file-reader',
      viewMode: 'raw',
      filePath: 'src/foo.ts',
      lineStart: 10,
      lineEnd: 14,
      selectedText: 'line1\nline2',
    };
    expect(buildPrompt(ctx, 'refactor')).toBe(
      'Regarding lines 10-14 in `src/foo.ts`:\n\n```\nline1\nline2\n```\n\nrefactor',
    );
  });

  it('quotes selected markdown text from rendered file reader', () => {
    const ctx: PaneContext = {
      ...basePane,
      kind: 'file-reader',
      viewMode: 'rendered',
      filePath: 'README.md',
      selectedText: 'para one\npara two',
    };
    expect(buildPrompt(ctx, 'clarify')).toBe(
      'Regarding the following text in `README.md`:\n\n> para one\n> para two\n\nclarify',
    );
  });

  it('falls back when no line numbers are available in raw view', () => {
    const ctx: PaneContext = {
      ...basePane,
      kind: 'file-reader',
      viewMode: 'raw',
      filePath: 'src/bar.ts',
      selectedText: 'snippet',
    };
    expect(buildPrompt(ctx, 'do thing')).toBe(
      'Regarding the following text in `src/bar.ts`:\n\n```\nsnippet\n```\n\ndo thing',
    );
  });
});
