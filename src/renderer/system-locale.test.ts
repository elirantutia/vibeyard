import { describe, expect, it } from 'vitest';
import { resolveSystemLocale } from './system-locale.js';

describe('resolveSystemLocale', () => {
  it('returns en for an empty input', () => {
    expect(resolveSystemLocale('')).toBe('en');
  });

  it('returns en for an undefined input', () => {
    expect(resolveSystemLocale(undefined)).toBe('en');
  });

  it('returns en for an unrelated language', () => {
    expect(resolveSystemLocale('en-US')).toBe('en');
    expect(resolveSystemLocale('de')).toBe('en');
    expect(resolveSystemLocale('ja-JP')).toBe('en');
  });

  it('returns zh-CN for zh-CN', () => {
    expect(resolveSystemLocale('zh-CN')).toBe('zh-CN');
  });

  it('returns zh-CN for the entire zh* family (Hans / Hant / regional variants)', () => {
    expect(resolveSystemLocale('zh')).toBe('zh-CN');
    expect(resolveSystemLocale('zh-Hans')).toBe('zh-CN');
    expect(resolveSystemLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(resolveSystemLocale('zh-Hant-TW')).toBe('zh-CN');
    expect(resolveSystemLocale('zh-HK')).toBe('zh-CN');
  });

  it('matches case-insensitively', () => {
    expect(resolveSystemLocale('ZH-cn')).toBe('zh-CN');
  });
});
