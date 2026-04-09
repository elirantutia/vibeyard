import { appState } from './state.js';
import { onChange as onStatusChange } from './session-activity.js';
import { getTaskBySessionId, moveTask, updateTask, getColumnByBehavior } from './board-state.js';
import type { BoardTask } from '../shared/types.js';

function moveTaskToDone(task: BoardTask): void {
  const doneCol = getColumnByBehavior('terminal');
  if (doneCol && task.columnId !== doneCol.id) {
    moveTask(task.id, doneCol.id, 0);
  }
}

export function initBoardSessionSync(): void {
  onStatusChange((sessionId, status) => {
    if (status !== 'completed') return;
    const task = getTaskBySessionId(sessionId);
    if (task) moveTaskToDone(task);
  });

  appState.on('session-removed', (data) => {
    const { sessionId } = data as { projectId: string; sessionId: string };
    const task = getTaskBySessionId(sessionId);
    if (!task) return;

    moveTaskToDone(task);
    updateTask(task.id, { sessionId: undefined });
  });

  // When CLI session ID is assigned → persist it on the task
  appState.on('session-changed', () => {
    const project = appState.activeProject;
    if (!project?.board) return;

    for (const task of project.board.tasks) {
      if (!task.sessionId) continue;
      const session = project.sessions.find(s => s.id === task.sessionId);
      if (session?.cliSessionId && task.cliSessionId !== session.cliSessionId) {
        updateTask(task.id, { cliSessionId: session.cliSessionId });
      }
    }
  });
}
