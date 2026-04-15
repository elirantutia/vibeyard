import type { ITheme } from '@xterm/xterm';

export const darkTerminalTheme: ITheme = {
  background: '#000000',
  foreground: '#e0e0e0',
  cursor: '#e94560',
  selectionBackground: '#ff6b85a6',
  black: '#000000',
  red: '#e94560',
  green: '#0f9b58',
  yellow: '#f4b400',
  blue: '#4285f4',
  magenta: '#ab47bc',
  cyan: '#00acc1',
  white: '#e0e0e0',
};

export const lightTerminalTheme: ITheme = {
  background: '#fafaf8',
  foreground: '#2c2c2c',
  cursor: '#e94560',
  selectionBackground: '#e9456033',
  black: '#2c2c2c',
  red: '#e94560',
  green: '#0f7a46',
  yellow: '#b07800',
  blue: '#1a5cbf',
  magenta: '#7b27a0',
  cyan: '#0080a0',
  white: '#fafaf8',
};

export function getTerminalTheme(theme: 'dark' | 'light'): ITheme {
  return theme === 'light' ? lightTerminalTheme : darkTerminalTheme;
}
