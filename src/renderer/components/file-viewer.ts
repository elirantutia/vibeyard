import { appState } from '../state.js';
import { areaLabel } from '../dom-utils.js';
import { destroySearchBar } from './search-bar.js';

interface FileViewerInstance {
  element: HTMLElement;
  filePath: string;
  area: string;
  worktreePath?: string;
  resolvedPath: string | null;
  loaded: boolean;
}

const instances = new Map<string, FileViewerInstance>();
let unwatchFileChanged: (() => void) | null = null;

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function parseDiffLines(diff: string): HTMLElement {
  const content = document.createElement('div');
  content.className = 'file-viewer-content';

  for (const line of diff.split('\n')) {
    const div = document.createElement('div');
    div.className = 'diff-line';

    if (line.startsWith('@@')) {
      div.classList.add('hunk');
    } else if (line.startsWith('+')) {
      div.classList.add('added');
    } else if (line.startsWith('-')) {
      div.classList.add('removed');
    } else {
      div.classList.add('context');
    }

    div.innerHTML = escapeHtml(line) || '&nbsp;';
    content.appendChild(div);
  }

  return content;
}

function resolveFilePath(instance: FileViewerInstance): string {
  const project = appState.activeProject;
  const basePath = instance.worktreePath ?? project?.path ?? '';
  return instance.filePath.startsWith('/')
    ? instance.filePath
    : `${basePath}/${instance.filePath}`;
}

let loadGeneration = 0;

async function loadDiff(instance: FileViewerInstance): Promise<void> {
  if (instance.loaded) return;

  const project = appState.activeProject;
  if (!project) return;

  const body = instance.element.querySelector('.file-viewer-body')!;
  const isFirstLoad = !body.hasChildNodes();

  if (isFirstLoad) {
    const loading = document.createElement('div');
    loading.className = 'file-viewer-content';
    loading.innerHTML = '<div class="diff-line context">Loading diff...</div>';
    body.appendChild(loading);
  }

  const gen = ++loadGeneration;

  try {
    const diff = await window.vibeyard.git.getDiff(instance.worktreePath ?? project.path, instance.filePath, instance.area);
    if (gen !== loadGeneration) return; // superseded by a newer load
    body.innerHTML = '';
    body.appendChild(parseDiffLines(diff));
    instance.loaded = true;
  } catch {
    if (gen !== loadGeneration) return;
    body.innerHTML = '';
    const err = document.createElement('div');
    err.className = 'file-viewer-content';
    err.innerHTML = '<div class="diff-line context">Failed to load diff</div>';
    body.appendChild(err);
  }
}

function ensureFileChangedListener(): void {
  if (unwatchFileChanged) return;
  unwatchFileChanged = window.vibeyard.fs.onFileChanged((changedPath: string) => {
    for (const [sessionId, instance] of instances) {
      if (instance.resolvedPath === changedPath && instance.loaded) {
        reloadFileViewer(sessionId);
      }
    }
  });
}

export function createFileViewerPane(sessionId: string, filePath: string, area: string, worktreePath?: string): void {
  if (instances.has(sessionId)) return;

  const el = document.createElement('div');
  el.className = 'file-viewer-pane';
  el.style.display = 'none';

  // Header
  const header = document.createElement('div');
  header.className = 'file-viewer-header';

  const pathSpan = document.createElement('span');
  pathSpan.className = 'file-viewer-path';
  pathSpan.textContent = filePath;

  const areaBadge = document.createElement('span');
  areaBadge.className = `file-viewer-area-badge ${area}`;
  areaBadge.textContent = areaLabel(area);

  header.appendChild(pathSpan);
  header.appendChild(areaBadge);
  el.appendChild(header);

  // Scrollable body
  const body = document.createElement('div');
  body.className = 'file-viewer-body';
  el.appendChild(body);

  const instance: FileViewerInstance = { element: el, filePath, area, worktreePath, resolvedPath: null, loaded: false };
  instances.set(sessionId, instance);
}

export function destroyFileViewerPane(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (instance.resolvedPath) {
    window.vibeyard.fs.unwatchFile(instance.resolvedPath);
  }
  destroySearchBar(sessionId);
  instance.element.remove();
  instances.delete(sessionId);
}

export function showFileViewerPane(sessionId: string, isSplit: boolean): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.element.style.display = 'flex';
  if (isSplit) instance.element.classList.add('split');
  else instance.element.classList.remove('split');

  // Start watching the file for external changes
  if (!instance.resolvedPath) {
    const fullPath = resolveFilePath(instance);
    instance.resolvedPath = fullPath;
    ensureFileChangedListener();
    window.vibeyard.fs.watchFile(fullPath);
  }

  loadDiff(instance);
}

export function hideAllFileViewerPanes(): void {
  for (const instance of instances.values()) {
    instance.element.style.display = 'none';
  }
}

export function attachFileViewerToContainer(sessionId: string, container: HTMLElement): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (instance.element.parentElement !== container) {
    container.appendChild(instance.element);
  }
}

export function getFileViewerInstance(sessionId: string): FileViewerInstance | undefined {
  return instances.get(sessionId);
}

/** Called from git-panel when a file row is clicked */
export function showFileViewer(filePath: string, area: string, worktreePath?: string): void {
  const project = appState.activeProject;
  if (!project) return;
  appState.addDiffViewerSession(project.id, filePath, area, worktreePath);
}

/** Reload the diff content for a given session (e.g. after git changes) */
export function reloadFileViewer(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.loaded = false;
  loadDiff(instance);
}
