import { describe, it, expect, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { attachWin32TerminalKeys } from './win32-terminal-keys';

function fixture() {
  const modes = new Map<string, (params: number[]) => boolean>();
  const terminal = { parser: { registerCsiHandler: (id: { final: string }, cb: (params: number[]) => boolean) => modes.set(id.final, cb) } };
  const write = vi.fn();
  const key = attachWin32TerminalKeys(terminal as unknown as Terminal, write);
  const press = (name: string, extra = {}) => key({ key: name, type: 'keydown', preventDefault: vi.fn(), ...extra } as unknown as KeyboardEvent);
  return { modes, write, press };
}

describe('Win32 terminal cursor input', () => {
  it.each([['ArrowUp', 38, 72], ['ArrowDown', 40, 80], ['ArrowLeft', 37, 75], ['ArrowRight', 39, 77]])('encodes %s only when the CLI enables mode 9001', (name, vk, scan) => {
    const f = fixture();
    expect(f.press(name as string)).toBeUndefined();
    expect(f.write).not.toHaveBeenCalled();
    expect(f.modes.get('h')!([9001, 1004])).toBe(false);
    expect(f.press(name as string)).toBe(false);
    expect(f.write).toHaveBeenCalledWith(`\x1b[${vk};${scan};0;1;256;1_`);
    f.modes.get('l')!([9001]);
    expect(f.press(name as string)).toBeUndefined();
  });
  it('preserves modifiers and suppresses duplicate keyup writes', () => {
    const f = fixture();
    f.modes.get('h')!([9001]);
    f.press('ArrowLeft', { ctrlKey: true, altKey: true, shiftKey: true });
    expect(f.write).toHaveBeenCalledWith('\x1b[37;75;0;1;282;1_');
    expect(f.press('ArrowLeft', { type: 'keyup' })).toBe(false);
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(f.press('a')).toBeUndefined();
    expect(f.press('ArrowUp', { isComposing: true })).toBeUndefined();
  });
});
