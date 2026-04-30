import type { ArchivedSession, SessionRecord, TeamMember } from '../../../shared/types.js';
import { appState } from '../../state.js';
import { closeModal, registerModalCleanup } from '../modal.js';
import { isCliSession } from '../../session-utils.js';
import { getProviderDisplayName } from '../../provider-availability.js';

const overlay = document.getElementById('modal-overlay')!;
const titleEl = document.getElementById('modal-title')!;
const bodyEl = document.getElementById('modal-body')!;
const btnCancel = document.getElementById('modal-cancel') as HTMLButtonElement;
const btnConfirm = document.getElementById('modal-confirm') as HTMLButtonElement;

interface SessionRow {
  name: string;
  meta: string;
  onClick?: () => void;
}

export function showMemberSessionsModal(member: TeamMember, projectId: string): void {
  const project = appState.projects.find((p) => p.id === projectId);
  if (!project) return;

  const active = project.sessions
    .filter((s) => s.teamMemberId === member.id && isCliSession(s))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const activeCliIds = new Set(active.map((s) => s.cliSessionId).filter(Boolean));
  const archived = (project.sessionHistory ?? [])
    .filter((a) => a.teamMemberId === member.id && !(a.cliSessionId && activeCliIds.has(a.cliSessionId)))
    .sort((a, b) => b.closedAt.localeCompare(a.closedAt));

  closeModal();

  titleEl.textContent = `Sessions with ${member.name}`;
  bodyEl.innerHTML = '';

  if (active.length === 0 && archived.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'team-sessions-empty';
    empty.textContent = `No chat sessions yet for ${member.name}.`;
    bodyEl.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'team-sessions-list';

    for (const session of active) list.appendChild(buildRow(activeRow(session, projectId)));
    for (const entry of archived) list.appendChild(buildRow(archivedRow(entry, projectId)));

    bodyEl.appendChild(list);
  }

  btnConfirm.style.display = 'none';
  btnCancel.textContent = 'Close';
  overlay.classList.remove('hidden');

  const handleCancel = () => closeModal();
  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    }
  };

  btnCancel.addEventListener('click', handleCancel);
  document.addEventListener('keydown', handleKeydown);
  registerModalCleanup(() => {
    btnCancel.removeEventListener('click', handleCancel);
    document.removeEventListener('keydown', handleKeydown);
  });
}

function activeRow(session: SessionRecord, projectId: string): SessionRow {
  const provider = getProviderDisplayName(session.providerId ?? 'claude');
  return {
    name: session.name,
    meta: `Open · started ${formatRelative(Date.parse(session.createdAt))} · ${provider}`,
    onClick: () => {
      appState.setActiveSession(projectId, session.id);
      closeModal();
    },
  };
}

function archivedRow(entry: ArchivedSession, projectId: string): SessionRow {
  const canResume = !!entry.cliSessionId;
  const provider = getProviderDisplayName(entry.providerId);
  return {
    name: entry.name,
    meta: `Closed · ${formatRelative(Date.parse(entry.closedAt))}${canResume ? '' : ' · cannot resume'} · ${provider}`,
    onClick: canResume
      ? () => {
          appState.resumeFromHistory(projectId, entry.id);
          closeModal();
        }
      : undefined,
  };
}

function buildRow({ name, meta, onClick }: SessionRow): HTMLElement {
  const row = document.createElement('div');
  row.className = 'team-sessions-row';

  const nameEl = document.createElement('div');
  nameEl.className = 'team-sessions-row-name';
  nameEl.textContent = name;
  row.appendChild(nameEl);

  const metaEl = document.createElement('div');
  metaEl.className = 'team-sessions-meta';
  metaEl.textContent = meta;
  row.appendChild(metaEl);

  if (onClick) {
    row.addEventListener('click', onClick);
  } else {
    row.classList.add('team-sessions-row-disabled');
  }

  return row;
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
  ['second', 1000],
];

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function formatRelative(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return 'unknown';
  const diffMs = timestamp - Date.now();
  const absMs = Math.abs(diffMs);
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (absMs >= ms || unit === 'second') {
      return rtf.format(Math.round(diffMs / ms), unit);
    }
  }
  return rtf.format(0, 'second');
}
