import { appState } from './state.js';
import { refreshGitStatus } from './git-status.js';
import { showModal, closeModal, setModalError } from './components/modal.js';

export function applyWorktreeSelection(projectId: string, path: string | null): void {
  const project = appState.projects.find((p) => p.id === projectId);
  if (!project?.activeSessionId) return;
  const pin = path != null && path !== '';
  appState.setSessionGitWorktree(projectId, project.activeSessionId, path, { userPinned: pin });
  void refreshGitStatus();
}

export function promptCreateWorktree(project: { id: string; path: string }): void {
  showModal(
    'Create New Worktree',
    [
      {
        label: 'Worktree path',
        id: 'wt-path',
        placeholder: 'Folder name (next to repo) or absolute path',
      },
      {
        label: 'New branch (optional)',
        id: 'wt-branch',
        placeholder: 'Leave empty to checkout detached at HEAD',
      },
    ],
    async (values) => {
      const wtPath = values['wt-path']?.trim() ?? '';
      if (!wtPath) {
        setModalError('wt-path', 'Worktree path is required');
        return;
      }
      const branch = values['wt-branch']?.trim();
      if (branch && /\s/.test(branch)) {
        setModalError('wt-branch', 'Branch name cannot contain spaces');
        return;
      }
      try {
        await window.vibeyard.git.createWorktree(project.path, wtPath, branch || undefined);
        closeModal();
        await refreshGitStatus();
      } catch (err) {
        setModalError('wt-path', err instanceof Error ? err.message : 'Failed to create worktree');
      }
    },
  );
}
