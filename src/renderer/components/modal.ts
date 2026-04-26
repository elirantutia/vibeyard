import { createCustomSelect } from './custom-select.js';

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

const DEFAULT_CONFIRM_LABEL = 'Create';

export interface ModalOptions {
  confirmLabel?: string;
}

export function showModal(
  title: string,
  fields: FieldDef[],
  onConfirm: (values: Record<string, string>) => void | Promise<void>,
  options?: ModalOptions,
): void {
  titleEl.textContent = title;
  btnConfirm.textContent = options?.confirmLabel ?? DEFAULT_CONFIRM_LABEL;
  bodyEl.innerHTML = '';
  btnConfirm.textContent = 'Create';
  btnCancel.textContent = 'Cancel';

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
      const sel = createCustomSelect(`modal-${field.id}`, field.options ?? [], field.defaultValue);
      div.appendChild(sel.element);
      if (!(overlay as any)._selectCleanups) (overlay as any)._selectCleanups = [];
      (overlay as any)._selectCleanups.push(() => sel.destroy());
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

export function showConfirmDialog(
  title: string,
  message: string,
  options: {
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
  }
): void {
  titleEl.textContent = title;
  bodyEl.innerHTML = '';
  btnConfirm.textContent = options.confirmLabel ?? 'Confirm';
  btnCancel.textContent = options.cancelLabel ?? 'Cancel';

  const messageEl = document.createElement('div');
  messageEl.className = 'modal-message';
  messageEl.textContent = message;
  bodyEl.appendChild(messageEl);

  overlay.classList.remove('hidden');

  requestAnimationFrame(() => {
    btnCancel.focus();
  });

  cleanup();

  const handleConfirm = () => {
    options.onConfirm();
    closeModal();
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

