import { describe, it, expect } from 'vitest';
import { getContextWindowLimit, computeUsedTokens, prettyModel, formatCountdown } from './sidebar-usage';
import type { CostInfo } from '../session-cost';

describe('sidebar-usage', () => {
  describe('getContextWindowLimit', () => {
    it('defaults to 200K for known models', () => {
      expect(getContextWindowLimit('claude-sonnet-4-6')).toBe(200_000);
      expect(getContextWindowLimit('claude-opus-4-7')).toBe(200_000);
      expect(getContextWindowLimit('claude-haiku-4-5-20251001')).toBe(200_000);
    });

    it('returns 1M for Opus 1M variant', () => {
      expect(getContextWindowLimit('claude-opus-4-7[1m]')).toBe(1_000_000);
      expect(getContextWindowLimit('claude-opus-4-7-1m')).toBe(1_000_000);
    });

    it('defaults to 200K when model is undefined', () => {
      expect(getContextWindowLimit(undefined)).toBe(200_000);
    });
  });

  describe('computeUsedTokens', () => {
    it('sums input + cache read + cache creation, excludes output', () => {
      const cost: CostInfo = {
        totalCostUsd: 1.23,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        cacheReadTokens: 2000,
        cacheCreationTokens: 300,
        totalDurationMs: 0,
        totalApiDurationMs: 0,
      };
      expect(computeUsedTokens(cost)).toBe(3300);
    });

    it('handles all-zero cost', () => {
      const cost: CostInfo = {
        totalCostUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalDurationMs: 0,
        totalApiDurationMs: 0,
      };
      expect(computeUsedTokens(cost)).toBe(0);
    });
  });

  describe('prettyModel', () => {
    it('formats standard model name', () => {
      expect(prettyModel('claude-sonnet-4-6')).toBe('Sonnet 4.6');
    });

    it('strips date suffix', () => {
      expect(prettyModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    });

    it('marks 1M variant in brackets', () => {
      expect(prettyModel('claude-opus-4-7[1m]')).toBe('Opus 4.7 (1M)');
    });

    it('marks 1M variant with -1m suffix', () => {
      expect(prettyModel('claude-opus-4-7-1m')).toBe('Opus 4.7 (1M)');
    });

    it('passes through display_name strings already formatted', () => {
      expect(prettyModel('Opus 4.7 (1M context)')).toBe('Opus 4.7 (1M context)');
      expect(prettyModel('Sonnet 4.6')).toBe('Sonnet 4.6');
    });

    it('handles single-segment family', () => {
      expect(prettyModel('claude-opus')).toBe('Opus');
    });

    it('joins multi-suffix models with dots', () => {
      expect(prettyModel('claude-sonnet-4-5-preview')).toBe('Sonnet 4.5.preview');
    });

    it('returns empty string when undefined', () => {
      expect(prettyModel(undefined)).toBe('');
    });
  });

  describe('formatCountdown', () => {
    const NOW = Date.parse('2026-04-30T12:00:00.000Z');

    it('formats hours and minutes with zero-padded minutes', () => {
      expect(formatCountdown(NOW + (2 * 60 + 14) * 60_000, NOW)).toBe('2h14m');
    });

    it('zero-pads single-digit minutes', () => {
      expect(formatCountdown(NOW + 7 * 60_000, NOW)).toBe('0h07m');
    });

    it('renders 0h00m when resetsAt is in the past', () => {
      expect(formatCountdown(NOW - 60_000, NOW)).toBe('0h00m');
    });

    it('renders 0h00m when resetsAt equals now', () => {
      expect(formatCountdown(NOW, NOW)).toBe('0h00m');
    });

    it('handles multi-hour durations', () => {
      expect(formatCountdown(NOW + (4 * 60 + 59) * 60_000, NOW)).toBe('4h59m');
    });
  });
});
