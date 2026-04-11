import { describe, it, expect } from 'vitest';
import { buildWarningBannerDetail, countActiveStatuses } from './confirm-helpers.js';

describe('countActiveStatuses', () => {
  it('counts working, waiting, and input statuses', () => {
    const statuses = ['working', 'waiting', 'idle', 'input', 'working', 'completed'] as const;
    const counts = countActiveStatuses(statuses as unknown as string[]);
    expect(counts).toEqual({ working: 2, waiting: 1, input: 1 });
  });

  it('returns zero counts when no active sessions', () => {
    const counts = countActiveStatuses(['idle', 'completed']);
    expect(counts).toEqual({ working: 0, waiting: 0, input: 0 });
  });

  it('returns zero counts for empty array', () => {
    const counts = countActiveStatuses([]);
    expect(counts).toEqual({ working: 0, waiting: 0, input: 0 });
  });
});

describe('buildWarningBannerDetail', () => {
  it('renders only non-zero status categories', () => {
    const html = buildWarningBannerDetail({ working: 2, waiting: 0, input: 1 });
    expect(html).toContain('2 working');
    expect(html).toContain('1 needs input');
    expect(html).not.toContain('waiting');
  });

  it('renders all three when all non-zero', () => {
    const html = buildWarningBannerDetail({ working: 1, waiting: 3, input: 2 });
    expect(html).toContain('1 working');
    expect(html).toContain('3 waiting');
    expect(html).toContain('2 needs input');
  });

  it('includes warning header', () => {
    const html = buildWarningBannerDetail({ working: 1, waiting: 0, input: 0 });
    expect(html).toContain('Warning: Active sessions will be terminated');
  });
});
