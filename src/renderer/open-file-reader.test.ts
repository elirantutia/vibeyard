import { describe, it, expect, vi, beforeEach } from 'vitest';

const addFileReaderSession = vi.fn();
const exists = vi.fn();
const isDirectory = vi.fn();
let activeProject: { id: string; path: string } | null = { id: 'p1', path: '/repo' };

vi.mock('./state.js', () => ({
  appState: {
    get activeProject() { return activeProject; },
    addFileReaderSession,
  },
}));

const { openFileReaderChecked } = await import('./open-file-reader.js');

beforeEach(() => {
  vi.clearAllMocks();
  exists.mockResolvedValue(true);
  isDirectory.mockResolvedValue(false);
  activeProject = { id: 'p1', path: '/repo' };
  (globalThis as unknown as { window: { vibeyard: unknown } }).window = {
    vibeyard: { fs: { exists, isDirectory } },
  } as never;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('openFileReaderChecked', () => {
  it('opens a tab for an existing file, forwarding the line number', async () => {
    await openFileReaderChecked('p1', 'src/foo.ts', 42);
    expect(addFileReaderSession).toHaveBeenCalledWith('p1', '/repo/src/foo.ts', 42);
  });

  it('resolves relative paths against the project path and leaves absolute ones alone', async () => {
    await openFileReaderChecked('p1', '/elsewhere/foo.ts');
    expect(exists).toHaveBeenCalledWith('/elsewhere/foo.ts');
    expect(addFileReaderSession).toHaveBeenCalledWith('p1', '/elsewhere/foo.ts', undefined);
  });

  it('opens no tab when the file does not exist', async () => {
    exists.mockResolvedValue(false);
    await openFileReaderChecked('p1', 'src/gone.ts');
    expect(addFileReaderSession).not.toHaveBeenCalled();
  });

  it('opens no tab for a directory, which exists but cannot be read', async () => {
    isDirectory.mockResolvedValue(true);
    await openFileReaderChecked('p1', 'src/components');
    expect(addFileReaderSession).not.toHaveBeenCalled();
  });

  it('opens no tab when the project is not the active one', async () => {
    await openFileReaderChecked('other', 'src/foo.ts');
    expect(exists).not.toHaveBeenCalled();
    expect(addFileReaderSession).not.toHaveBeenCalled();
  });

  it('opens no tab when the active project changed mid-lookup', async () => {
    exists.mockImplementation(async () => {
      activeProject = { id: 'p2', path: '/other' };
      return true;
    });
    await openFileReaderChecked('p1', 'src/foo.ts');
    expect(addFileReaderSession).not.toHaveBeenCalled();
  });

  it('resolves instead of rejecting when the fs check blows up', async () => {
    // Callers fire this with a bare `void`, so a rejection here would surface as
    // an unhandled promise rejection.
    exists.mockRejectedValue(new Error('window tearing down'));
    await openFileReaderChecked('p1', 'src/foo.ts');
    expect(addFileReaderSession).not.toHaveBeenCalled();
  });

  it('opens no tab when there is no active project', async () => {
    activeProject = null;
    await openFileReaderChecked('p1', 'src/foo.ts');
    expect(addFileReaderSession).not.toHaveBeenCalled();
  });
});
