// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const addFileReaderSession = vi.fn();
const openExternal = vi.fn();
const exists = vi.fn();
const isDirectory = vi.fn();
let activeProject: { id: string; path: string } | null = { id: 'p1', path: '/repo' };

vi.mock('../state.js', () => ({
  appState: {
    get activeProject() { return activeProject; },
    addFileReaderSession,
  },
}));
vi.mock('../session-close.js', () => ({ closeSessionIfFileMissing: vi.fn() }));
vi.mock('./search-bar.js', () => ({ destroySearchBar: vi.fn() }));

const { renderMarkdownContent } = await import('./file-reader.js');

beforeEach(() => {
  vi.clearAllMocks();
  exists.mockResolvedValue(true);
  isDirectory.mockResolvedValue(false);
  openExternal.mockResolvedValue(undefined);
  activeProject = { id: 'p1', path: '/repo' };
  document.body.innerHTML = '';
  // jsdom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
  (globalThis as unknown as { window: { vibeyard: unknown } }).window.vibeyard = {
    app: { openExternal },
    fs: { exists, isDirectory },
  };
});

/** Render markdown, attach to the document, and click the first link. */
function clickFirstLink(markdown: string, baseDir?: string): { wrapper: HTMLElement; defaultPrevented: boolean } {
  const wrapper = renderMarkdownContent(markdown, baseDir);
  document.body.appendChild(wrapper);
  const anchor = wrapper.querySelector('a')!;
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  anchor.dispatchEvent(event);
  return { wrapper, defaultPrevented: event.defaultPrevented };
}

describe('renderMarkdownContent link handling', () => {
  it('never lets a link navigate the app document', () => {
    for (const md of [
      '[x](other.md)',
      '[x](https://example.com)',
      '[x](file:///etc/hosts)',
      '[x](#heading)',
      '[x](/abs/doc.md)',
    ]) {
      expect(clickFirstLink(md, '/repo/docs').defaultPrevented).toBe(true);
    }
  });

  it('opens a relative file link in a file reader tab, resolved against the base dir', async () => {
    clickFirstLink('[x](../README.md)', '/repo/docs');
    await vi.waitFor(() => expect(addFileReaderSession).toHaveBeenCalledWith('p1', '/repo/README.md'));
  });

  it('does not open a tab when the linked file is missing', async () => {
    exists.mockResolvedValue(false);
    clickFirstLink('[x](gone.md)', '/repo/docs');
    await vi.waitFor(() => expect(exists).toHaveBeenCalled());
    expect(addFileReaderSession).not.toHaveBeenCalled();
  });

  it('does not open a tab for a directory link', async () => {
    isDirectory.mockResolvedValue(true);
    clickFirstLink('[x](../guides)', '/repo/docs');
    await vi.waitFor(() => expect(isDirectory).toHaveBeenCalledWith('/repo/guides'));
    expect(addFileReaderSession).not.toHaveBeenCalled();
  });

  it('drops the tab when the project goes away mid-lookup', async () => {
    exists.mockImplementation(async () => {
      activeProject = null;
      return true;
    });
    clickFirstLink('[x](../README.md)', '/repo/docs');
    await vi.waitFor(() => expect(exists).toHaveBeenCalled());
    expect(addFileReaderSession).not.toHaveBeenCalled();
  });

  it('ignores relative links when no base dir is known', async () => {
    clickFirstLink('[x](sibling.md)');
    await Promise.resolve();
    expect(exists).not.toHaveBeenCalled();
    expect(addFileReaderSession).not.toHaveBeenCalled();
  });

  it('sends http(s) links to the system browser', () => {
    clickFirstLink('[x](https://example.com/a)', '/repo/docs');
    expect(openExternal).toHaveBeenCalledWith('https://example.com/a');
    expect(addFileReaderSession).not.toHaveBeenCalled();
  });

  it('scrolls to the matching heading for in-document anchors', () => {
    const { wrapper } = clickFirstLink('## Notification Types\n\n[x](#notification-types)', '/repo/docs');
    const heading = wrapper.querySelector('h2')!;
    expect(heading.scrollIntoView).toHaveBeenCalled();
  });

  it('ignores clicks that are not on a link', () => {
    const wrapper = renderMarkdownContent('plain paragraph', '/repo/docs');
    document.body.appendChild(wrapper);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    wrapper.querySelector('p')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(addFileReaderSession).not.toHaveBeenCalled();
  });
});
