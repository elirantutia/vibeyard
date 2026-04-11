import { appState } from './state.js';
import { getStatus } from './session-activity.js';
import { showConfirmDialog } from './components/confirm-dialog.js';
import { countActiveStatuses, buildWarningBannerDetail } from './components/confirm-helpers.js';

export function initCloseGuard(): void {
  window.vibeyard.app.onConfirmClose(async () => {
    if (!appState.preferences.confirmCloseActive) {
      window.vibeyard.app.closeConfirmed();
      return;
    }

    // Gather active session statuses across all projects
    const allStatuses: string[] = [];
    for (const project of appState.projects) {
      for (const session of project.sessions) {
        allStatuses.push(getStatus(session.id));
      }
    }

    const counts = countActiveStatuses(allStatuses);
    const hasActive = counts.working + counts.waiting + counts.input > 0;

    if (!hasActive) {
      window.vibeyard.app.closeConfirmed();
      return;
    }

    const detail = buildWarningBannerDetail(counts);
    const confirmed = await showConfirmDialog({
      title: 'Close Vibeyard?',
      message: '',
      detail,
      confirmLabel: 'Close Anyway',
      confirmDangerous: true,
    });

    if (confirmed) {
      window.vibeyard.app.closeConfirmed();
    } else {
      window.vibeyard.app.closeCancelled();
    }
  });
}
