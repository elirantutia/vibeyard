import { appState } from '../state.js';
import { ProjectRecord, Preferences } from '../../shared/types.js';
import { getStatus, SessionStatus, onChange as onActivityChange } from '../session-activity.js';
import { STATUS_PRIORITY } from '../project-status.js';
import { isCliSession } from '../session-utils.js';
import { esc } from '../dom-utils.js';
import { t } from '../i18n.js';
import { closeSessionWithConfirm } from '../session-close.js';

export interface ActiveSessionRow {
  projectId: string;
  projectName: string;
  sessionId: string;
  sessionName: string;
  status: SessionStatus;
  /** Tab closed, session kept: only reachable from this panel. */
  detached: boolean;
}

type ActiveStatusConfig = NonNullable<Preferences['activeSessionStatuses']>;

/** The status keys a session can be filtered on, and the canonical default set. */
export const ACTIVE_STATUS_KEYS = ['working', 'waiting', 'input', 'completed'] as const;
export const DEFAULT_ACTIVE_SESSION_STATUSES: ActiveStatusConfig = {
  working: true,
  waiting: false,
  input: true,
  completed: true,
};

/** Resolve the configured set of statuses that count as "active". */
export function resolveActiveStatuses(prefs: Preferences): Set<SessionStatus> {
  const cfg = prefs.activeSessionStatuses ?? DEFAULT_ACTIVE_SESSION_STATUSES;
  return new Set(ACTIVE_STATUS_KEYS.filter((k) => cfg[k]));
}

/**
 * Pure selector: gather every open CLI session across all projects whose live
 * status is in `activeStatuses`, ordered by urgency (`STATUS_PRIORITY`) then
 * project name. Detached sessions (tab closed, session kept) are always
 * included whatever their status — this panel is the only place they show up.
 * `includeTabbed: false` limits the list to detached sessions (used with a
 * single project, where tabbed rows would just duplicate its tab bar).
 * DOM-free so it can be unit-tested.
 */
export function selectActiveSessions(
  projects: ProjectRecord[],
  statusOf: (sessionId: string) => SessionStatus,
  activeStatuses: Set<SessionStatus>,
  includeTabbed = true,
): ActiveSessionRow[] {
  const rows: ActiveSessionRow[] = [];
  for (const project of projects) {
    for (const session of project.sessions) {
      if (!isCliSession(session)) continue;
      const status = statusOf(session.id);
      const detached = !!session.detached;
      if (!detached && (!includeTabbed || !activeStatuses.has(status))) continue;
      rows.push({
        projectId: project.id,
        projectName: project.name,
        sessionId: session.id,
        sessionName: session.name,
        status,
        detached,
      });
    }
  }
  rows.sort((a, b) => {
    const pa = STATUS_PRIORITY.indexOf(a.status);
    const pb = STATUS_PRIORITY.indexOf(b.status);
    if (pa !== pb) return pa - pb;
    return a.projectName.localeCompare(b.projectName);
  });
  return rows;
}

let containerEl: HTMLElement | null = null;

/** Rebuild the sidebar Active Sessions section from current state. */
export function renderActiveSessions(): void {
  if (!containerEl) return;

  // Never wipe DOM mid-selection (mirrors the ui-dev re-render guard).
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed && containerEl.contains(sel.anchorNode)) {
    return;
  }

  // Tabbed rows are only meaningful across multiple projects — with a single
  // project they just duplicate its own tab bar. Detached sessions have no tab,
  // so they are listed regardless.
  const enabled = appState.preferences.sidebarViews?.activeSessions ?? true;
  const rows = enabled
    ? selectActiveSessions(
        appState.projects,
        getStatus,
        resolveActiveStatuses(appState.preferences),
        appState.projects.length > 1,
      )
    : [];

  if (rows.length === 0) {
    containerEl.classList.add('hidden');
    containerEl.innerHTML = '';
    return;
  }

  containerEl.classList.remove('hidden');
  containerEl.innerHTML = `
    <div class="active-sessions-header">
      <span class="active-sessions-title">${esc(t('sidebar.activeSessions.title'))}</span>
      <span class="active-sessions-count">${rows.length}</span>
    </div>
    <div class="active-sessions-list">
      ${rows.map(rowHtml).join('')}
    </div>
  `;
}

function rowHtml(row: ActiveSessionRow): string {
  const title = row.detached
    ? `${row.projectName} · ${t('sidebar.activeSessions.detachedTooltip')}`
    : row.projectName;
  return `
    <div class="active-session-row${row.detached ? ' detached' : ''}" data-project-id="${esc(row.projectId)}" data-session-id="${esc(row.sessionId)}" title="${esc(title)}">
      <span class="project-status ${row.status}" aria-hidden="true"></span>
      <span class="active-session-name">${esc(row.sessionName)}</span>
      <span class="active-session-project">${esc(row.projectName)}</span>
      <button type="button" class="active-session-close" title="${esc(t('sidebar.activeSessions.closeTooltip'))}" aria-label="${esc(t('sidebar.activeSessions.closeTooltip'))}">&times;</button>
    </div>
  `;
}

// Coalesce the many event sources that can invalidate the panel into a single
// rebuild per frame — a burst (e.g. state-loaded plus a wave of session-added)
// collapses to one render.
let renderScheduled = false;
function scheduleRender(): void {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    renderActiveSessions();
  });
}

/** Wire the sidebar Active Sessions section; call once at startup. */
export function initActiveSessions(): void {
  containerEl = document.getElementById('sidebar-active-sessions');
  if (!containerEl) return;

  // One delegated click listener survives every innerHTML rebuild.
  containerEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>('.active-session-row');
    const projectId = row?.dataset.projectId;
    const sessionId = row?.dataset.sessionId;
    if (!projectId || !sessionId) return;
    // The X ends the session for good (the tab-bar X only closes the tab).
    if (target.closest('.active-session-close')) {
      closeSessionWithConfirm(projectId, sessionId);
      return;
    }
    // Activating a detached session gives it its tab back (setActiveSession).
    appState.setActiveProject(projectId);
    appState.setActiveSession(projectId, sessionId);
  });

  onActivityChange(scheduleRender);
  for (const event of [
    'session-added',
    'session-removed',
    'session-changed',
    'project-added',
    'project-changed',
    'project-removed',
    'state-loaded',
    'preferences-changed',
  ] as const) {
    appState.on(event, scheduleRender);
  }

  renderActiveSessions();
}
