// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { ProjectRecord } from '../../shared/types';

const save = vi.hoisted(() => vi.fn());
vi.mock('../state.js', () => ({ appState: { preferences: { defaultProvider: 'claude' }, setProjectCodingDefaults: save } }));
vi.mock('../profile-utils.js', () => ({ providerProfileOptions: (id: string) => id === 'omp' ? [{ value: 'work', label: 'OMP Work' }] : [] }));
vi.mock('../provider-availability.js', () => ({ getCachedProviderMetas: () => [{ id: 'claude', displayName: 'Claude' }, { id: 'omp', displayName: 'OMP' }] }));
vi.mock('../i18n.js', () => ({ t: (key: string) => key }));

let close: () => void;
beforeEach(() => {
  vi.resetModules();
  save.mockClear();
  document.body.innerHTML = '<textarea id="terminal"></textarea><div id="modal-overlay" class="hidden"><h2 id="modal-title"></h2><div id="modal-body"></div><div id="modal-actions"><button id="modal-cancel"></button><button id="modal-confirm"></button></div></div>';
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => close?.());

it('offers providers without profiles, scopes profiles on change, saves and takes keyboard focus', async () => {
  const { promptProjectSettings } = await import('./project-settings');
  close = (await import('./modal')).closeModal;
  document.getElementById('terminal')!.focus();
  promptProjectSettings({ id: 'project', defaultProvider: 'claude' } as ProjectRecord);
  const selects = document.querySelectorAll('.custom-select');
  const trigger = selects[0].querySelector('button')!;
  expect(document.activeElement).toBe(trigger);
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  expect((document.getElementById('modal-provider') as HTMLInputElement).value).toBe('omp');
  expect(save).not.toHaveBeenCalled();
  expect(selects[1].textContent).toContain('OMP Work');
  (selects[1].querySelector('[data-value="work"]') as HTMLElement).click();
  document.getElementById('modal-confirm')!.click();
  expect(save).toHaveBeenCalledWith('project', 'omp', 'work');
});

it('resets the selected profile when changing providers', async () => {
  const { promptProjectSettings } = await import('./project-settings');
  close = (await import('./modal')).closeModal;
  promptProjectSettings({ id: 'project', defaultProvider: 'omp', defaultProfileId: 'work' } as ProjectRecord);
  (document.querySelector('.custom-select [data-value="claude"]') as HTMLElement).click();
  expect((document.getElementById('modal-profile') as HTMLInputElement).value).toBe('');
});
