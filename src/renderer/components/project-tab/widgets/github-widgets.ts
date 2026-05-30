import { appState } from '../../../state.js';
import { esc } from '../../../dom-utils.js';
import { ingestItems, isUnread, makeItemId, markRead, markAllReadInProject } from '../../../github-unread.js';
import type { GithubItem, ProviderId } from '../../../../shared/types.js';
import type { WidgetFactory, WidgetHost, WidgetInstance } from './widget-host.js';
import { DEFAULT_GITHUB_CONFIG, type GithubConfig } from './github-types.js';
import { setPendingPrompt } from '../../terminal-pane.js';
import { showTaskModal } from '../../board/board-task-modal.js';
import { getAvailableProviderMetas } from '../../../provider-availability.js';
import { showContextMenu } from '../../board/board-context-menu.js';

type ListKind = 'prs' | 'issues';

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

function makeGithubWidget(kind: ListKind, host: WidgetHost): WidgetInstance {
  const root = document.createElement('div');
  root.className = `widget-github widget-github-${kind}`;

  const toolbar = document.createElement('div');
  toolbar.className = 'widget-github-toolbar';
  root.appendChild(toolbar);

  const repoLabel = document.createElement('span');
  repoLabel.className = 'widget-github-repo';
  toolbar.appendChild(repoLabel);

  const markAllBtn = document.createElement('button');
  markAllBtn.className = 'widget-github-mark-all';
  markAllBtn.textContent = 'Mark all read';
  markAllBtn.title = 'Mark all visible items as read';
  markAllBtn.addEventListener('click', () => {
    markAllReadInProject(host.projectId);
    render();
  });
  toolbar.appendChild(markAllBtn);

  const body = document.createElement('div');
  body.className = 'widget-github-body';
  root.appendChild(body);

  let resolvedRepo: string | null = null;
  let lastConfigRepo: string | undefined = undefined;
  let items: GithubItem[] = [];
  let loading = false;
  let lastError: string | null = null;
  let pollHandle: number | null = null;
  let destroyed = false;
  const projectId = host.projectId;

  function getConfig(): GithubConfig {
    return { ...DEFAULT_GITHUB_CONFIG, ...host.getConfig<Partial<GithubConfig>>() };
  }

  async function ensureRepo(): Promise<string | null> {
    const cfg = getConfig();
    const trimmedOverride = cfg.repo?.trim();
    if (trimmedOverride && trimmedOverride.includes('/')) {
      if (resolvedRepo !== trimmedOverride) {
        resolvedRepo = trimmedOverride;
        lastConfigRepo = trimmedOverride;
      }
      return resolvedRepo;
    }
    // Cached auto-detect: only re-detect if the override was cleared since the last detection.
    if (resolvedRepo && lastConfigRepo === undefined) return resolvedRepo;
    const project = appState.projects.find(p => p.id === projectId);
    if (!project) return null;
    const detected = await window.vibeyard.github.detectRepo(project.path);
    if (detected) resolvedRepo = `${detected.owner}/${detected.repo}`;
    lastConfigRepo = undefined;
    return resolvedRepo;
  }

  function renderRow(item: GithubItem): HTMLElement {
    const repo = resolvedRepo!;
    const id = makeItemId(repo, item.number);
    const unread = isUnread(projectId, id);

    const row = document.createElement('div');
    row.className = 'widget-github-row' + (unread ? ' unread' : '');

    const info = document.createElement('div');
    info.className = 'widget-github-row-info';

    const title = document.createElement('div');
    title.className = 'widget-github-row-title';

    if (unread) {
      const dot = document.createElement('span');
      dot.className = 'widget-github-unread-dot';
      title.appendChild(dot);
    }

    const num = document.createElement('span');
    num.className = 'widget-github-row-num';
    num.textContent = `#${item.number}`;
    title.appendChild(num);

    const link = document.createElement('a');
    link.className = 'widget-github-row-link';
    link.textContent = item.title;
    link.href = item.html_url;
    link.title = item.html_url;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      markRead(projectId, repo, item);
      void window.vibeyard.app.openExternal(item.html_url);
      render();
    });
    title.appendChild(link);

    if (kind === 'prs' && item.draft) {
      const draft = document.createElement('span');
      draft.className = 'widget-github-badge widget-github-badge-draft';
      draft.textContent = 'draft';
      title.appendChild(draft);
    }
    if (kind === 'prs' && item.merged_at) {
      const merged = document.createElement('span');
      merged.className = 'widget-github-badge widget-github-badge-merged';
      merged.textContent = 'merged';
      title.appendChild(merged);
    } else if (item.state === 'closed') {
      const closed = document.createElement('span');
      closed.className = 'widget-github-badge widget-github-badge-closed';
      closed.textContent = 'closed';
      title.appendChild(closed);
    }

    info.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'widget-github-row-meta';
    const author = item.user?.login ?? 'unknown';
    meta.innerHTML = `${esc(author)} · ${esc(timeAgo(item.updated_at))}`;
    info.appendChild(meta);

    row.appendChild(info);

    if (kind === 'issues') {
      row.appendChild(buildIssueActions(projectId, repo, item, render));
    } else if (kind === 'prs') {
      row.appendChild(buildPRActions(projectId, repo, item, render));
    }

    return row;
  }

  function render(): void {
    if (destroyed) return;
    body.innerHTML = '';
    repoLabel.textContent = resolvedRepo ?? 'No repo configured';

    if (lastError) {
      const err = document.createElement('div');
      err.className = 'widget-github-error';
      err.textContent = lastError;
      body.appendChild(err);
      return;
    }

    if (loading && items.length === 0) {
      const l = document.createElement('div');
      l.className = 'widget-github-loading';
      l.textContent = 'Loading…';
      body.appendChild(l);
      return;
    }

    if (!resolvedRepo) {
      const empty = document.createElement('div');
      empty.className = 'widget-github-empty';
      empty.textContent = 'No GitHub remote detected. Open settings to set a repo.';
      body.appendChild(empty);
      return;
    }

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'widget-github-empty';
      empty.textContent = kind === 'prs' ? 'No pull requests.' : 'No issues.';
      body.appendChild(empty);
      return;
    }

    for (const item of items) body.appendChild(renderRow(item));
  }

  async function refresh(): Promise<void> {
    if (destroyed) return;
    loading = true;
    lastError = null;
    render();

    const repo = await ensureRepo();
    if (destroyed) return;
    if (!repo) {
      loading = false;
      render();
      return;
    }

    if (!(await window.vibeyard.github.isAvailable())) {
      lastError = 'gh CLI not installed. Install from cli.github.com and run `gh auth login`.';
      loading = false;
      render();
      return;
    }

    const cfg = getConfig();
    const result = kind === 'prs'
      ? await window.vibeyard.github.listPRs(repo, cfg.state, cfg.max)
      : await window.vibeyard.github.listIssues(repo, cfg.state, cfg.max);
    if (destroyed) return;

    if (!result.ok) {
      lastError = result.error ?? 'Failed to fetch from GitHub.';
      loading = false;
      render();
      return;
    }

    items = result.items ?? [];
    ingestItems(projectId, repo, items);
    loading = false;
    render();
  }

  function startPolling(): void {
    stopPolling();
    const cfg = getConfig();
    const intervalMs = Math.max(60_000, cfg.refreshSeconds * 1000);
    pollHandle = window.setInterval(() => {
      if (document.hidden) return;
      void refresh();
    }, intervalMs);
  }

  function stopPolling(): void {
    if (pollHandle !== null) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  }

  const onVisibility = () => {
    if (!document.hidden) void refresh();
  };
  document.addEventListener('visibilitychange', onVisibility);

  const unsubUnread = (() => {
    // Re-render rows when this project's unread set changes (e.g. cross-widget mark-read).
    const off = appState.on('github-unread-changed', (data) => {
      const id = typeof data === 'string' ? data : undefined;
      if (id && id !== projectId) return;
      render();
    });
    return off;
  })();

  void refresh().then(() => startPolling());

  return {
    element: root,
    destroy() {
      destroyed = true;
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibility);
      unsubUnread();
    },
    refresh() {
      void refresh();
    },
  };
}

function buildIssueActions(
  projectId: string,
  repo: string,
  item: GithubItem,
  rerender: () => void,
): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'widget-github-row-actions';

  const onAction = (run: () => void) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    markRead(projectId, repo, item);
    run();
    rerender();
  };

  const planProviders = getAvailableProviderMetas().filter(p => p.capabilities.planModeArg);

  const fixGroup = document.createElement('div');
  fixGroup.className = 'widget-github-fix-group';

  const fixBtn = document.createElement('button');
  fixBtn.className = 'btn-primary btn-xs widget-github-fix-main';
  fixBtn.textContent = 'Fix';
  fixBtn.title = `Plan a solution for #${item.number} in a new session`;
  fixBtn.addEventListener('click', onAction(() => startFixSession(projectId, item)));
  fixGroup.appendChild(fixBtn);

  if (planProviders.length > 1) {
    const chevron = document.createElement('button');
    chevron.className = 'btn-primary btn-xs widget-github-fix-dropdown';
    chevron.textContent = '▼';
    chevron.title = 'Plan in another provider';
    chevron.setAttribute('aria-label', 'Plan in another provider');
    chevron.setAttribute('aria-haspopup', 'menu');
    chevron.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = chevron.getBoundingClientRect();
      showContextMenu(
        r.right,
        r.bottom + 4,
        planProviders.map(p => ({
          label: p.displayName,
          action: () => {
            markRead(projectId, repo, item);
            startFixSession(projectId, item, p.id);
            rerender();
          },
        })),
      );
    });
    fixGroup.appendChild(chevron);
  }

  actions.appendChild(fixGroup);

  const kanbanBtn = document.createElement('button');
  kanbanBtn.className = 'btn-primary btn-xs';
  kanbanBtn.textContent = 'Add to Kanban';
  kanbanBtn.title = 'Create a board task from this issue';
  kanbanBtn.addEventListener('click', onAction(() => addIssueToKanban(item)));
  actions.appendChild(kanbanBtn);

  return actions;
}

function startFixSession(projectId: string, item: GithubItem, providerId?: ProviderId): void {
  const session = appState.addPlanSession(projectId, `Issue #${item.number}`, true, providerId);
  if (!session) return;
  setPendingPrompt(session.id, `Plan a solution for this issue #${item.number}: ${item.html_url}`);
}

function buildPRActions(
  projectId: string,
  repo: string,
  item: GithubItem,
  rerender: () => void,
): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'widget-github-row-actions';

  const onAction = (run: () => void) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    markRead(projectId, repo, item);
    run();
    rerender();
  };

  const reviewProviders = getAvailableProviderMetas().filter(p => p.id !== 'gemini');

  const reviewGroup = document.createElement('div');
  reviewGroup.className = 'widget-github-fix-group';

  const reviewBtn = document.createElement('button');
  reviewBtn.className = 'btn-primary btn-xs widget-github-fix-main';
  reviewBtn.textContent = 'Review';
  reviewBtn.title = `Review PR #${item.number} in a new session`;
  reviewBtn.addEventListener('click', onAction(() => startReviewSession(projectId, item)));
  reviewGroup.appendChild(reviewBtn);

  if (reviewProviders.length > 1) {
    const chevron = document.createElement('button');
    chevron.className = 'btn-primary btn-xs widget-github-fix-dropdown';
    chevron.textContent = '▼';
    chevron.title = 'Review in another provider';
    chevron.setAttribute('aria-label', 'Review in another provider');
    chevron.setAttribute('aria-haspopup', 'menu');
    chevron.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = chevron.getBoundingClientRect();
      showContextMenu(
        r.right,
        r.bottom + 4,
        reviewProviders.map(p => ({
          label: p.displayName,
          action: () => {
            markRead(projectId, repo, item);
            startReviewSession(projectId, item, p.id);
            rerender();
          },
        })),
      );
    });
    reviewGroup.appendChild(chevron);
  }

  actions.appendChild(reviewGroup);

  const kanbanBtn = document.createElement('button');
  kanbanBtn.className = 'btn-primary btn-xs';
  kanbanBtn.textContent = 'Add to Kanban';
  kanbanBtn.title = 'Create a board task from this PR';
  kanbanBtn.addEventListener('click', onAction(() => addPRToKanban(item)));
  actions.appendChild(kanbanBtn);

  return actions;
}

function startReviewSession(projectId: string, item: GithubItem, providerId?: ProviderId): void {
  const session = appState.addSession(projectId, `Review #${item.number}`, undefined, providerId);
  if (!session) return;
  setPendingPrompt(session.id, `/review pr #${item.number} ${item.html_url}`);
}

function addIssueToKanban(item: GithubItem): void {
  showTaskModal('create', undefined, undefined, {
    title: item.title,
    prompt: `Plan a solution for this issue #${item.number}: ${item.html_url}`,
    tags: ['github-issues'],
  });
}

function addPRToKanban(item: GithubItem): void {
  showTaskModal('create', undefined, undefined, {
    title: `[Review] ${item.title}`,
    prompt: `/review pr #${item.number} ${item.html_url}`,
    tags: ['github-prs'],
  });
}

export const createGithubPRsWidget: WidgetFactory = (host) => makeGithubWidget('prs', host);
export const createGithubIssuesWidget: WidgetFactory = (host) => makeGithubWidget('issues', host);
