import { getStatus, SessionStatus } from './session-activity.js';

// Aggregate the activity of a project's sessions into a single status for the
// sidebar row's status dot. Priority mirrors the urgency order surfaced
// elsewhere: input needed > working > waiting > completed > idle.
const STATUS_PRIORITY: SessionStatus[] = ['input', 'working', 'waiting', 'completed'];

export function getProjectStatus(project: { sessions: { id: string }[] }): SessionStatus {
  if (!project.sessions.length) return 'idle';
  const statuses = new Set(project.sessions.map((s) => getStatus(s.id)));
  for (const status of STATUS_PRIORITY) {
    if (statuses.has(status)) return status;
  }
  return 'idle';
}

// First visible character of a project name, for the active-project avatar.
export function projectInitial(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? '?';
}
