import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BoundedEventReader, EVENT_READ_BYTES, MAX_EVENT_BYTES } from './bounded-event-reader';

let dir: string;
let file: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibeyard-events-')); file = path.join(dir, 'events'); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('bounded event ingestion', () => {
  it('drains a backlog over multiple bounded batches without losing records', () => {
    const events = Array.from({ length: 6000 }, (_, timestamp) => ({ type: 'tool_use', timestamp, tool_name: 'Read' }));
    fs.writeFileSync(file, events.map(e => JSON.stringify(e)).join('\n') + '\n');
    const reader = new BoundedEventReader();
    const actual: unknown[] = [];
    let batches = 0;
    let more: boolean;
    do {
      const batch = reader.read(file);
      expect(JSON.stringify(batch.events).length).toBeLessThan(EVENT_READ_BYTES + MAX_EVENT_BYTES + 100);
      actual.push(...batch.events); more = batch.more; batches++;
    } while (more);
    expect(batches).toBeGreaterThan(1);
    expect(actual).toEqual(events);
  });

  it('retains partial UTF-8 records across appends', () => {
    const bytes = Buffer.from(JSON.stringify({ text: 'hello €' }) + '\n');
    const split = bytes.indexOf(Buffer.from('€')) + 1;
    fs.writeFileSync(file, bytes.subarray(0, split));
    const reader = new BoundedEventReader();
    expect(reader.read(file).events).toEqual([]);
    fs.appendFileSync(file, bytes.subarray(split));
    expect(reader.read(file).events).toEqual([{ text: 'hello €' }]);
  });

  it('skips oversized records and recovers at the next newline', () => {
    fs.writeFileSync(file, JSON.stringify({ text: 'x'.repeat(MAX_EVENT_BYTES * 4) }) + '\n{"ok":true}\n');
    const reader = new BoundedEventReader();
    const events: unknown[] = [];
    let more: boolean;
    do { const batch = reader.read(file); events.push(...batch.events); more = batch.more; } while (more);
    expect(events).toEqual([{ ok: true }]);
  });

  it('clears partial data when the file is truncated', () => {
    fs.writeFileSync(file, '{"unfinished":"old data');
    const reader = new BoundedEventReader(); reader.read(file);
    fs.writeFileSync(file, '{"ok":1}\n');
    expect(reader.read(file).events).toEqual([{ ok: 1 }]);
  });
});
