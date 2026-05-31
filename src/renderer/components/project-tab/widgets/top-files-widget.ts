import type { TopFile, ProviderId, CliProviderMeta } from '../../../../shared/types.js';
import { buildSplitFilesPrompt } from '../../../../shared/split-file-prompt.js';
import { appState } from '../../../state.js';
import { formatTokens } from '../../../session-cost.js';
import { setPendingPrompt } from '../../terminal-pane.js';
import { getAvailableProviderMetas } from '../../../provider-availability.js';
import { showContextMenu } from '../../board/board-context-menu.js';
import type { WidgetFactory } from './widget-host.js';
import { resolveTopFilesConfig, type TopFilesConfig } from './top-files-types.js';

export const createTopFilesWidget: WidgetFactory = (host) => {
  const root = document.createElement('div');
  root.className = 'widget-top-files';

  const body = document.createElement('div');
  body.className = 'widget-top-files-body';
  root.appendChild(body);

  let renderToken = 0;

  function setStatus(message: string, kind: 'loading' | 'empty'): void {
    const el = document.createElement('div');
    el.className = kind === 'loading' ? 'widget-top-files-loading' : 'widget-top-files-empty';
    el.textContent = message;
    body.replaceChildren(el);
  }

  function renderRows(files: TopFile[]): void {
    if (files.length === 0) {
      setStatus('No countable text files found.', 'empty');
      return;
    }
    const list = document.createElement('div');
    list.className = 'widget-top-files-list';
    // Identical for every row in this render pass — compute once, not per row.
    const planProviders = getAvailableProviderMetas().filter((p) => p.capabilities.planModeArg);
    for (const file of files) {
      list.appendChild(buildRow(file, planProviders));
    }
    body.replaceChildren(list);
  }

  function buildRow(file: TopFile, planProviders: CliProviderMeta[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'widget-top-files-row';
    row.title = `${file.path} — ${file.tokens.toLocaleString()} tokens`;

    const name = document.createElement('div');
    name.className = 'widget-top-files-row-path';
    name.textContent = file.path;
    row.appendChild(name);

    const tokens = document.createElement('div');
    tokens.className = 'widget-top-files-row-tokens';
    tokens.textContent = `~ ${formatTokens(file.tokens)}`;
    row.appendChild(tokens);

    row.appendChild(buildRowActions(file, planProviders));

    row.addEventListener('click', () => {
      appState.addFileReaderSession(host.projectId, file.path);
    });

    return row;
  }

  function buildRowActions(file: TopFile, planProviders: CliProviderMeta[]): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'widget-top-files-row-actions';

    const fixGroup = document.createElement('div');
    fixGroup.className = 'widget-github-fix-group';

    const splitBtn = document.createElement('button');
    splitBtn.className = 'btn-primary btn-xs widget-github-fix-main';
    splitBtn.textContent = 'Split';
    splitBtn.title = `Split ${file.path} into smaller modules in a new session`;
    splitBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startSplitSession(file.path);
    });
    fixGroup.appendChild(splitBtn);

    if (planProviders.length > 1) {
      const chevron = document.createElement('button');
      chevron.className = 'btn-primary btn-xs widget-github-fix-dropdown';
      chevron.textContent = '▼';
      chevron.title = 'Split in another provider';
      chevron.setAttribute('aria-label', 'Split in another provider');
      chevron.setAttribute('aria-haspopup', 'menu');
      chevron.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const r = chevron.getBoundingClientRect();
        showContextMenu(
          r.right,
          r.bottom + 4,
          planProviders.map((p) => ({
            label: p.displayName,
            action: () => startSplitSession(file.path, p.id),
          })),
        );
      });
      fixGroup.appendChild(chevron);
    }

    actions.appendChild(fixGroup);
    return actions;
  }

  function startSplitSession(filePath: string, providerId?: ProviderId): void {
    const session = appState.addPlanSession(host.projectId, `Split: ${filePath}`, true, providerId);
    if (!session) return;
    setPendingPrompt(session.id, buildSplitFilesPrompt([filePath]));
  }

  async function loadAndRender(): Promise<void> {
    const token = ++renderToken;
    const project = appState.projects.find((p) => p.id === host.projectId);
    if (!project) {
      setStatus('Project not found.', 'empty');
      return;
    }

    const { limit } = resolveTopFilesConfig(host.getConfig<Partial<TopFilesConfig>>());
    setStatus('Scanning project files…', 'loading');

    try {
      const result = await window.vibeyard.fs.topFilesByTokens(project.path, limit);
      if (token !== renderToken) return;
      if (!result.ok) {
        setStatus('Could not scan project files.', 'empty');
        return;
      }
      renderRows(result.files);
    } catch {
      if (token !== renderToken) return;
      setStatus('Could not scan project files.', 'empty');
    }
  }

  void loadAndRender();

  return {
    element: root,
    destroy() {
      // Invalidate any in-flight loadAndRender so it short-circuits before touching the detached DOM.
      renderToken++;
    },
    refresh() {
      void loadAndRender();
    },
  };
};
