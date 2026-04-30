import type { TeamMember } from '../../../shared/types.js';
import { appState } from '../../state.js';
import { fetchPredefinedMembers, isCacheFresh } from './github-fetcher.js';

interface DialogState {
  overlay: HTMLDivElement;
  list: HTMLDivElement;
  status: HTMLDivElement;
  refreshBtn: HTMLButtonElement;
}

export async function showPredefinedPicker(): Promise<void> {
  const state = buildDialog();
  document.body.appendChild(state.overlay);

  const cache = appState.team.predefinedCache;
  if (cache && isCacheFresh(cache)) {
    renderSuggestions(state, cache.suggestions);
  } else {
    await load(state);
  }
}

function buildDialog(): DialogState {
  const overlay = document.createElement('div');
  overlay.className = 'team-picker-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'team-picker-dialog';

  const header = document.createElement('div');
  header.className = 'team-picker-header';
  const title = document.createElement('div');
  title.className = 'team-picker-title';
  title.textContent = 'Browse predefined team members';

  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'team-picker-refresh';
  refreshBtn.textContent = 'Refresh';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'team-picker-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Close');

  header.appendChild(title);
  header.appendChild(refreshBtn);
  header.appendChild(closeBtn);

  const status = document.createElement('div');
  status.className = 'team-picker-status';

  const list = document.createElement('div');
  list.className = 'team-picker-list';

  dialog.appendChild(header);
  dialog.appendChild(status);
  dialog.appendChild(list);
  overlay.appendChild(dialog);

  const dispose = (): void => overlay.remove();
  closeBtn.addEventListener('click', dispose);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dispose(); });
  document.addEventListener('keydown', function escListener(e) {
    if (e.key === 'Escape') {
      dispose();
      document.removeEventListener('keydown', escListener);
    }
  });

  const state: DialogState = { overlay, list, status, refreshBtn };
  refreshBtn.addEventListener('click', () => { void load(state); });
  return state;
}

async function load(state: DialogState): Promise<void> {
  state.status.textContent = 'Loading suggestions from GitHub…';
  state.list.innerHTML = '';
  state.refreshBtn.disabled = true;
  try {
    const suggestions = await fetchPredefinedMembers();
    appState.setTeamPredefinedCache(suggestions);
    renderSuggestions(state, suggestions);
  } catch (err) {
    state.status.textContent = `Failed to load: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    state.refreshBtn.disabled = false;
  }
}

function renderSuggestions(state: DialogState, suggestions: TeamMember[]): void {
  state.list.innerHTML = '';
  if (suggestions.length === 0) {
    state.status.textContent = 'No predefined members found.';
    return;
  }
  state.status.textContent = `${suggestions.length} member${suggestions.length === 1 ? '' : 's'} available`;

  const installed = new Set(appState.getTeamMembers().map((m) => m.id));

  for (const suggestion of suggestions) {
    const row = document.createElement('div');
    row.className = 'team-picker-row';

    const main = document.createElement('div');
    main.className = 'team-picker-row-main';

    const name = document.createElement('div');
    name.className = 'team-picker-row-name';
    name.textContent = `${suggestion.name} · ${suggestion.role}`;

    main.appendChild(name);

    if (suggestion.description) {
      const desc = document.createElement('div');
      desc.className = 'team-picker-row-desc';
      desc.textContent = suggestion.description;
      main.appendChild(desc);
    }

    row.appendChild(main);

    const addBtn = document.createElement('button');
    addBtn.className = 'team-picker-add-btn';
    if (installed.has(suggestion.id)) {
      addBtn.textContent = 'Added';
      addBtn.disabled = true;
    } else {
      addBtn.textContent = 'Add';
      addBtn.addEventListener('click', () => {
        appState.addTeamMember({
          id: suggestion.id,
          name: suggestion.name,
          role: suggestion.role,
          description: suggestion.description,
          systemPrompt: suggestion.systemPrompt,
          source: 'predefined',
          sourceUrl: suggestion.sourceUrl,
        });
        addBtn.textContent = 'Added';
        addBtn.disabled = true;
      });
    }

    row.appendChild(addBtn);
    state.list.appendChild(row);
  }
}
