import { describe, it, expect } from 'vitest';
import { parseEnvVars, findInvalidEnvLines } from './env-vars';

describe('parseEnvVars', () => {
  it('returns an empty object for empty/whitespace input', () => {
    expect(parseEnvVars('')).toEqual({});
    expect(parseEnvVars('   \n  \n')).toEqual({});
  });

  it('parses a single KEY=VALUE pair', () => {
    expect(parseEnvVars('FOO=bar')).toEqual({ FOO: 'bar' });
  });

  it('parses multiple pairs across lines', () => {
    expect(parseEnvVars('FOO=bar\nBAZ=qux')).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('keeps "=" characters in the value (splits on the first only)', () => {
    expect(parseEnvVars('URL=https://x?a=1&b=2')).toEqual({ URL: 'https://x?a=1&b=2' });
  });

  it('trims keys and skips blank lines', () => {
    expect(parseEnvVars('\n  FOO=bar\n\nBAZ=qux\n')).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('strips a trailing CRLF carriage return from values', () => {
    expect(parseEnvVars('FOO=bar\r\nBAZ=qux\r')).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('skips malformed lines (no "=" or empty key)', () => {
    expect(parseEnvVars('NOEQUALS\n=value\nGOOD=1')).toEqual({ GOOD: '1' });
  });
});

describe('findInvalidEnvLines', () => {
  it('returns no invalid lines for valid input', () => {
    expect(findInvalidEnvLines('FOO=bar\nBAZ=qux')).toEqual([]);
  });

  it('ignores blank lines', () => {
    expect(findInvalidEnvLines('\nFOO=bar\n\n')).toEqual([]);
  });

  it('flags lines without "=" and lines with an empty key', () => {
    expect(findInvalidEnvLines('NOEQUALS\nFOO=bar\n=value')).toEqual(['NOEQUALS', '=value']);
  });

  it('agrees with parseEnvVars on what is kept vs rejected', () => {
    const text = 'A=1\nBAD\nB=2\n=nope';
    const kept = Object.keys(parseEnvVars(text));
    const rejected = findInvalidEnvLines(text);
    expect(kept).toEqual(['A', 'B']);
    expect(rejected).toEqual(['BAD', '=nope']);
  });
});
