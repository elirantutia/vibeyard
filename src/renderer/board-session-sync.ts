import { appState } from './state.js';
import { onChange as onStatusChange } from './session-activity.js';
import { getTaskBySessionId, moveTask, updateTask, getColumnByBehavior } from './board-state.js';
import type { BoardTask } from '../shared/types.js';

function moveTaskToDone(task: BoardTask, projectId: string): void {
  const doneCol = getColumnByBehavior('terminal', projectId);
  if (doneCol && task.columnId !== doneCol.id) {
    moveTask(task.id, doneCol.id, 0, projectId);
  }
}

export function initBoardSessionSync(): void {
  onStatusChange((sessionId, status) => {
    if (status !== 'completed') return;
    for (const project of appState.projects) {
      const task = getTaskBySessionId(sessionId, project.id);
      if (task) moveTaskToDone(task, project.id);
    }
  });

  appState.on('session-removed', (data) => {
    const { projectId, sessionId } = data as { projectId: string; sessionId: string };
    const task = getTaskBySessionId(sessionId, projectId);
    if (!task) return;

    updateTask(task.id, { sessionId: undefined }, projectId);
  });

  // When CLI session ID is assigned → persist it on the task
  appState.on('session-changed', () => {
    for (const project of appState.projects) {
      if (!project.board) continue;
      for (const task of project.board.tasks) {
        if (!task.sessionId) continue;
        const session = project.sessions.find(s => s.id === task.sessionId);
        if (session?.cliSessionId && task.cliSessionId !== session.cliSessionId) {
          updateTask(task.id, { cliSessionId: session.cliSessionId }, project.id);
        }
      }
    }
  });
}
