import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attachClipboardCopyHandler } from './terminal-utils.js';

const mockClipboardWrite = vi.fn();

class FakeTerminal {
  private keyHandler: ((e: KeyboardEvent) => boolean) | null = null;
  private _selection = '';

  attachCustomKeyEventHandler(handler: (e: KeyboardEvent) => boolean): void {
    this.keyHandler = handler;
  }
  simulateKey(event: Partial<KeyboardEvent>): boolean {
    return this.keyHandler ? this.keyHandler(event as KeyboardEvent) : true;
  }
  getSelection(): string { return this._selection; }
  setSelection(s: string): void { this._selection = s; }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('navigator', { clipboard: { writeText: mockClipboardWrite } });
});

describe('attachClipboardCopyHandler', () => {
  it('copies selected text to clipboard on Ctrl+Shift+C keydown', () => {
    const terminal = new FakeTerminal();
    attachClipboardCopyHandler(terminal as any);

    terminal.setSelection('hello');
    terminal.simulateKey({ ctrlKey: true, shiftKey: true, key: 'C', type: 'keydown' });

    expect(mockClipboardWrite).toHaveBeenCalledWith('hello');
  });

  it('does not copy on keyup', () => {
    const terminal = new FakeTerminal();
    attachClipboardCopyHandler(terminal as any);

    terminal.setSelection('hello');
    terminal.simulateKey({ ctrlKey: true, shiftKey: true, key: 'C', type: 'keyup' });

    expect(mockClipboardWrite).not.toHaveBeenCalled();
  });

  it('does not copy when nothing is selected', () => {
    const terminal = new FakeTerminal();
    attachClipboardCopyHandler(terminal as any);

    terminal.setSelection('');
    terminal.simulateKey({ ctrlKey: true, shiftKey: true, key: 'C', type: 'keydown' });

    expect(mockClipboardWrite).not.toHaveBeenCalled();
  });

  it('returns false on Ctrl+Shift+C to prevent default', () => {
    const terminal = new FakeTerminal();
    attachClipboardCopyHandler(terminal as any);

    const result = terminal.simulateKey({ ctrlKey: true, shiftKey: true, key: 'C', type: 'keydown' });

    expect(result).toBe(false);
  });

  it('returns false on Ctrl+F to let document handle search', () => {
    const terminal = new FakeTerminal();
    attachClipboardCopyHandler(terminal as any);

    const result = terminal.simulateKey({ ctrlKey: true, key: 'f', type: 'keydown' });

    expect(result).toBe(false);
  });

  it('returns true for unhandled keys', () => {
    const terminal = new FakeTerminal();
    attachClipboardCopyHandler(terminal as any);

    const result = terminal.simulateKey({ key: 'a', type: 'keydown' });

    expect(result).toBe(true);
  });

  it('delegates unhandled keys to extend handler', () => {
    const terminal = new FakeTerminal();
    const extend = vi.fn().mockReturnValue(false);
    attachClipboardCopyHandler(terminal as any, extend);

    terminal.simulateKey({ key: 'Enter', shiftKey: true, type: 'keydown' });

    expect(extend).toHaveBeenCalled();
  });

  it('returns true when extend handler returns undefined', () => {
    const terminal = new FakeTerminal();
    attachClipboardCopyHandler(terminal as any, () => undefined);

    const result = terminal.simulateKey({ key: 'a', type: 'keydown' });

    expect(result).toBe(true);
  });
});
