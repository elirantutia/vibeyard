import { appState, ProjectRecord } from '../state.js';
import { pathToFileURL } from '../file-url.js';
import { showContextMenu, MenuOption } from './board/board-context-menu.js';
import { showConfirmModal } from './modal.js';

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
  window.vibeyard.fs.watchFile(folderPath);
}

function unwatchFolder(projectId: string, folderPath: string): void {
  const set = watchedByProject.get(projectId);
  if (!set || !set.has(folderPath)) return;
  set.delete(folderPath);
  window.vibeyard.fs.unwatchFile(folderPath);
}

function ensureChangeSubscription(): void {
  if (unsubFileChanged) return;
  unsubFileChanged = window.vibeyard.fs.onFileChanged((changedPath) => {
    for (const [projectId, paths] of watchedByProject) {
      if (!paths.has(changedPath)) continue;
      entryCache.delete(changedPath);
      inflight.delete(changedPath);
      const reg = activeTrees.get(projectId);
      if (!reg) continue;
      const selector = `[data-folder-path="${CSS.escape(changedPath)}"]`;
      const target = reg.container.matches(selector)
        ? reg.container
        : reg.container.querySelector(selector);
      if (target instanceof HTMLElement) {
        const depth = Number(target.dataset.depth ?? '0');
        renderChildren(projectId, changedPath, depth, target);
      }
    }
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
    for (const p of watched) window.vibeyard.fs.unwatchFile(p);
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
    const empty = document.createElement('div');
    empty.className = 'file-tree-empty';
    empty.style.paddingLeft = `${20 + depth * 14}px`;
    empty.textContent = '(empty)';
    container.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const row = makeRow(depth, entry, projectId);
    container.appendChild(row);

    if (entry.isDirectory) {
      const subContainer = document.createElement('div');
      subContainer.className = 'file-tree-children';
      container.appendChild(subContainer);

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
          unwatchFolder(projectId, entry.path);
          subContainer.innerHTML = '';
        }
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, [deleteMenuOption(entry)]);
      });
    } else {
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
          deleteMenuOption(entry),
        ]);
      });
    }
  }
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
