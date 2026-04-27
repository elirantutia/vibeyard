import { appState } from '../state.js';
import { getProviderDisplayName } from '../provider-availability.js';
import { escapeHtml, escapeRegExp } from './dom-search-backend.js';
import type { DeepSearchResult } from '../../shared/types.js';

interface ResolvedResult extends DeepSearchResult {
  sessionName: string | null;
  projectId: string | null;
  archivedId: string | null;
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

let overlay: HTMLElement | null = null;
let input: HTMLInputElement | null = null;
let resultsList: HTMLElement | null = null;
let activeIndex = 0;
let resolvedResults: ResolvedResult[] = [];
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let latestSearchToken = 0;

function buildSessionMap(): Map<string, { projectId: string; archivedId: string; name: string }> {
  const map = new Map<string, { projectId: string; archivedId: string; name: string }>();
  for (const project of appState.projects) {
    for (const archived of appState.getSessionHistory(project.id)) {
      if (archived.cliSessionId) {
        map.set(archived.cliSessionId, { projectId: project.id, archivedId: archived.id, name: archived.name });
      }
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
  input.placeholder = 'Search all sessions...';
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeydown);

  inputRow.appendChild(icon);
  inputRow.appendChild(input);

  resultsList = document.createElement('div');
  resultsList.className = 'session-palette-results';

  const footer = document.createElement('div');
  footer.className = 'session-palette-footer';
  for (const [keys, label] of [['↑↓', 'navigate'], ['↵', 'open session'], ['Esc', 'close']] as [string, string][]) {
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
    raw = await window.vibeyard.session.deepSearch(query);
  } catch {
    raw = [];
  }

  if (myToken !== latestSearchToken) return;

  const sessionMap = buildSessionMap();
  resolvedResults = raw.map(r => {
    const match = sessionMap.get(r.cliSessionId) ?? null;
    return { ...r, sessionName: match?.name ?? null, projectId: match?.projectId ?? null, archivedId: match?.archivedId ?? null };
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
    empty.textContent = query.length >= 2 ? 'No sessions found' : 'Type 2+ characters to search all sessions';
    resultsList.appendChild(empty);
    return;
  }

  const activeProjectId = appState.activeProject?.id;
  const query = input?.value.trim() ?? '';
  for (let i = 0; i < resolvedResults.length; i++) {
    const r = resolvedResults[i];
    const isCurrentProject = r.projectId === activeProjectId;

    const item = document.createElement('div');
    item.className = 'session-palette-item';
    if (i === activeIndex) item.classList.add('active');
    item.style.cursor = 'pointer';
    item.addEventListener('mouseenter', () => { activeIndex = i; updateActiveItem(); });
    item.addEventListener('click', () => { activeIndex = i; openResult(r); });

    const nameRow = document.createElement('div');
    nameRow.className = 'session-palette-item-name';
    const nameText = document.createElement('span');
    nameText.textContent = r.sessionName ?? r.cliSessionId.slice(0, 8) + '\u2026';
    nameRow.appendChild(nameText);

    const providerBadge = document.createElement('span');
    providerBadge.className = `session-palette-badge provider provider-${r.providerId}`;
    providerBadge.textContent = getProviderDisplayName(r.providerId);
    nameRow.appendChild(providerBadge);

    const badge = document.createElement('span');
    badge.className = `session-palette-badge${isCurrentProject ? ' current' : ''}`;
    const projectName = r.projectCwd ? r.projectCwd.split('/').filter(Boolean).pop() ?? r.projectSlug : r.projectSlug;
    badge.textContent = isCurrentProject ? 'current project' : projectName;
    nameRow.appendChild(badge);

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
  if (r.projectId && r.archivedId) {
    appState.setActiveProject(r.projectId);
    appState.resumeFromHistory(r.projectId, r.archivedId);
  } else {
    // Not in Vibeyard — find or create project by cwd, then open session directly
    let project = appState.projects.find(p => p.path === r.projectCwd);
    if (!project) {
      const name = r.projectCwd ? r.projectCwd.split('/').filter(Boolean).pop()! : r.projectSlug;
      project = appState.addProject(name, r.projectCwd);
    }
    const name = r.sessionName ?? r.cliSessionId.slice(0, 8) + '\u2026';
    appState.openCliSession(project.id, r.cliSessionId, name, r.providerId);
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
