export interface ModalShell {
  overlay: HTMLElement;
  titleEl: HTMLElement;
  body: HTMLElement;
  actions: HTMLElement;
}

export interface ModalShellOptions {
  id: string;
  title: string;
  wide?: boolean;
}

export function createModalShell({ id, title, wide }: ModalShellOptions): ModalShell {
  const existing = document.getElementById(id);
  if (existing) {
    return {
      overlay: existing,
      titleEl: existing.querySelector('.modal-title') as HTMLElement,
      body: existing.querySelector('.modal-body') as HTMLElement,
      actions: existing.querySelector('.modal-actions') as HTMLElement,
    };
  }

  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.className = 'modal-overlay';
  overlay.style.display = 'none';

  const box = document.createElement('div');
  box.className = wide ? 'modal-box modal-wide' : 'modal-box';

  const titleEl = document.createElement('div');
  titleEl.className = 'modal-title';
  titleEl.textContent = title;
  box.appendChild(titleEl);

  const body = document.createElement('div');
  body.className = 'modal-body';
  box.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  box.appendChild(actions);

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  return { overlay, titleEl, body, actions };
}

export function createModalButton(label: string, primary: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = primary ? 'btn-primary' : 'btn-secondary';
  btn.textContent = label;
  return btn;
}
