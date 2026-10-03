import type { Terminal } from '@xterm/xterm';

const cursorKeys: Record<string, [number, number]> = {
  ArrowUp: [38, 72], ArrowDown: [40, 80],
  ArrowLeft: [37, 75], ArrowRight: [39, 77],
  Home: [36, 71], End: [35, 79],
  PageUp: [33, 73], PageDown: [34, 81],
  Insert: [45, 82], Delete: [46, 83],
};

/** ConPTY splits ordinary VT cursor sequences into text while mode 9001 is on. */
export function attachWin32TerminalKeys(terminal: Terminal, write: (data: string) => void): (event: KeyboardEvent) => boolean | undefined {
  let enabled = false;
  for (const [final, value] of [['h', true], ['l', false]] as const) {
    terminal.parser?.registerCsiHandler({ prefix: '?', final }, params => {
      if (params.includes(9001)) enabled = value;
      return false; // Preserve xterm's handling of other DEC private modes.
    });
  }
  return event => {
    const key = cursorKeys[event.key];
    if (!enabled || !key || event.metaKey || event.isComposing) return undefined;
    if (event.type === 'keydown') {
      const modifiers = 256 | (event.shiftKey ? 16 : 0) | (event.ctrlKey ? 8 : 0) | (event.altKey ? 2 : 0);
      write(`\x1b[${key[0]};${key[1]};0;1;${modifiers};1_`);
    }
    event.preventDefault();
    return false;
  };
}
