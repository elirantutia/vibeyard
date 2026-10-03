import { expect, it } from 'vitest';
import { filePreview, PREVIEW_LINES, PREVIEW_CHARS } from './file-preview';

it('bounds a 200,000-line file and locates a distant page', () => {
  const text = Array.from({ length: 200000 }, (_, i) => `line ${i + 1}`).join('\n');
  const page = filePreview(text);
  expect(page.text.split('\n')).toHaveLength(PREVIEW_LINES);
  expect(page.nextLine).toBe(2001);
  expect(page.hasMore).toBe(true);
  const last = filePreview(text, 199999);
  expect(last.text).toBe('line 199999\nline 200000');
  expect(last.hasMore).toBe(false);
});

it('bounds one enormous line and preserves small files exactly', () => {
  expect(filePreview('x'.repeat(PREVIEW_CHARS * 2)).text).toHaveLength(PREVIEW_CHARS);
  expect(filePreview('small\nfile\n').text).toBe('small\nfile\n');
  expect(filePreview('small\nfile\n').limited).toBe(false);
});
