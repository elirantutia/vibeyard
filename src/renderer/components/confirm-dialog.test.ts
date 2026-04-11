// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { showConfirmDialog } from './confirm-dialog.js';

describe('showConfirmDialog', () => {
  afterEach(() => {
    document.querySelectorAll('.confirm-overlay').forEach(el => el.remove());
  });

  it('resolves true when confirm button is clicked', async () => {
    const promise = showConfirmDialog({
      title: 'Close?',
      message: 'Are you sure?',
      confirmLabel: 'Close',
    });
    const confirmBtn = document.querySelector('.confirm-overlay .modal-btn.primary') as HTMLElement;
    expect(confirmBtn).not.toBeNull();
    confirmBtn.click();
    expect(await promise).toBe(true);
  });

  it('resolves false when cancel button is clicked', async () => {
    const promise = showConfirmDialog({
      title: 'Close?',
      message: 'Are you sure?',
      confirmLabel: 'Close',
    });
    const cancelBtn = document.querySelector('.confirm-overlay .modal-btn:not(.primary)') as HTMLElement;
    expect(cancelBtn).not.toBeNull();
    cancelBtn.click();
    expect(await promise).toBe(false);
  });

  it('resolves false on Escape key', async () => {
    const promise = showConfirmDialog({
      title: 'Close?',
      message: 'Are you sure?',
      confirmLabel: 'Close',
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await promise).toBe(false);
  });

  it('renders warning banner when detail is provided', async () => {
    const promise = showConfirmDialog({
      title: 'Close Vibeyard?',
      message: '',
      detail: '<div class="confirm-status-line">1 working</div>',
      confirmLabel: 'Close Anyway',
    });
    const banner = document.querySelector('.confirm-warning-banner');
    expect(banner).not.toBeNull();
    expect(banner!.innerHTML).toContain('1 working');
    const cancelBtn = document.querySelector('.confirm-overlay .modal-btn:not(.primary)') as HTMLElement;
    cancelBtn.click();
    await promise;
  });

  it('does not render banner when detail is omitted', async () => {
    const promise = showConfirmDialog({
      title: 'Close session?',
      message: 'Session is working.',
      confirmLabel: 'Close',
    });
    const banner = document.querySelector('.confirm-warning-banner');
    expect(banner).toBeNull();
    const cancelBtn = document.querySelector('.confirm-overlay .modal-btn:not(.primary)') as HTMLElement;
    cancelBtn.click();
    await promise;
  });

  it('removes overlay from DOM after resolution', async () => {
    const promise = showConfirmDialog({
      title: 'Close?',
      message: 'Sure?',
      confirmLabel: 'Close',
    });
    const confirmBtn = document.querySelector('.confirm-overlay .modal-btn.primary') as HTMLElement;
    confirmBtn.click();
    await promise;
    expect(document.querySelector('.confirm-overlay')).toBeNull();
  });
});
