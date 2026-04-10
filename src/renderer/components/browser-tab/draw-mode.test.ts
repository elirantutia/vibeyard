import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserTabInstance } from './types.js';

vi.mock('../../state.js', () => ({ appState: {} }));
vi.mock('../tab-bar.js', () => ({ promptNewSession: vi.fn() }));
vi.mock('../terminal-pane.js', () => ({ setPendingPrompt: vi.fn() }));
vi.mock('./popover.js', () => ({ positionPopover: vi.fn() }));
vi.mock('./viewport.js', () => ({
  getViewportContext: (_inst: unknown, include: boolean) =>
    include ? ' [viewport: 1024×768 – Desktop]' : '',
}));

function makeStubInstance(overrides: Partial<Record<string, unknown>> = {}): BrowserTabInstance {
  return {
    drawInstructionInput: { value: 'Fix the button' } as HTMLTextAreaElement,
    urlInput: { value: 'https://example.com' } as HTMLInputElement,
    drawAttachDimsCheckbox: { checked: false } as HTMLInputElement,
    ...overrides,
  } as unknown as BrowserTabInstance;
}

describe('buildDrawPrompt', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('uses newlines on macOS', async () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    const { buildDrawPrompt } = await import('./draw-mode.js');
    const instance = makeStubInstance();
    const result = buildDrawPrompt(instance, '/tmp/screenshot.png');
    expect(result).toBe(
      'Regarding the page at https://example.com:\n' +
      'See annotated screenshot: /tmp/screenshot.png\n' +
      'Fix the button'
    );
    vi.unstubAllGlobals();
  });

  it('uses pipe separators on Windows to avoid cmd.exe newline truncation', async () => {
    vi.stubGlobal('navigator', { platform: 'Win32' });
    const { buildDrawPrompt } = await import('./draw-mode.js');
    const instance = makeStubInstance();
    const result = buildDrawPrompt(instance, 'C:\\Users\\test\\AppData\\Local\\Temp\\screenshot.png');
    expect(result).not.toContain('\n');
    expect(result).toContain('See annotated screenshot: C:\\Users\\test\\AppData\\Local\\Temp\\screenshot.png');
    expect(result).toContain('Fix the button');
    expect(result).toContain('https://example.com');
    vi.unstubAllGlobals();
  });

  it('includes viewport context when checkbox is checked', async () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    const { buildDrawPrompt } = await import('./draw-mode.js');
    const instance = makeStubInstance({ drawAttachDimsCheckbox: { checked: true } as HTMLInputElement });
    const result = buildDrawPrompt(instance, '/tmp/shot.png');
    expect(result).toContain('[viewport: 1024×768 – Desktop]');
    vi.unstubAllGlobals();
  });
});
