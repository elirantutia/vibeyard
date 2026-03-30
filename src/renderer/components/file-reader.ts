import { appState } from '../state.js';
import { destroySearchBar } from './search-bar.js';

interface FileReaderInstance {
  element: HTMLElement;
  filePath: string;
  resolvedPath: string | null;
  loaded: boolean;
  targetLine?: number;
}

const instances = new Map<string, FileReaderInstance>();
let unwatchFileChanged: (() => void) | null = null;

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function renderFileContent(content: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'file-reader-content';

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const row = document.createElement('div');
    row.className = 'file-reader-line';

    const lineNum = document.createElement('span');
    lineNum.className = 'file-reader-line-num';
    lineNum.textContent = String(i + 1);

    const lineText = document.createElement('span');
    lineText.className = 'file-reader-line-text';
    lineText.innerHTML = escapeHtml(lines[i]) || '&nbsp;';

    row.appendChild(lineNum);
    row.appendChild(lineText);
    wrapper.appendChild(row);
  }

  return wrapper;
}

function resolveFilePath(instance: FileReaderInstance): string {
  const project = appState.activeProject;
  if (instance.filePath.startsWith('/')) return instance.filePath;
  return project ? `${project.path}/${instance.filePath}` : instance.filePath;
}

async function loadFile(instance: FileReaderInstance): Promise<void> {
  if (instance.loaded) return;

  const project = appState.activeProject;
  if (!project) return;

  const body = instance.element.querySelector('.file-reader-body')!;
  body.innerHTML = '';
  const loading = document.createElement('div');
  loading.className = 'file-reader-content';
  loading.innerHTML = '<div class="file-reader-line"><span class="file-reader-line-text">Loading...</span></div>';
  body.appendChild(loading);

  try {
    const fullPath = resolveFilePath(instance);
    const content = await window.vibeyard.fs.readFile(fullPath);
    body.innerHTML = '';
    body.appendChild(renderFileContent(content));
    instance.loaded = true;
    if (instance.targetLine) {
      scrollToLine(instance);
    }
  } catch {
    body.innerHTML = '<div class="file-reader-content"><div class="file-reader-line"><span class="file-reader-line-text">Failed to load file</span></div></div>';
  }
}

function ensureFileChangedListener(): void {
  if (unwatchFileChanged) return;
  unwatchFileChanged = window.vibeyard.fs.onFileChanged((changedPath: string) => {
    for (const [sessionId, instance] of instances) {
      if (instance.resolvedPath === changedPath && instance.loaded) {
        reloadFileReader(sessionId);
      }
    }
  });
}

export function reloadFileReader(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.loaded = false;
  loadFile(instance);
}

export function createFileReaderPane(sessionId: string, filePath: string, targetLine?: number): void {
  if (instances.has(sessionId)) return;

  const el = document.createElement('div');
  el.className = 'file-reader-pane';
  el.style.display = 'none';

  // Header
  const header = document.createElement('div');
  header.className = 'file-viewer-header';

  const pathSpan = document.createElement('span');
  pathSpan.className = 'file-viewer-path';
  pathSpan.textContent = filePath;

  const badge = document.createElement('span');
  badge.className = 'file-reader-badge';
  badge.textContent = 'READ-ONLY';

  header.appendChild(pathSpan);
  header.appendChild(badge);
  el.appendChild(header);

  // Scrollable body
  const body = document.createElement('div');
  body.className = 'file-reader-body';
  el.appendChild(body);

  const instance: FileReaderInstance = { element: el, filePath, resolvedPath: null, loaded: false, targetLine };
  instances.set(sessionId, instance);
}

export function destroyFileReaderPane(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (instance.resolvedPath) {
    window.vibeyard.fs.unwatchFile(instance.resolvedPath);
  }
  destroySearchBar(sessionId);
  destroyGoToLineBar(sessionId);
  instance.element.remove();
  instances.delete(sessionId);
}

export function showFileReaderPane(sessionId: string, isSplit: boolean): void {
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

  loadFile(instance);
  if (instance.loaded && instance.targetLine) {
    scrollToLine(instance);
  }
}

export function setFileReaderLine(sessionId: string, line: number): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.targetLine = line;
  if (instance.loaded) {
    scrollToLine(instance);
  }
}

function scrollToLine(instance: FileReaderInstance): void {
  const line = instance.targetLine;
  if (!line) return;

  const body = instance.element.querySelector('.file-reader-body');
  if (!body) return;

  // Clear previous highlights
  body.querySelectorAll('.file-reader-line-highlight').forEach((el) => {
    el.classList.remove('file-reader-line-highlight');
  });

  const lines = body.querySelectorAll('.file-reader-line');
  const targetEl = lines[line - 1] as HTMLElement | undefined;
  if (!targetEl) return;

  targetEl.classList.add('file-reader-line-highlight');
  requestAnimationFrame(() => {
    targetEl.scrollIntoView({ block: 'center' });
  });
}

export function hideAllFileReaderPanes(): void {
  for (const instance of instances.values()) {
    instance.element.style.display = 'none';
  }
}

export function attachFileReaderToContainer(sessionId: string, container: HTMLElement): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (instance.element.parentElement !== container) {
    container.appendChild(instance.element);
  }
}

export function getFileReaderInstance(sessionId: string): FileReaderInstance | undefined {
  return instances.get(sessionId);
}

const goToLineBars = new Map<string, { bar: HTMLDivElement; input: HTMLInputElement }>();

export function showGoToLineBar(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;

  const existing = goToLineBars.get(sessionId);
  if (existing) {
    existing.bar.classList.remove('hidden');
    existing.input.focus();
    existing.input.select();
    return;
  }

  const bar = document.createElement('div');
  bar.className = 'goto-line-bar';

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.placeholder = 'Go to line...';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'search-nav-btn search-close-btn';
  closeBtn.textContent = '\u2715';
  closeBtn.title = 'Close (Escape)';

  bar.appendChild(input);
  bar.appendChild(closeBtn);

  instance.element.appendChild(bar);
  goToLineBars.set(sessionId, { bar, input });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const line = parseInt(input.value, 10);
      if (line > 0) {
        setFileReaderLine(sessionId, line);
      }
      hideGoToLineBar(sessionId);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideGoToLineBar(sessionId);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
      e.preventDefault();
      input.select();
    }
  });

  closeBtn.addEventListener('click', () => hideGoToLineBar(sessionId));

  input.focus();
}

export function hideGoToLineBar(sessionId: string): void {
  const entry = goToLineBars.get(sessionId);
  if (!entry) return;
  entry.bar.classList.add('hidden');
  const instance = instances.get(sessionId);
  if (instance) {
    instance.element.querySelector('.file-reader-body')?.focus();
  }
}

function destroyGoToLineBar(sessionId: string): void {
  const entry = goToLineBars.get(sessionId);
  if (!entry) return;
  entry.bar.remove();
  goToLineBars.delete(sessionId);
}
