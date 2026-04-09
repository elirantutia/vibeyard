import type { BoardTask } from '../../../shared/types.js';
import { appState } from '../../state.js';
import { addTask, updateTask, getBoard, addTag, getTagColor } from '../../board-state.js';
import { showModal, closeModal, setModalError, type FieldDef } from '../modal.js';

export function showTaskModal(mode: 'create' | 'edit', task?: BoardTask, defaultColumnId?: string): void {
  const board = getBoard();
  if (!board) return;
  const project = appState.activeProject;
  if (!project) return;

  const columnOptions = [...board.columns]
    .sort((a, b) => a.order - b.order)
    .map(c => ({ value: c.id, label: c.title }));

  const fields: FieldDef[] = [
    {
      label: 'Title',
      id: 'taskTitle',
      placeholder: 'Task title',
      defaultValue: task?.title ?? '',
    },
    {
      label: 'Prompt',
      id: 'prompt',
      type: 'textarea',
      placeholder: 'Instructions for Claude...',
      defaultValue: task?.prompt ?? '',
      rows: 4,
    },
    {
      label: 'Notes',
      id: 'notes',
      type: 'textarea',
      placeholder: 'Context, reasoning, acceptance criteria...',
      defaultValue: task?.notes ?? '',
      rows: 3,
    },
    {
      label: 'Folder',
      id: 'cwd',
      placeholder: project.path,
      defaultValue: task?.cwd ?? project.path,
      buttonLabel: 'Browse',
      onButtonClick: async (input) => {
        const dir = await window.vibeyard.fs.browseDirectory();
        if (dir) input.value = dir;
      },
    },
  ];

  if (mode === 'edit') {
    fields.push({
      label: 'Column',
      id: 'columnId',
      type: 'select',
      options: columnOptions,
      defaultValue: task?.columnId ?? defaultColumnId ?? board.columns[0]?.id,
    });
  }

  const title = mode === 'create' ? 'New Task' : 'Edit Task';

  const confirmLabel = mode === 'create' ? 'Create' : 'Update';

  const currentTags: string[] = [...(task?.tags ?? [])];

  showModal(title, fields, (values) => {
    const prompt = values.prompt?.trim() ?? '';
    const taskTitle = values.taskTitle?.trim() ?? '';

    if (!taskTitle) {
      setModalError('taskTitle', 'Title is required');
      return;
    }

    const notes = values.notes?.trim() ?? '';

    if (mode === 'create') {
      const targetColumnId = defaultColumnId ?? board.columns.find(c => c.behavior === 'inbox')?.id ?? board.columns[0]?.id;
      addTask({
        title: taskTitle,
        prompt,
        notes: notes || undefined,
        cwd: values.cwd?.trim() || project.path,
        columnId: targetColumnId,
        tags: currentTags.length > 0 ? currentTags : undefined,
      });
    } else if (task) {
      updateTask(task.id, {
        title: taskTitle,
        prompt,
        notes: notes || undefined,
        cwd: values.cwd?.trim() || project.path,
        tags: currentTags.length > 0 ? currentTags : undefined,
        ...(values.columnId ? { columnId: values.columnId } : {}),
      });
      // Ensure new tags are in the palette
      for (const t of currentTags) addTag(t);
    }

    closeModal();
  }, { confirmLabel });

  // Inject tags UI into modal (after the Notes field, before Folder)
  const modalBody = document.getElementById('modal-body')!;
  const folderField = modalBody.querySelector('#modal-cwd')?.closest('.modal-field');

  const tagFieldDiv = document.createElement('div');
  tagFieldDiv.className = 'modal-field';

  const tagLabel = document.createElement('label');
  tagLabel.textContent = 'Tags';
  tagFieldDiv.appendChild(tagLabel);

  // Current tags as removable pills
  const tagPillsContainer = document.createElement('div');
  tagPillsContainer.className = 'modal-tag-pills';

  function renderModalTags(): void {
    tagPillsContainer.innerHTML = '';
    for (const tagName of currentTags) {
      const pill = document.createElement('span');
      pill.className = 'tag-pill modal-tag-pill';
      pill.dataset.color = getTagColor(tagName);
      pill.textContent = tagName;

      const removeBtn = document.createElement('span');
      removeBtn.className = 'modal-tag-remove';
      removeBtn.textContent = '\u00d7';
      removeBtn.addEventListener('click', () => {
        const idx = currentTags.indexOf(tagName);
        if (idx >= 0) currentTags.splice(idx, 1);
        renderModalTags();
      });
      pill.appendChild(removeBtn);
      tagPillsContainer.appendChild(pill);
    }
  }
  renderModalTags();
  tagFieldDiv.appendChild(tagPillsContainer);

  // Tag input with autocomplete
  const tagInputWrapper = document.createElement('div');
  tagInputWrapper.className = 'modal-tag-input-wrapper';
  tagInputWrapper.style.position = 'relative';

  const tagInput = document.createElement('input');
  tagInput.className = 'modal-tag-input';
  tagInput.placeholder = 'Add tag...';
  tagInput.style.cssText = 'padding:4px 8px;background:var(--bg-primary);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);font-size:12px;width:100%;box-sizing:border-box;outline:none;';

  const autocompleteList = document.createElement('div');
  autocompleteList.className = 'tag-autocomplete';

  tagInput.addEventListener('input', () => {
    const val = tagInput.value.toLowerCase().trim();
    autocompleteList.innerHTML = '';
    if (!val) { autocompleteList.style.display = 'none'; return; }

    const boardTags = board.tags ?? [];
    const matches = boardTags.filter(t =>
      t.name.includes(val) && !currentTags.includes(t.name)
    );

    if (matches.length === 0) { autocompleteList.style.display = 'none'; return; }

    autocompleteList.style.display = 'block';
    for (const match of matches.slice(0, 5)) {
      const item = document.createElement('div');
      item.className = 'tag-autocomplete-item';
      item.textContent = match.name;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        currentTags.push(match.name);
        tagInput.value = '';
        autocompleteList.style.display = 'none';
        renderModalTags();
      });
      autocompleteList.appendChild(item);
    }
  });

  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const val = tagInput.value.toLowerCase().trim();
      if (val && !currentTags.includes(val)) {
        currentTags.push(val);
        tagInput.value = '';
        autocompleteList.style.display = 'none';
        renderModalTags();
      }
    }
  });

  tagInput.addEventListener('blur', () => {
    setTimeout(() => { autocompleteList.style.display = 'none'; }, 150);
  });

  tagInput.addEventListener('focus', () => tagInput.dispatchEvent(new Event('input')));

  tagInputWrapper.appendChild(tagInput);
  tagInputWrapper.appendChild(autocompleteList);
  tagFieldDiv.appendChild(tagInputWrapper);

  if (folderField) {
    modalBody.insertBefore(tagFieldDiv, folderField);
  } else {
    modalBody.appendChild(tagFieldDiv);
  }
}
