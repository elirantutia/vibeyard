export interface ConfirmDialogOptions {
  title: string;
  message: string;
  detail?: string;
  confirmLabel: string;
}

export function showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal-box';

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = options.title;
    box.appendChild(title);

    const body = document.createElement('div');
    body.className = 'modal-body';

    if (options.detail) {
      const banner = document.createElement('div');
      banner.className = 'confirm-warning-banner';
      banner.innerHTML = options.detail;
      body.appendChild(banner);
    }

    if (options.message) {
      const msg = document.createElement('div');
      msg.className = 'confirm-message';
      msg.innerHTML = options.message;
      body.appendChild(msg);
    }

    box.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'modal-btn';
    cancelBtn.textContent = 'Cancel';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'modal-btn primary';
    confirmBtn.textContent = options.confirmLabel;

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function cleanup(result: boolean): void {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    }

    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') cleanup(false);
    }

    cancelBtn.addEventListener('click', () => cleanup(false));
    confirmBtn.addEventListener('click', () => cleanup(true));
    document.addEventListener('keydown', onKey);

    confirmBtn.focus();
  });
}
