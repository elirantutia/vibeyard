import type { Terminal } from '@xterm/xterm';

type ExtraKeyHandler = (e: KeyboardEvent) => boolean | undefined;

/**
 * Attaches shared key event handling to a terminal:
 * - Cmd/Ctrl+F: bubbles up to document (prevents xterm from consuming it)
 * - Ctrl+Shift+C: copies selected text to clipboard
 *
 * Pass an optional `extend` handler for terminal-specific key behavior.
 * Return false to suppress the key, undefined to fall through to default.
 */
export function attachClipboardCopyHandler(terminal: Terminal, extend?: ExtraKeyHandler): void {
  terminal.attachCustomKeyEventHandler((e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') return false;
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'C') {
      if (e.type === 'keydown') {
        const selection = terminal.getSelection();
        if (selection) navigator.clipboard.writeText(selection);
      }
      return false;
    }
    return extend?.(e) ?? true;
  });
}
