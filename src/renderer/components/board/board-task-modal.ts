import type { BoardTask, ProviderId } from '../../../shared/types.js';
import { addTask, updateTask, getBoard, addTag, getTagColor } from '../../board-state.js';
import { showModal, closeModal, setModalError, registerModalCleanup, type FieldDef } from '../modal.js';
import { createCustomSelect, type CustomSelectInstance } from '../custom-select.js';
import { createPlanModeRow } from '../../dom-utils.js';
import {
  getAvailableProviderMetas,
  getProviderCapabilities,
  loadProviderAvailability,
} from '../../provider-availability.js';
import { appState } from '../../state.js';
import { runTask } from './board-card.js';
import { t } from '../../i18n.js';

export interface TaskModalPrefill {
  title?: string;
  prompt?: string;
  notes?: string;
  tags?: string[];
}

export function showTaskModal(
  mode: 'create' | 'edit',
  task?: BoardTask,
  defaultColumnId?: string,
  prefill?: TaskModalPrefill,
): void {
  const board = getBoard();
  if (!board) return;

  const columnOptions = [...board.columns]
    .sort((a, b) => a.order - b.order)
    .map(c => ({ value: c.id, label: c.title }));

  const fields: FieldDef[] = [
    {
      label: t('board.taskModal.titleLabel'),
      id: 'taskTitle',
      placeholder: t('board.taskModal.titlePlaceholder'),
      defaultValue: task?.title ?? prefill?.title ?? '',
    },
    {
      label: t('board.taskModal.promptLabel'),
      id: 'prompt',
      type: 'textarea',
      placeholder: t('board.taskModal.promptPlaceholder'),
      defaultValue: task?.prompt ?? prefill?.prompt ?? '',
      rows: 4,
      maxLength: 10000,
    },
    {
      label: t('board.taskModal.notesLabel'),
      id: 'notes',
      type: 'textarea',
      placeholder: t('board.taskModal.notesPlaceholder'),
      defaultValue: task?.notes ?? prefill?.notes ?? '',
      rows: 3,
    },
  ];

  if (mode === 'edit') {
    fields.push({
      label: t('board.taskModal.columnLabel'),
      id: 'columnId',
      type: 'select',
      options: columnOptions,
      defaultValue: task?.columnId ?? defaultColumnId ?? board.columns[0]?.id,
    });
  }

  const title = mode === 'create' ? t('board.taskModal.titleCreate') : t('board.taskModal.titleEdit');

  const confirmLabel = mode === 'create' ? t('board.taskModal.confirmCreate') : t('board.taskModal.confirmEdit');

  const currentTags: string[] = [...(task?.tags ?? prefill?.tags ?? [])];

  let currentProviderId: ProviderId =
    task?.providerId
    ?? appState.preferences.defaultProvider
    ?? 'claude';
  // Only the task's own explicit profile pre-selects the dropdown. "Default"
  // (empty) means "follow the project/global default at run time" — we must NOT
  // pre-fill the resolved default id here, or selecting "Default" would never
  // stick (it would reappear as the default profile on reopen).
  let currentProfileId: string = task?.profileId ?? '';
  const initialPlanMode = task?.planMode ?? (mode === 'create');
  const { row: planModeRow, checkbox: planModeCheckbox } =
    createPlanModeRow('Plan mode', initialPlanMode);

  showModal(title, fields, (values) => {
    const prompt = values.prompt?.trim() ?? '';
    const taskTitle = values.taskTitle?.trim() ?? '';

    if (!taskTitle) {
      setModalError('taskTitle', t('board.taskModal.titleRequired'));
      return;
    }

    const notes = values.notes?.trim() ?? '';

    // Ensure all tags are in the palette (assigns colors)
    for (const t of currentTags) addTag(t);

    const planMode = planModeCheckbox.checked;

    if (mode === 'create') {
      const targetColumnId = defaultColumnId ?? board.columns.find(c => c.behavior === 'inbox')?.id ?? board.columns[0]?.id;
      addTask({
        title: taskTitle,
        prompt,
        notes: notes || undefined,
        columnId: targetColumnId,
        tags: currentTags.length > 0 ? currentTags : undefined,
        providerId: currentProviderId,
        profileId: currentProfileId || undefined,
        planMode,
      });
    } else if (task) {
      updateTask(task.id, {
        title: taskTitle,
        prompt,
        notes: notes || undefined,
        tags: currentTags.length > 0 ? currentTags : undefined,
        providerId: currentProviderId,
        profileId: currentProfileId || undefined,
        planMode,
        ...(values.columnId ? { columnId: values.columnId } : {}),
      });
    }

    closeModal();
  }, { confirmLabel });

  // Inject tags UI into modal (after Notes; before Column field in edit mode)
  const modalBody = document.getElementById('modal-body')!;
  const columnField = modalBody.querySelector('#modal-columnId')?.closest('.modal-field');

  const tagFieldDiv = document.createElement('div');
  tagFieldDiv.className = 'modal-field';

  const tagLabel = document.createElement('label');
  tagLabel.textContent = t('board.taskModal.tagsLabel');
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
  tagInput.className = 'board-modal-tag-input';
  tagInput.placeholder = t('board.taskModal.tagInputPlaceholder');

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
        addTag(val); // Register in palette immediately so it gets a color
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

  if (columnField) {
    modalBody.insertBefore(tagFieldDiv, columnField);
  } else {
    modalBody.appendChild(tagFieldDiv);
  }

  // Provider dropdown
  const providerFieldDiv = document.createElement('div');
  providerFieldDiv.className = 'modal-field';
  const providerLabel = document.createElement('label');
  providerLabel.textContent = t('board.taskModal.providerLabel');
  providerFieldDiv.appendChild(providerLabel);

  const buildProviderOptions = () =>
    getAvailableProviderMetas().map(p => ({ value: p.id, label: p.displayName }));

  function refreshPlanModeAvailability(): void {
    const caps = getProviderCapabilities(currentProviderId);
    const supported = !!caps?.planModeArg;
    planModeCheckbox.disabled = !supported;
    if (!supported) planModeCheckbox.checked = false;
    planModeRow.title = supported ? '' : t('board.taskModal.planModeUnsupportedTooltip');
  }

  const onProviderChange = (value: string) => {
    currentProviderId = value as ProviderId;
    refreshPlanModeAvailability();
    renderProfileField();
  };

  const initialProviderOptions = buildProviderOptions();
  let providerSelect: CustomSelectInstance = createCustomSelect(
    'taskProvider',
    initialProviderOptions.length > 0
      ? initialProviderOptions
      : [{ value: currentProviderId, label: t('board.taskModal.providerLoading') }],
    currentProviderId,
    onProviderChange,
  );
  providerFieldDiv.appendChild(providerSelect.element);
  registerModalCleanup(() => providerSelect.destroy());

  // Profile dropdown (provider-scoped; today only Claude has profiles).
  // Hidden entirely when the selected provider has no profiles.
  const profileFieldDiv = document.createElement('div');
  profileFieldDiv.className = 'modal-field';
  const profileLabel = document.createElement('label');
  profileLabel.textContent = 'Profile';
  profileFieldDiv.appendChild(profileLabel);

  let profileSelect: CustomSelectInstance | null = null;
  registerModalCleanup(() => profileSelect?.destroy());

  function renderProfileField(): void {
    const profiles = appState.profiles.filter(p => p.providerId === currentProviderId);
    if (profileSelect) {
      profileSelect.destroy();
      profileSelect.element.remove();
      profileSelect = null;
    }
    if (profiles.length === 0) {
      profileFieldDiv.style.display = 'none';
      currentProfileId = '';
      return;
    }
    profileFieldDiv.style.display = '';
    // Reset selection if the pinned profile doesn't belong to this provider.
    if (currentProfileId && !profiles.some(p => p.id === currentProfileId)) {
      currentProfileId = '';
    }
    // Label the "Default" option with the project/global default profile it
    // resolves to, so a task with no explicit profile visibly shows which
    // profile it will run under — while still saving as "follow the default"
    // (empty) rather than pinning a copy of that id onto the task.
    const defaultId =
      appState.activeProject?.defaultProfileId
      ?? appState.preferences.defaultProfileId
      ?? '';
    const defaultProfile = profiles.find(p => p.id === defaultId);
    // Fold an explicit pin of the default profile into "follow default" so the
    // default profile is never listed twice (once as "Default (X)", once as "X").
    if (defaultProfile && currentProfileId === defaultProfile.id) currentProfileId = '';
    const options = [
      { value: '', label: defaultProfile ? `Default (${defaultProfile.name})` : 'Default' },
      ...profiles
        .filter(p => p.id !== defaultProfile?.id)
        .map(p => ({ value: p.id, label: p.name })),
    ];
    profileSelect = createCustomSelect('taskProfile', options, currentProfileId, v => {
      currentProfileId = v;
    });
    profileFieldDiv.appendChild(profileSelect.element);
  }

  const planModeFieldDiv = document.createElement('div');
  planModeFieldDiv.className = 'modal-field modal-field-checkbox';
  planModeFieldDiv.appendChild(planModeRow);

  refreshPlanModeAvailability();
  renderProfileField();

  if (columnField) {
    modalBody.insertBefore(providerFieldDiv, columnField);
    modalBody.insertBefore(profileFieldDiv, columnField);
    modalBody.insertBefore(planModeFieldDiv, columnField);
  } else {
    modalBody.appendChild(providerFieldDiv);
    modalBody.appendChild(profileFieldDiv);
    modalBody.appendChild(planModeFieldDiv);
  }

  if (initialProviderOptions.length === 0) {
    loadProviderAvailability().then(() => {
      if (!providerFieldDiv.isConnected) return;
      const opts = buildProviderOptions();
      if (opts.length === 0) return;
      providerSelect.destroy();
      providerSelect = createCustomSelect('taskProvider', opts, currentProviderId, onProviderChange);
      providerFieldDiv.querySelector('.custom-select')?.remove();
      providerFieldDiv.appendChild(providerSelect.element);
    });
  }

  // Add Run/Resume button in edit mode
  const footer = document.getElementById('modal-actions') as HTMLElement;
  if (footer) {
    footer.querySelectorAll('.board-modal-run-btn').forEach(el => el.remove());

    if (mode === 'edit' && task) {
      const runBtn = document.createElement('button');
      runBtn.className = 'board-modal-run-btn';
      const hasActiveSession = !!task.sessionId;
      const canResume = !hasActiveSession && !!task.cliSessionId;
      runBtn.textContent = hasActiveSession ? t('board.taskModal.focusSessionButton') : canResume ? t('board.taskModal.resumeButton') : t('board.taskModal.runButton');
      runBtn.addEventListener('click', () => {
        // Save current edits before running
        const prompt = (document.getElementById('modal-prompt') as HTMLTextAreaElement)?.value?.trim() ?? '';
        const taskTitle = (document.getElementById('modal-taskTitle') as HTMLInputElement)?.value?.trim() ?? '';
        const notes = (document.getElementById('modal-notes') as HTMLTextAreaElement)?.value?.trim() ?? '';
        const columnId = (document.getElementById('modal-columnId') as HTMLInputElement)?.value;

        for (const t of currentTags) addTag(t);
        const planMode = planModeCheckbox.checked;
        updateTask(task.id, {
          title: taskTitle || task.title,
          prompt: prompt || task.prompt,
          notes: notes || undefined,
          tags: currentTags.length > 0 ? currentTags : undefined,
          providerId: currentProviderId,
          profileId: currentProfileId || undefined,
          planMode,
          ...(columnId ? { columnId } : {}),
        });

        closeModal();
        runTask(task);
      });
      footer.insertBefore(runBtn, footer.firstChild);
      registerModalCleanup(() => runBtn.remove());
    }
  }
}
