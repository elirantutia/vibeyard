import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: () => '/home/test',
}));

import * as fs from 'fs';
import { costEvents } from './cost-events';
import {
  init,
  dispose,
  getCurrentBlock,
  onBlockChange,
  _resetForTesting,
  type BlockInfo,
} from './usage-blocks';

const PROJECTS = path.join('/home/test', '.claude', 'projects');
const FIVE_HOURS = 5 * 60 * 60 * 1000;

interface FakeFile {
  mtimeMs: number;
  content: string;
}

const fakeFs = new Map<string, FakeFile>();
const fakeDirs = new Map<string, string[]>();

function setupFs(): void {
  fakeFs.clear();
  fakeDirs.clear();
  vi.mocked(fs.existsSync).mockImplementation((p) => {
    const sp = String(p);
    return fakeDirs.has(sp) || fakeFs.has(sp);
  });
  vi.mocked(fs.readdirSync).mockImplementation((p) => {
    const sp = String(p);
    return (fakeDirs.get(sp) ?? []) as never;
  });
  vi.mocked(fs.statSync).mockImplementation((p) => {
    const sp = String(p);
    if (fakeDirs.has(sp)) {
      return { isDirectory: () => true, mtimeMs: 0 } as fs.Stats;
    }
    const f = fakeFs.get(sp);
    if (!f) throw new Error(`ENOENT: ${sp}`);
    return { isDirectory: () => false, mtimeMs: f.mtimeMs } as fs.Stats;
  });
  vi.mocked(fs.readFileSync).mockImplementation((p) => {
    const sp = String(p);
    const f = fakeFs.get(sp);
    if (!f) throw new Error(`ENOENT: ${sp}`);
    return f.content as never;
  });
}

function addProject(name: string, files: Record<string, string>, mtimeMs: number): void {
  const projectPath = path.join(PROJECTS, name);
  const existing = fakeDirs.get(PROJECTS) ?? [];
  if (!existing.includes(name)) existing.push(name);
  fakeDirs.set(PROJECTS, existing);
  fakeDirs.set(projectPath, Object.keys(files));
  for (const [fname, content] of Object.entries(files)) {
    fakeFs.set(path.join(projectPath, fname), { mtimeMs, content });
  }
}

function jsonl(entries: Array<{ ts: string; model: string; usage: object }>): string {
  return entries
    .map((e) =>
      JSON.stringify({
        timestamp: e.ts,
        message: { model: e.model, usage: e.usage },
      })
    )
    .join('\n');
}

const NOW = Date.parse('2026-04-30T12:00:00.000Z');

describe('usage-blocks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    setupFs();
    fakeDirs.set(PROJECTS, []);
    _resetForTesting();
  });

  afterEach(() => {
    _resetForTesting();
    vi.useRealTimers();
  });

  it('returns null when no JSONL transcripts exist', async () => {
    init();
    const block = await getCurrentBlock();
    expect(block).toBeNull();
  });

  it('aggregates entries within the rolling 5h window', async () => {
    addProject(
      'p1',
      {
        'a.jsonl': jsonl([
          {
            ts: '2026-04-30T10:00:00.000Z', // 2h ago — inside window
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 1_000_000 }, // $3
          },
          {
            ts: '2026-04-30T11:30:00.000Z', // 30m ago — inside window
            model: 'claude-sonnet-4-6',
            usage: { output_tokens: 1_000_000 }, // $15
          },
        ]),
      },
      NOW - 60 * 60 * 1000
    );
    init();
    const block = await getCurrentBlock();
    expect(block).not.toBeNull();
    expect(block!.usdSpent).toBeCloseTo(18, 4);
    expect(block!.entryCount).toBe(2);
    // Oldest in window is 10:00 → resets at 15:00 UTC
    expect(block!.resetsAt).toBe(Date.parse('2026-04-30T15:00:00.000Z'));
  });

  it('skips entries outside the 5h window', async () => {
    addProject(
      'p1',
      {
        'a.jsonl': jsonl([
          {
            ts: '2026-04-30T06:00:00.000Z', // 6h ago — outside window
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 1_000_000 },
          },
          {
            ts: '2026-04-30T11:00:00.000Z', // 1h ago — inside
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 1_000_000 }, // $3
          },
        ]),
      },
      NOW - 30 * 60 * 1000
    );
    init();
    const block = await getCurrentBlock();
    expect(block!.usdSpent).toBeCloseTo(3, 4);
    expect(block!.entryCount).toBe(1);
  });

  it('skips files whose mtime is older than now-5h-5min entirely', async () => {
    addProject(
      'p1',
      {
        'old.jsonl': jsonl([
          {
            ts: '2026-04-30T11:00:00.000Z',
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 1_000_000 },
          },
        ]),
      },
      // mtime is 6h ago — should be dropped without reading
      NOW - 6 * 60 * 60 * 1000
    );
    init();
    const block = await getCurrentBlock();
    expect(block).toBeNull();
  });

  it('skips malformed JSONL lines but counts surrounding entries', async () => {
    const goodLine = JSON.stringify({
      timestamp: '2026-04-30T11:00:00.000Z',
      message: {
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 1_000_000 },
      },
    });
    addProject(
      'p1',
      {
        'a.jsonl': `not json\n${goodLine}\n{broken`,
      },
      NOW - 60 * 60 * 1000
    );
    init();
    const block = await getCurrentBlock();
    expect(block!.entryCount).toBe(1);
    expect(block!.usdSpent).toBeCloseTo(3, 4);
  });

  it('skips entries with unknown model IDs', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    addProject(
      'p1',
      {
        'a.jsonl': jsonl([
          {
            ts: '2026-04-30T11:00:00.000Z',
            model: 'mystery-model-x',
            usage: { input_tokens: 1_000_000 },
          },
          {
            ts: '2026-04-30T11:30:00.000Z',
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 1_000_000 },
          },
        ]),
      },
      NOW - 60 * 60 * 1000
    );
    init();
    const block = await getCurrentBlock();
    expect(block!.entryCount).toBe(1);
    expect(block!.usdSpent).toBeCloseTo(3, 4);
    debugSpy.mockRestore();
  });

  it('clamps future-dated timestamps to now', async () => {
    addProject(
      'p1',
      {
        'a.jsonl': jsonl([
          {
            ts: '2026-04-30T20:00:00.000Z', // 8h in future
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 1_000_000 },
          },
        ]),
      },
      NOW
    );
    init();
    const block = await getCurrentBlock();
    expect(block).not.toBeNull();
    // Clamped timestamp = now → resetsAt = now + 5h
    expect(block!.resetsAt).toBe(NOW + FIVE_HOURS);
  });

  it('drops cache entry when file disappears on next recompute', async () => {
    const filePath = path.join(PROJECTS, 'p1', 'a.jsonl');
    addProject(
      'p1',
      {
        'a.jsonl': jsonl([
          {
            ts: '2026-04-30T11:00:00.000Z',
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 1_000_000 },
          },
        ]),
      },
      NOW - 60 * 60 * 1000
    );
    init();
    let block = await getCurrentBlock();
    expect(block!.entryCount).toBe(1);

    // Remove the file from the fake fs
    fakeFs.delete(filePath);
    fakeDirs.set(path.join(PROJECTS, 'p1'), []);

    // Trigger ticker recompute
    vi.advanceTimersByTime(30_000);
    block = await getCurrentBlock();
    expect(block).toBeNull();
  });

  it('costEvents trigger emits a block-changed event after debounce', async () => {
    addProject(
      'p1',
      {
        'a.jsonl': jsonl([
          {
            ts: '2026-04-30T11:00:00.000Z',
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 1_000_000 },
          },
        ]),
      },
      NOW - 60 * 60 * 1000
    );
    init();
    const initial = await getCurrentBlock();
    expect(initial!.entryCount).toBe(1);

    const events: Array<BlockInfo | null> = [];
    onBlockChange((info) => events.push(info));

    // Add a second entry, fire costEvents
    addProject(
      'p1',
      {
        'a.jsonl': jsonl([
          {
            ts: '2026-04-30T11:00:00.000Z',
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 1_000_000 },
          },
          {
            ts: '2026-04-30T11:30:00.000Z',
            model: 'claude-sonnet-4-6',
            usage: { output_tokens: 1_000_000 },
          },
        ]),
      },
      NOW - 30 * 60 * 1000
    );
    costEvents.emit('costData', { sessionId: 's1', costData: {} as never });

    // Debounce hasn't fired yet
    expect(events).toHaveLength(0);
    vi.advanceTimersByTime(250);
    expect(events).toHaveLength(1);
    expect(events[0]!.entryCount).toBe(2);
  });

  it('does not re-emit when rounded values are unchanged', async () => {
    addProject(
      'p1',
      {
        'a.jsonl': jsonl([
          {
            ts: '2026-04-30T11:00:00.000Z',
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 1_000_000 },
          },
        ]),
      },
      NOW - 60 * 60 * 1000
    );
    init();
    await getCurrentBlock();
    const events: Array<BlockInfo | null> = [];
    onBlockChange((info) => events.push(info));

    // Trigger a recompute with no actual change
    costEvents.emit('costData', { sessionId: 's1', costData: {} as never });
    vi.advanceTimersByTime(250);
    vi.advanceTimersByTime(1500); // retry
    expect(events).toHaveLength(0);
  });

  it('getCurrentBlock awaits the ready promise when called pre-init', async () => {
    addProject(
      'p1',
      {
        'a.jsonl': jsonl([
          {
            ts: '2026-04-30T11:00:00.000Z',
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 1_000_000 },
          },
        ]),
      },
      NOW - 60 * 60 * 1000
    );

    // Don't init yet — start an awaiter
    let resolved: BlockInfo | null | 'pending' = 'pending';
    const promise = getCurrentBlock().then((b) => {
      resolved = b;
    });

    // Briefly tick to confirm it's still pending
    await Promise.resolve();
    expect(resolved).toBe('pending');

    init();
    await promise;
    expect(resolved).not.toBe('pending');
    expect((resolved as BlockInfo).entryCount).toBe(1);
  });

  it('_resetForTesting clears cache, timers, listeners, and ready state', async () => {
    addProject(
      'p1',
      {
        'a.jsonl': jsonl([
          {
            ts: '2026-04-30T11:00:00.000Z',
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 1_000_000 },
          },
        ]),
      },
      NOW - 60 * 60 * 1000
    );
    init();
    expect((await getCurrentBlock())!.entryCount).toBe(1);

    _resetForTesting();
    fakeFs.clear();
    fakeDirs.clear();
    fakeDirs.set(PROJECTS, []);
    init();
    expect(await getCurrentBlock()).toBeNull();
  });
});

describe('usage-blocks dispose', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    setupFs();
    fakeDirs.set(PROJECTS, []);
    _resetForTesting();
  });

  afterEach(() => {
    _resetForTesting();
    vi.useRealTimers();
  });

  it('stops the 30s ticker', async () => {
    init();
    dispose();
    const events: Array<BlockInfo | null> = [];
    onBlockChange((info) => events.push(info));
    addProject(
      'p1',
      {
        'a.jsonl': jsonl([
          {
            ts: '2026-04-30T11:00:00.000Z',
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 1_000_000 },
          },
        ]),
      },
      NOW - 60 * 60 * 1000
    );
    vi.advanceTimersByTime(60_000);
    expect(events).toHaveLength(0);
  });
});
