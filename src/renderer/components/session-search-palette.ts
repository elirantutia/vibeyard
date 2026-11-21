import { appState } from '../state.js';
import { getProviderDisplayName } from '../provider-availability.js';
import { escapeHtml, escapeRegExp } from './dom-search-backend.js';
import { deriveProjectName } from '../../shared/project-name.js';
import type { DeepSearchResult, DeepSearchScope, ProjectRecord } from '../../shared/types.js';

interface ResolvedResult extends DeepSearchResult {
  sessionName: string | null;
  projectId: string | null;
  archivedId: string | null;
  activeSessionId: string | null;
}

interface SessionMapEntry {
  projectId: string;
  name: string;
  archivedId: string | null;
  activeSessionId: string | null;
}

export function highlightMatches(text: string, query: string): string {
  const q = query.trim();
  if (!q) return escapeHtml(text);
  const tokens = Array.from(new Set([q, ...q.split(/\s+/)])).filter(Boolean);
  tokens.sort((a, b) => b.length - a.length);
  const re = new RegExp(tokens.map(escapeRegExp).join('|'), 'gi');
  let html = '';
  let pos = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index!;
    html += escapeHtml(text.slice(pos, start));
    html += `<mark class="search-match">${escapeHtml(m[0])}</mark>`;
    pos = start + m[0].length;
  }
  html += escapeHtml(text.slice(pos));
  return html;
}

type SearchScope = 'project' | 'all';

let overlay: HTMLElement | null = null;
let input: HTMLInputElement | null = null;
let scopeButtons: Record<SearchScope, HTMLButtonElement> | null = null;
let scope: SearchScope = 'project';
/** The project "This project" refers to, snapshotted on open so labels and searches can't drift apart. */
let paletteProject: ProjectRecord | undefined;
let resultsList: HTMLElement | null = null;
let activeIndex = 0;
let resolvedResults: ResolvedResult[] = [];
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let latestSearchToken = 0;

function buildSessionMap(): Map<string, SessionMapEntry> {
  const map = new Map<string, SessionMapEntry>();
  // Active sessions take precedence: if a session is open as a tab, opening from
  // the palette should switch to that tab rather than re-resume from history.
  for (const project of appState.projects) {
    for (const session of project.sessions) {
      if (!session.cliSessionId) continue;
      map.set(session.cliSessionId, {
        projectId: project.id,
        name: session.name,
        archivedId: null,
        activeSessionId: session.id,
      });
    }
  }
  for (const project of appState.projects) {
    for (const archived of appState.getSessionHistory(project.id)) {
      if (!archived.cliSessionId || map.has(archived.cliSessionId)) continue;
      map.set(archived.cliSessionId, {
        projectId: project.id,
        name: archived.name,
        archivedId: archived.id,
        activeSessionId: null,
      });
    }
  }
  return map;
}

function createOverlay(): void {
  if (overlay) return;

  overlay = document.createElement('div');
  overlay.className = 'session-palette-overlay';
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) hidePalette();
  });

  const container = document.createElement('div');
  container.className = 'session-palette-container';

  const inputRow = document.createElement('div');
  inputRow.className = 'session-palette-input-row';

  const icon = document.createElement('span');
  icon.className = 'session-palette-icon';
  icon.textContent = '⚡';

  input = document.createElement('input');
  input.className = 'session-palette-input';
  input.type = 'text';
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeydown);

  const scopeToggle = document.createElement('div');
  scopeToggle.className = 'session-palette-scope';
  scopeToggle.setAttribute('role', 'radiogroup');
  const makeScopeButton = (value: SearchScope, label: string): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'session-palette-scope-btn';
    btn.setAttribute('role', 'radio');
    btn.textContent = label;
    // mousedown keeps focus in the input; click alone would blur it first.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => setScope(value));
    scopeToggle.appendChild(btn);
    return btn;
  };
  scopeButtons = {
    project: makeScopeButton('project', 'This project'),
    all: makeScopeButton('all', 'All projects'),
  };

  inputRow.appendChild(icon);
  inputRow.appendChild(input);
  inputRow.appendChild(scopeToggle);

  resultsList = document.createElement('div');
  resultsList.className = 'session-palette-results';

  const footer = document.createElement('div');
  footer.className = 'session-palette-footer';
  for (const [keys, label] of [['↑↓', 'navigate'], ['↵', 'open session'], ['Tab', 'switch scope'], ['Esc', 'close']] as [string, string][]) {
    const span = document.createElement('span');
    const kbd = document.createElement('kbd');
    kbd.textContent = keys;
    span.appendChild(kbd);
    span.append(' ' + label);
    footer.appendChild(span);
  }

  container.appendChild(inputRow);
  container.appendChild(resultsList);
  container.appendChild(footer);
  overlay.appendChild(container);
  document.body.appendChild(overlay);
}

/** The project being searched, or undefined in all-projects scope. */
function scopedProject(): ProjectRecord | undefined {
  return scope === 'project' ? paletteProject : undefined;
}

function updateScopeUi(): void {
  if (!input || !scopeButtons) return;
  scopeButtons.project.disabled = !paletteProject;
  for (const value of ['project', 'all'] as const) {
    const on = value === scope;
    scopeButtons[value].classList.toggle('active', on);
    scopeButtons[value].setAttribute('aria-checked', String(on));
  }
  const project = scopedProject();
  input.placeholder = project ? `Search sessions in ${project.name}\u2026` : 'Search all sessions\u2026';
}

function setScope(next: SearchScope): void {
  if (next === 'project' && !paletteProject) return;
  if (next === scope) return;
  scope = next;
  updateScopeUi();
  input?.focus();
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  void searchSessions();
}

/** The scoped project as a deep-search scope, or undefined to search every project. */
function currentScope(): DeepSearchScope | undefined {
  const project = scopedProject();
  if (!project) return undefined;
  const cliSessionIds = [...buildSessionMap()]
    .filter(([, entry]) => entry.projectId === project.id)
    .map(([id]) => id);
  return { projectPath: project.path, cliSessionIds };
}

function onInput(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => searchSessions(), 400);
}

async function searchSessions(): Promise<void> {
  if (!input || !resultsList) return;
  const query = input.value.trim();
  const myToken = ++latestSearchToken;
  if (query.length < 2) {
    resolvedResults = [];
    renderResults();
    return;
  }

  resultsList.innerHTML = '';
  const loading = document.createElement('div');
  loading.className = 'session-palette-empty';
  loading.textContent = 'Searching\u2026';
  resultsList.appendChild(loading);

  let raw: DeepSearchResult[] = [];
  try {
    raw = await window.vibeyard.session.deepSearch(query, currentScope());
  } catch {
    raw = [];
  }

  if (myToken !== latestSearchToken) return;

  const sessionMap = buildSessionMap();
  resolvedResults = raw.map(r => {
    const match = sessionMap.get(r.cliSessionId) ?? null;
    return {
      ...r,
      sessionName: match?.name ?? null,
      projectId: match?.projectId ?? null,
      archivedId: match?.archivedId ?? null,
      activeSessionId: match?.activeSessionId ?? null,
    };
  });

  activeIndex = 0;
  renderResults();
}

function renderResults(): void {
  if (!resultsList) return;
  resultsList.innerHTML = '';

  if (resolvedResults.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'session-palette-empty';
    const query = input?.value.trim() ?? '';
    const project = scopedProject();
    if (query.length >= 2) {
      empty.textContent = project ? 'No sessions found in this project' : 'No sessions found';
    } else {
      empty.textContent = `Type 2+ characters to search ${project ? `sessions in ${project.name}` : 'all sessions'}`;
    }
    resultsList.appendChild(empty);
    return;
  }

  const activeProject = appState.activeProject;
  const activeProjectId = activeProject?.id;
  const activeProjectPath = activeProject?.path;
  const query = input?.value.trim() ?? '';
  for (let i = 0; i < resolvedResults.length; i++) {
    const r = resolvedResults[i];
    const isCurrentProject =
      r.projectId === activeProjectId ||
      (!!activeProjectPath && r.projectCwd === activeProjectPath);

    const item = document.createElement('div');
    item.className = 'session-palette-item';
    if (i === activeIndex) item.classList.add('active');
    item.style.cursor = 'pointer';
    item.addEventListener('mouseenter', () => { activeIndex = i; updateActiveItem(); });
    item.addEventListener('click', () => { activeIndex = i; openResult(r); });

    const nameRow = document.createElement('div');
    nameRow.className = 'session-palette-item-name';
    const nameText = document.createElement('span');
    nameText.textContent = r.sessionName ?? r.derivedName ?? r.cliSessionId.slice(0, 8) + '\u2026';
    nameRow.appendChild(nameText);

    const providerBadge = document.createElement('span');
    providerBadge.className = `session-palette-badge provider provider-${r.providerId}`;
    providerBadge.textContent = getProviderDisplayName(r.providerId);
    nameRow.appendChild(providerBadge);

    // Every row in project scope is the current project, so the badge says nothing there.
    if (!scopedProject()) {
      const badge = document.createElement('span');
      badge.className = `session-palette-badge${isCurrentProject ? ' current' : ''}`;
      badge.textContent = isCurrentProject ? 'current project' : deriveProjectName(r.projectCwd, r.projectSlug);
      nameRow.appendChild(badge);
    }

    const meta = document.createElement('div');
    meta.className = 'session-palette-item-meta';
    meta.textContent = r.projectCwd || r.projectSlug;

    const snippet = document.createElement('div');
    snippet.className = 'session-palette-item-snippet';
    snippet.innerHTML = highlightMatches(r.snippet, query);

    item.appendChild(nameRow);
    item.appendChild(meta);
    item.appendChild(snippet);
    resultsList.appendChild(item);
  }
}

function updateActiveItem(): void {
  if (!resultsList) return;
  const items = resultsList.querySelectorAll('.session-palette-item');
  items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
  (items[activeIndex] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
}

function openResult(r: ResolvedResult): void {
  if (r.projectId && r.activeSessionId) {
    appState.setActiveProject(r.projectId);
    appState.setActiveSession(r.projectId, r.activeSessionId);
  } else if (r.projectId && r.archivedId) {
    appState.setActiveProject(r.projectId);
    void appState.resumeFromHistorySafe(r.projectId, r.archivedId);
  } else {
    // Not in Vibeyard — find or create project by cwd, then open session directly.
    // A project-scoped hit may come from a subfolder, so it opens in the scoped project.
    let project = scopedProject() ?? appState.projects.find(p => p.path === r.projectCwd);
    if (!project) {
      const name = deriveProjectName(r.projectCwd, r.projectSlug);
      project = appState.addProject(name, r.projectCwd);
    }
    const name = r.sessionName ?? r.derivedName ?? r.cliSessionId.slice(0, 8) + '\u2026';
    appState.openCliSession(project.id, r.cliSessionId, name, r.providerId, r.profileId);
  }
  hidePalette();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (resolvedResults.length > 0) { activeIndex = (activeIndex + 1) % resolvedResults.length; updateActiveItem(); }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (resolvedResults.length > 0) { activeIndex = (activeIndex - 1 + resolvedResults.length) % resolvedResults.length; updateActiveItem(); }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (resolvedResults[activeIndex]) openResult(resolvedResults[activeIndex]);
  } else if (e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    setScope(scope === 'project' ? 'all' : 'project');
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hidePalette();
  }
}

export function showSessionSearchPalette(): void {
  createOverlay();
  if (!overlay || !input) return;
  overlay.style.display = 'flex';
  input.value = '';
  paletteProject = appState.activeProject;
  scope = paletteProject ? 'project' : 'all';
  updateScopeUi();
  resolvedResults = [];
  activeIndex = 0;
  latestSearchToken++;
  renderResults();
  input.focus();
}

function hidePalette(): void {
  if (overlay) overlay.style.display = 'none';
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  latestSearchToken++;
}
