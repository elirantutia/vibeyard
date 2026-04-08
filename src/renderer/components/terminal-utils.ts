import type { Terminal } from '@xterm/xterm';
import { shortcutMatchesEvent } from '../shortcuts.js';

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

    // Copy: copy selection if present, otherwise fall through to send interrupt
    if (shortcutMatchesEvent('terminal-copy', e)) {
      const selection = terminal.getSelection();
      if (selection) {
        if (e.type === 'keydown') navigator.clipboard.writeText(selection);
        return false;
      }
      return true;
    }

    // Copy (legacy shortcut, kept for compatibility)
    if (shortcutMatchesEvent('terminal-copy-legacy', e)) {
      if (e.type === 'keydown') {
        const selection = terminal.getSelection();
        if (selection) navigator.clipboard.writeText(selection);
      }
      return false;
    }

    // Paste: preventDefault stops the browser's native paste event from also
    // firing, which would cause xterm to receive the paste twice.
    if (shortcutMatchesEvent('terminal-paste', e)) {
      if (e.type === 'keydown') {
        e.preventDefault();
        navigator.clipboard.readText().then(text => {
          if (text) terminal.paste(text);
        });
      }
      return false;
    }

    return extend?.(e) ?? true;
  });
}
