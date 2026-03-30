export interface FieldDef {
  label: string;
  id: string;
  type?: 'text' | 'checkbox' | 'select';
  placeholder?: string;
  defaultValue?: string;
  options?: { value: string; label: string; disabled?: boolean }[];
  buttonLabel?: string;
  onButtonClick?: (input: HTMLInputElement) => void;
  onChange?: (checked: boolean) => void;
}

const overlay = document.getElementById('modal-overlay')!;
const titleEl = document.getElementById('modal-title')!;
const bodyEl = document.getElementById('modal-body')!;
const btnCancel = document.getElementById('modal-cancel')!;
const btnConfirm = document.getElementById('modal-confirm')!;

export function setModalError(fieldId: string, message: string): void {
  const existing = bodyEl.querySelector(`#modal-error-${fieldId}`);
  if (existing) existing.remove();

  if (!message) return;

  const input = document.getElementById(`modal-${fieldId}`);
  if (!input) return;

  const errEl = document.createElement('div');
  errEl.id = `modal-error-${fieldId}`;
  errEl.className = 'modal-error';
  errEl.textContent = message;
  input.parentElement!.appendChild(errEl);
}

export function closeModal(): void {
  overlay.classList.add('hidden');
  cleanup();
}

export function showModal(
  title: string,
  fields: FieldDef[],
  onConfirm: (values: Record<string, string>) => void | Promise<void>
): void {
  titleEl.textContent = title;
  bodyEl.innerHTML = '';

  for (const field of fields) {
    const div = document.createElement('div');
    div.className = field.type === 'checkbox' ? 'modal-field modal-field-checkbox' : 'modal-field';

    const label = document.createElement('label');
    label.setAttribute('for', `modal-${field.id}`);
    label.textContent = field.label;

    const input = document.createElement('input');
    input.id = `modal-${field.id}`;

    if (field.type === 'checkbox') {
      input.type = 'checkbox';
      if (field.defaultValue === 'true') input.checked = true;
      if (field.onChange) {
        input.addEventListener('change', () => field.onChange!(input.checked));
      }
      div.appendChild(input);
      div.appendChild(label);
    } else if (field.type === 'select') {
      div.appendChild(label);
      div.appendChild(createCustomSelect(field));
    } else {
      input.type = 'text';
      input.placeholder = field.placeholder ?? '';
      input.value = field.defaultValue ?? '';
      div.appendChild(label);

      if (field.buttonLabel && field.onButtonClick) {
        const row = document.createElement('div');
        row.className = 'modal-field-row';
        row.appendChild(input);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'modal-field-btn';
        btn.textContent = field.buttonLabel;
        btn.addEventListener('click', () => field.onButtonClick!(input));
        row.appendChild(btn);
        div.appendChild(row);
      } else {
        div.appendChild(input);
      }
    }

    bodyEl.appendChild(div);
  }

  overlay.classList.remove('hidden');

  // Focus first text input
  const firstInput = bodyEl.querySelector('input[type="text"]') as HTMLInputElement | null;
  if (firstInput) {
    requestAnimationFrame(() => {
      firstInput.focus();
      firstInput.select();
    });
  }

  // Clean up previous listeners
  cleanup();

  const handleConfirm = async () => {
    const values: Record<string, string> = {};
    for (const field of fields) {
      const el = document.getElementById(`modal-${field.id}`) as HTMLInputElement | HTMLSelectElement;
      if (field.type === 'checkbox') {
        values[field.id] = String((el as HTMLInputElement)?.checked ?? false);
      } else {
        values[field.id] = el?.value ?? '';
      }
    }
    await onConfirm(values);
  };

  const handleCancel = () => {
    closeModal();
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  btnConfirm.addEventListener('click', handleConfirm);
  btnCancel.addEventListener('click', handleCancel);
  overlay.addEventListener('keydown', handleKeydown);

  // Store for cleanup
  (overlay as any)._cleanup = () => {
    btnConfirm.removeEventListener('click', handleConfirm);
    btnCancel.removeEventListener('click', handleCancel);
    overlay.removeEventListener('keydown', handleKeydown);
  };
}

function cleanup(): void {
  if ((overlay as any)._cleanup) {
    (overlay as any)._cleanup();
    (overlay as any)._cleanup = null;
  }
  if ((overlay as any)._selectCleanups) {
    for (const fn of (overlay as any)._selectCleanups) fn();
    (overlay as any)._selectCleanups = null;
  }
}

function createCustomSelect(field: FieldDef): HTMLElement {
  const options = field.options ?? [];
  const defaultOpt = options.find(o => o.value === field.defaultValue) ?? options.find(o => !o.disabled) ?? options[0];

  const wrapper = document.createElement('div');
  wrapper.className = 'custom-select';

  const hidden = document.createElement('input');
  hidden.type = 'hidden';
  hidden.id = `modal-${field.id}`;
  hidden.value = defaultOpt?.value ?? '';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  trigger.textContent = defaultOpt?.label ?? '';

  const dropdown = document.createElement('div');
  dropdown.className = 'custom-select-dropdown';

  let activeIndex = -1;
  const items: HTMLElement[] = [];

  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    const item = document.createElement('div');
    item.className = 'custom-select-item';
    item.textContent = opt.label;
    item.dataset.value = opt.value;
    if (opt.disabled) item.classList.add('disabled');
    if (opt.value === hidden.value) item.classList.add('selected');

    item.addEventListener('mouseenter', () => {
      if (!opt.disabled) {
        activeIndex = i;
        updateActive();
      }
    });

    item.addEventListener('click', () => {
      if (!opt.disabled) selectOption(i);
    });

    items.push(item);
    dropdown.appendChild(item);
  }

  function selectOption(index: number): void {
    const opt = options[index];
    if (!opt || opt.disabled) return;
    hidden.value = opt.value;
    trigger.textContent = opt.label;
    items.forEach(el => el.classList.remove('selected'));
    items[index].classList.add('selected');
    closeDropdown();
  }

  function updateActive(): void {
    items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
    if (activeIndex >= 0) items[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function openDropdown(): void {
    dropdown.classList.add('visible');
    trigger.classList.add('open');
    activeIndex = options.findIndex(o => o.value === hidden.value);
    updateActive();
  }

  function closeDropdown(): void {
    dropdown.classList.remove('visible');
    trigger.classList.remove('open');
    activeIndex = -1;
    items.forEach(el => el.classList.remove('active'));
  }

  function isOpen(): boolean {
    return dropdown.classList.contains('visible');
  }

  trigger.addEventListener('click', () => {
    if (isOpen()) closeDropdown();
    else openDropdown();
  });

  trigger.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (!isOpen()) openDropdown();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      let next = activeIndex;
      for (let attempt = 0; attempt < options.length; attempt++) {
        next = (next + dir + options.length) % options.length;
        if (!options[next].disabled) {
          activeIndex = next;
          break;
        }
      }
      updateActive();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (isOpen() && activeIndex >= 0) selectOption(activeIndex);
      else if (!isOpen()) openDropdown();
    } else if (e.key === 'Escape') {
      if (isOpen()) {
        e.preventDefault();
        e.stopPropagation();
        closeDropdown();
      }
    } else if (e.key === 'Tab') {
      closeDropdown();
    }
  });

  const onOutsideClick = (e: MouseEvent) => {
    if (!isOpen()) return;
    if (!wrapper.contains(e.target as Node)) closeDropdown();
  };
  document.addEventListener('mousedown', onOutsideClick);

  if (!(overlay as any)._selectCleanups) (overlay as any)._selectCleanups = [];
  (overlay as any)._selectCleanups.push(() => document.removeEventListener('mousedown', onOutsideClick));

  wrapper.appendChild(hidden);
  wrapper.appendChild(trigger);
  wrapper.appendChild(dropdown);
  return wrapper;
}
