export const PREVIEW_LINES = 2000;
export const PREVIEW_CHARS = 128 * 1024;

/** Locate a bounded page without splitting the whole file into an array. */
export function filePreview(content: string, firstLine = 1): { text: string; firstLine: number; nextLine: number; limited: boolean; hasMore: boolean } {
  let start = 0;
  let line = 1;
  while (line < firstLine) {
    const newline = content.indexOf('\n', start);
    if (newline === -1) break;
    start = newline + 1;
    line++;
  }
  const actualFirst = line;
  let end = start;
  const ceiling = Math.min(content.length, start + PREVIEW_CHARS);
  while (line - actualFirst < PREVIEW_LINES && end < ceiling) {
    const newline = content.indexOf('\n', end);
    if (newline === -1 || newline >= ceiling) { end = ceiling; line++; break; }
    end = newline + 1;
    line++;
  }
  const hasMore = end < content.length;
  const text = content.slice(start, end);
  return { text: hasMore && text.endsWith('\n') ? text.slice(0, -1) : text,
    firstLine: actualFirst, nextLine: line, limited: start > 0 || hasMore, hasMore };
}
