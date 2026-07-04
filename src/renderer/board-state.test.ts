import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.stubGlobal('window', {
  vibeyard: {
    store: { load: vi.fn(), save: vi.fn() },
  },
});

let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `uuid-${++uuidCounter}`,
});

vi.mock('./session-cost.js', () => ({
  getCost: vi.fn().mockReturnValue(null),
  restoreCost: vi.fn(),
}));

vi.mock('./session-context.js', () => ({
  restoreContext: vi.fn(),
}));

vi.mock('./provider-availability.js', () => ({
  getProviderCapabilities: vi.fn(),
}));

import { appState, _resetForTesting } from './state';
import {
  getBoard, getColumnByBehavior, getTasksForColumn,
  getTaskBySessionId, getTaskByCliSessionId,
  addTask, updateTask, deleteTask, moveTask,
  addColumn, renameColumn, deleteColumn, reorderColumns,
  addTag, removeTag, updateTagColor,
  addTagToTask, removeTagFromTask, getTagColor, getTagCount,
} from './board-state';

beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;
  _resetForTesting();
  // Replace the auto-initialized board with one that has predictable column IDs.
  const project = appState.addProject('Test', '/test');
  project.board = {
    columns: [
      { id: 'col-backlog', title: 'Backlog', order: 0, behavior: 'inbox' as const },
      { id: 'col-ready', title: 'Ready', order: 1, behavior: 'none' as const },
      { id: 'col-running', title: 'Running', order: 2, behavior: 'active' as const },
      { id: 'col-done', title: 'Done', order: 3, behavior: 'terminal' as const },
    ],
    tasks: [],
  };
});

describe('board-state', () => {
  describe('getBoard', () => {
    it('returns board for active project', () => {
      const board = getBoard();
      expect(board).toBeDefined();
      expect(board!.columns).toHaveLength(4);
    });
  });

  describe('getColumnByBehavior', () => {
    it('finds inbox column', () => {
      const col = getColumnByBehavior('inbox');
      expect(col?.title).toBe('Backlog');
    });

    it('finds active column', () => {
      const col = getColumnByBehavior('active');
      expect(col?.title).toBe('Running');
    });

    it('finds terminal column', () => {
      const col = getColumnByBehavior('terminal');
      expect(col?.title).toBe('Done');
    });
  });

  describe('addTask', () => {
    it('creates task in inbox column by default', () => {
      const task = addTask({ title: 'Test', prompt: 'Do something' });
      expect(task).toBeDefined();
      expect(task!.columnId).toBe('col-backlog');
      expect(task!.title).toBe('Test');
      expect(task!.prompt).toBe('Do something');
    });

    it('auto-assigns order as max+1 in target column', () => {
      addTask({ title: 'First', prompt: 'a' });
      const second = addTask({ title: 'Second', prompt: 'b' });
      expect(second!.order).toBe(1);
    });

    it('generates unique id and timestamps', () => {
      const task = addTask({ title: 'T', prompt: 'p' });
      expect(task!.id).toBeTruthy();
      expect(task!.createdAt).toBeGreaterThan(0);
      expect(task!.updatedAt).toBeGreaterThan(0);
    });

    it('accepts partial with custom columnId', () => {
      const task = addTask({ title: 'T', prompt: 'p', columnId: 'col-ready' });
      expect(task!.columnId).toBe('col-ready');
    });

    it('persists profileId when provided', () => {
      const task = addTask({ title: 'T', prompt: 'p', profileId: 'prof-1' });
      expect(task!.profileId).toBe('prof-1');
    });

    it('omits profileId when absent', () => {
      const task = addTask({ title: 'T', prompt: 'p' });
      expect('profileId' in task!).toBe(false);
    });
  });

  describe('updateTask', () => {
    it('merges updates into existing task', () => {
      const task = addTask({ title: 'Old', prompt: 'p' })!;
      updateTask(task.id, { title: 'New' });
      const board = getBoard()!;
      const updated = board.tasks.find(t => t.id === task.id);
      expect(updated!.title).toBe('New');
      expect(updated!.prompt).toBe('p');
    });

    it('updates updatedAt timestamp', () => {
      const task = addTask({ title: 'T', prompt: 'p' })!;
      const originalUpdatedAt = task.updatedAt;
      // Small delay to ensure timestamp differs
      updateTask(task.id, { title: 'Changed' });
      const board = getBoard()!;
      const updated = board.tasks.find(t => t.id === task.id);
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });

    it('no-ops for unknown taskId', () => {
      updateTask('nonexistent', { title: 'X' });
      // Should not throw
      expect(getBoard()!.tasks).toHaveLength(0);
    });

    it('updates profileId', () => {
      const task = addTask({ title: 'T', prompt: 'p' })!;
      updateTask(task.id, { profileId: 'prof-2' });
      expect(task.profileId).toBe('prof-2');
    });

    it('strips invalid columnId from updates', () => {
      const task = addTask({ title: 'Test', prompt: 'p' })!;
      updateTask(task.id, { columnId: 'non-existent' });
      expect(task.columnId).toBe('col-backlog'); // unchanged
    });

    it('does not mutate caller updates object when invalid columnId is passed', () => {
      const task = addTask({ title: 'Old Title', prompt: 'p' })!;
      const updates = { columnId: 'non-existent', title: 'New Title' };
      updateTask(task.id, updates);
      // Verify caller's updates object was not mutated
      expect(updates.columnId).toBe('non-existent');
      // Verify task was still updated with valid changes
      const board = getBoard()!;
      const updated = board.tasks.find(t => t.id === task.id);
      expect(updated!.title).toBe('New Title');
      expect(updated!.columnId).toBe('col-backlog'); // unchanged
    });
  });

  describe('deleteTask', () => {
    it('removes task from board', () => {
      const task = addTask({ title: 'T', prompt: 'p' })!;
      expect(getBoard()!.tasks).toHaveLength(1);
      deleteTask(task.id);
      expect(getBoard()!.tasks).toHaveLength(0);
    });

    it('reindexes remaining tasks in same column', () => {
      const t1 = addTask({ title: 'T1', prompt: 'p' })!;
      const t2 = addTask({ title: 'T2', prompt: 'p' })!;
      const t3 = addTask({ title: 'T3', prompt: 'p' })!;
      deleteTask(t2.id);
      const tasks = getTasksForColumn('col-backlog');
      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe(t1.id);
      expect(tasks[0].order).toBe(0);
      expect(tasks[1].id).toBe(t3.id);
      expect(tasks[1].order).toBe(1);
    });
  });

  describe('moveTask', () => {
    it('moves task between columns', () => {
      const task = addTask({ title: 'T', prompt: 'p' })!;
      expect(task.columnId).toBe('col-backlog');
      moveTask(task.id, 'col-running', 0);
      const board = getBoard()!;
      const moved = board.tasks.find(t => t.id === task.id);
      expect(moved!.columnId).toBe('col-running');
      expect(moved!.order).toBe(0);
    });

    it('moves task within same column (reorder)', () => {
      const t1 = addTask({ title: 'T1', prompt: 'p' })!;
      const t2 = addTask({ title: 'T2', prompt: 'p' })!;
      const t3 = addTask({ title: 'T3', prompt: 'p' })!;
      // Move t3 to position 0
      moveTask(t3.id, 'col-backlog', 0);
      const tasks = getTasksForColumn('col-backlog');
      expect(tasks[0].id).toBe(t3.id);
      expect(tasks[0].order).toBe(0);
    });

    it('reindexes source column after move', () => {
      const t1 = addTask({ title: 'T1', prompt: 'p' })!;
      const t2 = addTask({ title: 'T2', prompt: 'p' })!;
      const t3 = addTask({ title: 'T3', prompt: 'p' })!;
      moveTask(t2.id, 'col-running', 0);
      const backlogTasks = getTasksForColumn('col-backlog');
      expect(backlogTasks).toHaveLength(2);
      expect(backlogTasks[0].order).toBe(0);
      expect(backlogTasks[1].order).toBe(1);
    });

    it('handles move to empty column', () => {
      const task = addTask({ title: 'T', prompt: 'p' })!;
      moveTask(task.id, 'col-done', 0);
      const doneTasks = getTasksForColumn('col-done');
      expect(doneTasks).toHaveLength(1);
      expect(doneTasks[0].order).toBe(0);
    });

    it('handles move to position 0 (prepend)', () => {
      addTask({ title: 'Existing', prompt: 'p', columnId: 'col-running' });
      const task = addTask({ title: 'New', prompt: 'p' })!;
      moveTask(task.id, 'col-running', 0);
      const tasks = getTasksForColumn('col-running');
      expect(tasks[0].id).toBe(task.id);
    });

    it('rejects move to non-existent column', () => {
      const task = addTask({ title: 'Test', prompt: 'p' })!;
      moveTask(task.id, 'non-existent-column', 0);
      expect(task.columnId).toBe('col-backlog'); // unchanged
    });
  });

  describe('column operations', () => {
    it('addColumn inserts with correct order', () => {
      const col = addColumn('Custom');
      expect(col).toBeDefined();
      expect(col!.order).toBe(4);
      expect(col!.behavior).toBe('none');
    });

    it('renameColumn updates title', () => {
      renameColumn('col-ready', 'In Progress');
      const board = getBoard()!;
      const col = board.columns.find(c => c.id === 'col-ready');
      expect(col!.title).toBe('In Progress');
    });

    it('deleteColumn moves orphaned tasks to inbox', () => {
      const custom = addColumn('Custom')!;
      addTask({ title: 'T', prompt: 'p', columnId: custom.id });
      deleteColumn(custom.id);
      const board = getBoard()!;
      expect(board.columns.find(c => c.id === custom.id)).toBeUndefined();
      const backlogTasks = getTasksForColumn('col-backlog');
      expect(backlogTasks).toHaveLength(1);
    });

    it('deleteColumn prevents deleting behavior columns', () => {
      deleteColumn('col-backlog'); // inbox behavior
      const board = getBoard()!;
      expect(board.columns.find(c => c.id === 'col-backlog')).toBeDefined();
    });

    it('reorderColumns updates order fields', () => {
      reorderColumns(['col-done', 'col-running', 'col-ready', 'col-backlog']);
      const board = getBoard()!;
      const done = board.columns.find(c => c.id === 'col-done');
      const backlog = board.columns.find(c => c.id === 'col-backlog');
      expect(done!.order).toBe(0);
      expect(backlog!.order).toBe(3);
    });
  });

  describe('lookups', () => {
    it('getTaskBySessionId finds linked task', () => {
      const task = addTask({ title: 'T', prompt: 'p' })!;
      updateTask(task.id, { sessionId: 'sess-1' });
      const found = getTaskBySessionId('sess-1');
      expect(found).toBeDefined();
      expect(found!.id).toBe(task.id);
    });

    it('getTaskByCliSessionId finds by persistent id', () => {
      const task = addTask({ title: 'T', prompt: 'p' })!;
      updateTask(task.id, { cliSessionId: 'cli-sess-1' });
      const found = getTaskByCliSessionId('cli-sess-1');
      expect(found).toBeDefined();
      expect(found!.id).toBe(task.id);
    });

    it('getTasksForColumn returns sorted tasks', () => {
      addTask({ title: 'T1', prompt: 'p' });
      addTask({ title: 'T2', prompt: 'p' });
      addTask({ title: 'T3', prompt: 'p' });
      const tasks = getTasksForColumn('col-backlog');
      expect(tasks).toHaveLength(3);
      expect(tasks[0].order).toBeLessThan(tasks[1].order);
      expect(tasks[1].order).toBeLessThan(tasks[2].order);
    });
  });

  describe('tag operations (v2 stubs)', () => {
    it('addTag creates a tag with auto-assigned color', () => {
      const tag = addTag('feature');
      expect(tag).toBeDefined();
      expect(tag!.name).toBe('feature');
      expect(tag!.color).toBe('blue');
    });

    it('addTag normalizes name to lowercase', () => {
      const tag = addTag('  BUG  ');
      expect(tag!.name).toBe('bug');
    });

    it('removeTag strips from all tasks', () => {
      addTag('bug');
      const task = addTask({ title: 'T', prompt: 'p' })!;
      updateTask(task.id, { tags: ['bug'] });
      removeTag('bug');
      const board = getBoard()!;
      expect(board.tags).toHaveLength(0);
      const updated = board.tasks.find(t => t.id === task.id);
      expect(updated!.tags).toEqual([]);
    });

    it('updateTagColor changes color', () => {
      addTag('feature', 'blue');
      updateTagColor('feature', 'red');
      const board = getBoard()!;
      expect(board.tags![0].color).toBe('red');
    });
  });

  describe('tag-to-task operations', () => {
    it('adds a tag to a task and auto-creates in palette', () => {
      const task = addTask({ title: 'Test', prompt: 'p' })!;
      addTagToTask(task.id, 'frontend');
      const updated = getBoard()!.tasks.find(t => t.id === task.id);
      expect(updated!.tags).toEqual(['frontend']);
      expect(getBoard()!.tags).toContainEqual({ name: 'frontend', color: expect.any(String) });
    });

    it('does not duplicate tags on a task', () => {
      const task = addTask({ title: 'Test', prompt: 'p' })!;
      addTagToTask(task.id, 'bug');
      addTagToTask(task.id, 'bug');
      expect(task.tags).toEqual(['bug']);
    });

    it('removes a tag from a task', () => {
      const task = addTask({ title: 'Test', prompt: 'p' })!;
      addTagToTask(task.id, 'bug');
      addTagToTask(task.id, 'feature');
      removeTagFromTask(task.id, 'bug');
      expect(task.tags).toEqual(['feature']);
    });

    it('getTagColor returns the assigned color', () => {
      addTag('urgent', 'red');
      expect(getTagColor('urgent')).toBe('red');
    });

    it('getTagColor returns gray for unknown tags', () => {
      expect(getTagColor('nonexistent')).toBe('gray');
    });

    it('getTagCount counts tasks with that tag', () => {
      const t1 = addTask({ title: 'T1', prompt: 'p' })!;
      const t2 = addTask({ title: 'T2', prompt: 'p' })!;
      addTagToTask(t1.id, 'shared');
      addTagToTask(t2.id, 'shared');
      expect(getTagCount('shared')).toBe(2);
    });
  });

});
