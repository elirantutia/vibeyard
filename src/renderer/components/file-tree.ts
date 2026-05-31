import { appState, ProjectRecord } from '../state.js';
import { pathToFileURL } from '../file-url.js';
import { showContextMenu, MenuOption } from './board/board-context-menu.js';
import { showConfirmModal, showPropertiesDialog } from './modal.js';
import { FILE_PATH_DRAG_TYPE } from '../drag-types.js';
import { estimateTokens, TOKEN_COUNT_MAX_CHARS } from '../../shared/token-estimate.js';
import { isPathUnder } from '../../shared/platform.js';

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

const expandedFolders = new Map<string, Set<string>>();
const entryCache = new Map<string, DirEntry[]>();
const inflight = new Map<string, Promise<DirEntry[]>>();
const watchedByProject = new Map<string, Set<string>>();
const activeTrees = new Map<string, { project: ProjectRecord; container: HTMLElement }>();
let unsubFileChanged: (() => void) | null = null;

function getWatchedSet(projectId: string): Set<string> {
  let set = watchedByProject.get(projectId);
  if (!set) {
    set = new Set();
    watchedByProject.set(projectId, set);
  }
  return set;
}

function watchFolder(projectId: string, folderPath: string): void {
  const set = getWatchedSet(projectId);
  if (set.has(folderPath)) return;
  set.add(folderPath);
  window.vibeyard.fs.watchDir(folderPath);
}

/**
 * Stop watching `folderPath` and every watched directory nested beneath it, and
 * drop their cached listings. Used on collapse (keeps expansion state so a
 * re-expand restores the subtree) and on deletion (`clearExpanded`).
 */
function unwatchSubtree(projectId: string, folderPath: string, clearExpanded = false): void {
  const set = watchedByProject.get(projectId);
  if (set) {
    for (const p of [...set]) {
      if (!isPathUnder(p, folderPath)) continue;
      set.delete(p);
      window.vibeyard.fs.unwatchDir(p);
    }
  }
  for (const p of [...entryCache.keys()]) {
    if (isPathUnder(p, folderPath)) entryCache.delete(p);
  }
  if (clearExpanded) {
    const exp = expandedFolders.get(projectId);
    if (exp) for (const p of [...exp]) if (isPathUnder(p, folderPath)) exp.delete(p);
  }
}

// Coalesce filesystem-change bursts: collect the affected directories and
// reconcile each once per animation frame, so an agent writing 50 files in a
// watched folder triggers a single batched DOM pass rather than 50.
const pendingDirs = new Set<string>();
let flushScheduled = false;

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  requestAnimationFrame(flushPendingDirs);
}

function flushPendingDirs(): void {
  flushScheduled = false;
  const dirs = [...pendingDirs];
  pendingDirs.clear();
  for (const dir of dirs) {
    entryCache.delete(dir);
    inflight.delete(dir);
    for (const [projectId, paths] of watchedByProject) {
      if (!paths.has(dir)) continue;
      const reg = activeTrees.get(projectId);
      if (!reg) continue;
      const selector = `[data-folder-path="${CSS.escape(dir)}"]`;
      const target = reg.container.matches(selector)
        ? reg.container
        : reg.container.querySelector(selector);
      if (target instanceof HTMLElement) {
        const depth = Number(target.dataset.depth ?? '0');
        reconcileChildren(projectId, dir, depth, target);
      }
    }
  }
}

function ensureChangeSubscription(): void {
  if (unsubFileChanged) return;
  unsubFileChanged = window.vibeyard.fs.onFsChange((changes) => {
    if (changes.length === 0) return;
    // flushPendingDirs filters to dirs actually rendered in a tree; collecting
    // every changed dir here (dirs from open reader/viewer panes included) is
    // harmless and avoids an O(changes × projects) membership scan on this path.
    for (const change of changes) pendingDirs.add(change.dir);
    scheduleFlush();
  });
}

function getExpandedSet(projectId: string): Set<string> {
  let set = expandedFolders.get(projectId);
  if (!set) {
    set = new Set();
    expandedFolders.set(projectId, set);
  }
  return set;
}

export function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

export function toggleFolder(projectId: string, folderPath: string): boolean {
  const set = getExpandedSet(projectId);
  if (set.has(folderPath)) {
    set.delete(folderPath);
    return false;
  }
  set.add(folderPath);
  return true;
}

export function isExpanded(projectId: string, folderPath: string): boolean {
  return getExpandedSet(projectId).has(folderPath);
}

export function clearProjectState(projectId: string): void {
  expandedFolders.delete(projectId);
  closeFileTree(projectId);
}

export function closeFileTree(projectId: string): void {
  const watched = watchedByProject.get(projectId);
  if (watched) {
    for (const p of watched) window.vibeyard.fs.unwatchDir(p);
    watched.clear();
  }
  activeTrees.delete(projectId);
}

/** @internal Test-only: clear the module-level entry cache. */
export function _resetForTesting(): void {
  entryCache.clear();
  inflight.clear();
  expandedFolders.clear();
  watchedByProject.clear();
  activeTrees.clear();
  pendingDirs.clear();
  flushScheduled = false;
  if (unsubFileChanged) {
    unsubFileChanged();
    unsubFileChanged = null;
  }
}

async function loadEntries(folderPath: string): Promise<DirEntry[]> {
  const cached = entryCache.get(folderPath);
  if (cached) return cached;
  const pending = inflight.get(folderPath);
  if (pending) return pending;

  const promise = window.vibeyard.fs.listDir(folderPath).then((entries) => {
    const sorted = sortEntries(entries);
    entryCache.set(folderPath, sorted);
    inflight.delete(folderPath);
    return sorted;
  }).catch(() => {
    inflight.delete(folderPath);
    return [] as DirEntry[];
  });
  inflight.set(folderPath, promise);
  return promise;
}

function makeRow(depth: number, entry: DirEntry, projectId: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'file-tree-row' + (entry.isDirectory ? ' is-dir' : ' is-file');
  row.style.paddingLeft = `${20 + depth * 14}px`;
  row.title = entry.path;

  const chevron = document.createElement('span');
  chevron.className = 'file-tree-chevron';
  if (entry.isDirectory) {
    chevron.textContent = '▸';
    if (isExpanded(projectId, entry.path)) chevron.classList.add('expanded');
  } else {
    chevron.classList.add('is-placeholder');
  }

  const icon = document.createElement('span');
  icon.className = 'file-tree-icon';
  icon.textContent = entry.isDirectory ? '\u{1F4C1}' : '\u{1F4C4}';

  const label = document.createElement('span');
  label.className = 'file-tree-label';
  label.textContent = entry.name;

  row.appendChild(chevron);
  row.appendChild(icon);
  row.appendChild(label);
  return row;
}

function appendEmpty(container: HTMLElement, depth: number): void {
  const empty = document.createElement('div');
  empty.className = 'file-tree-empty';
  empty.style.paddingLeft = `${20 + depth * 14}px`;
  empty.textContent = '(empty)';
  container.appendChild(empty);
}

/**
 * Build the DOM nodes for one entry: a row, plus (for directories) its adjacent
 * `.file-tree-children` subcontainer. The row carries `data-entry-path` so the
 * reconciler can locate it; a directory row's subcontainer is always its
 * immediate next sibling.
 */
function createEntry(projectId: string, depth: number, entry: DirEntry): HTMLElement[] {
  const row = makeRow(depth, entry, projectId);
  row.dataset.entryPath = entry.path;

  if (entry.isDirectory) {
    const subContainer = document.createElement('div');
    subContainer.className = 'file-tree-children';

    if (isExpanded(projectId, entry.path)) {
      renderChildren(projectId, entry.path, depth + 1, subContainer);
    }

    row.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowExpanded = toggleFolder(projectId, entry.path);
      row.querySelector('.file-tree-chevron')!.classList.toggle('expanded', nowExpanded);
      if (nowExpanded) {
        renderChildren(projectId, entry.path, depth + 1, subContainer);
      } else {
        unwatchSubtree(projectId, entry.path);
        subContainer.innerHTML = '';
      }
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, [deleteMenuOption(entry)]);
    });
    return [row, subContainer];
  }

  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData(FILE_PATH_DRAG_TYPE, entry.path);
    e.dataTransfer.setData('text/plain', entry.path);
  });
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    appState.addFileReaderSession(projectId, entry.path);
  });
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      {
        label: 'Open in Browser',
        action: () => {
          appState.addBrowserTabSession(projectId, pathToFileURL(entry.path));
        },
      },
      {
        label: 'Properties',
        action: () => { showFileProperties(entry); },
      },
      deleteMenuOption(entry),
    ]);
  });
  return [row];
}

/** Full (re)build of a folder's children. Used for initial render and expand. */
async function renderChildren(
  projectId: string,
  folderPath: string,
  depth: number,
  container: HTMLElement
): Promise<void> {
  container.dataset.folderPath = folderPath;
  container.dataset.depth = String(depth);
  watchFolder(projectId, folderPath);
  const entries = await loadEntries(folderPath);
  container.innerHTML = '';

  if (entries.length === 0) {
    appendEmpty(container, depth);
    return;
  }

  for (const entry of entries) {
    for (const node of createEntry(projectId, depth, entry)) container.appendChild(node);
  }
}

/**
 * Incrementally update a folder's children against the current disk state:
 * remove vanished entries (unwatching their subtree), insert new entries at the
 * correct sorted position, and leave unchanged rows — and their expanded
 * subtrees, scroll, and selection — untouched. Far cheaper and less disruptive
 * than rebuilding, which is what makes live agent edits feel smooth.
 */
async function reconcileChildren(
  projectId: string,
  folderPath: string,
  depth: number,
  container: HTMLElement
): Promise<void> {
  const entries = await loadEntries(folderPath);
  const newByPath = new Map(entries.map((e) => [e.path, e] as const));

  // Index the rows currently rendered in this container (rows only; their
  // subcontainers are reached via nextElementSibling).
  const existing = new Map<string, HTMLElement>();
  for (const child of Array.from(container.children)) {
    if (child instanceof HTMLElement && child.dataset.entryPath) {
      existing.set(child.dataset.entryPath, child);
    }
  }

  if (entries.length === 0) {
    for (const [p, row] of existing) {
      if (row.classList.contains('is-dir')) unwatchSubtree(projectId, p, true);
    }
    container.innerHTML = '';
    appendEmpty(container, depth);
    return;
  }
  const emptyEl = container.querySelector(':scope > .file-tree-empty');
  if (emptyEl) emptyEl.remove();

  // Remove rows that vanished, or whose kind flipped (file <-> dir) — those get
  // recreated by the insertion pass below.
  for (const [p, row] of existing) {
    const next = newByPath.get(p);
    const kindMatches = next && next.isDirectory === row.classList.contains('is-dir');
    if (kindMatches) continue;
    const isDir = row.classList.contains('is-dir');
    const sub = isDir ? row.nextElementSibling : null;
    if (isDir) unwatchSubtree(projectId, p, true);
    row.remove();
    if (sub instanceof HTMLElement && sub.classList.contains('file-tree-children')) sub.remove();
    existing.delete(p);
  }

  // Insert added entries before the first following entry that already exists,
  // preserving sorted order without disturbing unchanged rows. Anchors are
  // precomputed in one backward pass so a burst of N new files in a folder is
  // O(N) rather than O(N²).
  const anchors: (HTMLElement | null)[] = new Array(entries.length);
  let nextExisting: HTMLElement | null = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    anchors[i] = nextExisting;
    const found = existing.get(entries[i].path);
    if (found) nextExisting = found;
  }
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (existing.has(entry.path)) continue;
    const nodes = createEntry(projectId, depth, entry);
    for (const node of nodes) container.insertBefore(node, anchors[i]);
    existing.set(entry.path, nodes[0]);
  }
}

async function showFileProperties(entry: DirEntry): Promise<void> {
  const [statResult, readResult] = await Promise.all([
    window.vibeyard.fs.stat(entry.path),
    window.vibeyard.fs.readFile(entry.path),
  ]);

  const rows: Array<{ label: string; value: string; mono?: boolean }> = [];
  rows.push({ label: 'Path', value: entry.path, mono: true });
  rows.push({ label: 'Type', value: fileTypeLabel(entry.name) });
  rows.push({ label: 'Size', value: statResult.ok ? formatBytes(statResult.size) : '—' });
  rows.push({ label: 'Modified', value: statResult.ok ? formatMtime(statResult.mtimeMs) : '—' });

  if (readResult.ok) {
    const lines = readResult.content.length === 0 ? 0 : readResult.content.split('\n').length;
    rows.push({ label: 'Lines', value: lines.toLocaleString() });
    if (readResult.content.length > TOKEN_COUNT_MAX_CHARS) {
      rows.push({ label: 'Tokens', value: 'too large to count' });
    } else {
      rows.push({ label: 'Tokens', value: `~ ${estimateTokens(readResult.content).toLocaleString()}` });
    }
  } else {
    const why = readResult.reason === 'binary' ? 'binary file' : 'unreadable';
    rows.push({ label: 'Lines', value: `— (${why})` });
    rows.push({ label: 'Tokens', value: `— (${why})` });
  }

  showPropertiesDialog(entry.name, rows);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let val = n / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

function formatMtime(ms: number): string {
  const diffSec = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  let rel: string;
  if (diffSec < 60) rel = `${diffSec}s ago`;
  else if (diffSec < 3600) rel = `${Math.floor(diffSec / 60)}m ago`;
  else if (diffSec < 86400) rel = `${Math.floor(diffSec / 3600)}h ago`;
  else if (diffSec < 86400 * 30) rel = `${Math.floor(diffSec / 86400)}d ago`;
  else rel = `${Math.floor(diffSec / (86400 * 30))}mo ago`;
  return `${rel} · ${new Date(ms).toLocaleString()}`;
}

function fileTypeLabel(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '(no ext)';
  return name.slice(dot + 1).toLowerCase();
}

function deleteMenuOption(entry: DirEntry): MenuOption {
  return {
    label: 'Delete',
    danger: true,
    action: () => confirmAndTrash(entry),
  };
}

function confirmAndTrash(entry: DirEntry): void {
  const kind = entry.isDirectory ? 'folder' : 'file';
  const message = entry.isDirectory
    ? `Move "${entry.name}" and its contents to the Trash?`
    : `Move "${entry.name}" to the Trash?`;
  showConfirmModal(
    `Delete ${kind}`,
    message,
    async () => {
      const result = await window.vibeyard.fs.trashItem(entry.path);
      if (!result.ok) {
        console.warn(`Failed to trash ${entry.path}: ${result.error ?? 'unknown error'}`);
      }
    },
    { confirmLabel: 'Delete', danger: true },
  );
}

export function renderFileTree(project: ProjectRecord, container: HTMLElement): void {
  ensureChangeSubscription();
  activeTrees.set(project.id, { project, container });
  container.innerHTML = '';
  renderChildren(project.id, project.path, 0, container);
}
