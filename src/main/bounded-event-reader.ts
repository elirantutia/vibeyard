import * as fs from 'fs';

export const EVENT_READ_BYTES = 64 * 1024;
export const MAX_EVENT_BYTES = 64 * 1024;

/** One bounded read per turn. Decode only complete lines, including split UTF-8. */
export class BoundedEventReader {
  private offset = 0;
  private pending = Buffer.alloc(0);
  private dropping = false;

  read(file: string): { events: unknown[]; more: boolean } {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      if (size < this.offset) {
        this.offset = 0;
        this.pending = Buffer.alloc(0);
        this.dropping = false;
      }
      const buffer = Buffer.alloc(Math.min(EVENT_READ_BYTES, size - this.offset));
      const count = fs.readSync(fd, buffer, 0, buffer.length, this.offset);
      this.offset += count;
      const data = Buffer.concat([this.pending, buffer.subarray(0, count)]);
      this.pending = Buffer.alloc(0);
      const events: unknown[] = [];
      let start = 0;
      for (let end = data.indexOf(10); end !== -1; end = data.indexOf(10, start)) {
        if (!this.dropping && end - start <= MAX_EVENT_BYTES) {
          try {
            const event = JSON.parse(data.toString('utf8', start, end));
            if (event && typeof event === 'object' && !Array.isArray(event)) events.push(event);
          } catch { /* Malformed complete line. */ }
        }
        this.dropping = false;
        start = end + 1;
      }
      if (data.length - start > MAX_EVENT_BYTES) this.dropping = true;
      if (!this.dropping) this.pending = Buffer.from(data.subarray(start));
      return { events, more: count > 0 && this.offset < size };
    } finally { fs.closeSync(fd); }
  }
}
