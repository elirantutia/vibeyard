import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const testHome = vi.hoisted(() => ({ path: '' }));
vi.mock('os', async (importOriginal) => ({
  ...await importOriginal<typeof import('os')>(),
  homedir: () => testHome.path,
}));

let store: typeof import('./store');

beforeAll(async () => {
  testHome.path = fs.mkdtempSync(path.join(os.tmpdir(), 'vibeyard-store-test-'));
  store = await import('./store');
});

afterAll(() => {
  fs.rmSync(testHome.path, { recursive: true, force: true });
});

describe('state persistence on disk', () => {
  it('commits and loads a state file', () => {
    const state = store.loadState();
    state.activeProjectId = 'saved-project';
    store.saveStateSync(state);
    const file = path.join(testHome.path, '.vibeyard', 'state.json');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(file + '.tmp')).toBe(false);
    expect(store.loadState().activeProjectId).toBe('saved-project');
  });

  it('recovers a valid temp state when the main file is corrupt', () => {
    const file = path.join(testHome.path, '.vibeyard', 'state.json');
    const state = store.loadState();
    state.activeProjectId = 'recovered-project';
    fs.writeFileSync(file, '{corrupt');
    fs.writeFileSync(file + '.tmp', JSON.stringify(state));
    expect(store.loadState().activeProjectId).toBe('recovered-project');
  });
});
