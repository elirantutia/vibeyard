// @vitest-environment happy-dom
/**
 * Dynamic regression test: modal.ts — cleanup ordering bug
 *
 * Bug: cleanup() was called AFTER overlay.classList.remove('hidden'),
 * meaning old confirm/cancel listeners were still attached while the
 * new modal was already visible.
 *
 * Fix: cleanup() now runs before classList.remove('hidden').
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./custom-select.js', () => ({
  createCustomSelect: vi.fn(() => ({
    element: document.createElement('div'),
    destroy: vi.fn(),
  })),
}));

function setupModalDOM() {
  document.body.innerHTML = `
    <div id="modal-overlay" class="hidden">
      <div id="modal-title"></div>
      <div id="modal-body"></div>
      <button id="modal-cancel">Cancel</button>
      <button id="modal-confirm">Confirm</button>
    </div>
  `;
}

describe('modal.ts — cleanup ordering', () => {
  beforeEach(() => {
    setupModalDOM();
    vi.resetModules();
  });

  it('removes old confirm handler before new modal is shown', async () => {
    const { showModal, closeModal } = await import('./modal.js');

    const firstConfirm = vi.fn();
    const secondConfirm = vi.fn();

    // Open first modal
    showModal('First', [], firstConfirm);
    expect(document.getElementById('modal-overlay')!.classList.contains('hidden')).toBe(false);

    // Open second modal immediately (without closing first)
    showModal('Second', [], secondConfirm);

    // Click confirm — should only call secondConfirm, not firstConfirm
    document.getElementById('modal-confirm')!.click();
    await Promise.resolve(); // flush microtasks

    expect(secondConfirm).toHaveBeenCalledOnce();
    expect(firstConfirm).not.toHaveBeenCalled();
  });

  it('old keydown (Enter) handler is removed when new modal opens', async () => {
    const { showModal } = await import('./modal.js');

    const firstConfirm = vi.fn();
    const secondConfirm = vi.fn();

    showModal('First', [], firstConfirm);
    showModal('Second', [], secondConfirm);

    // Simulate Enter key on the overlay
    const overlay = document.getElementById('modal-overlay')!;
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();

    expect(secondConfirm).toHaveBeenCalledOnce();
    expect(firstConfirm).not.toHaveBeenCalled();
  });

  it('closeModal cleans up all handlers', async () => {
    const { showModal, closeModal } = await import('./modal.js');
    const onConfirm = vi.fn();

    showModal('Test', [], onConfirm);
    closeModal();

    // After close, confirm click should not fire callback
    document.getElementById('modal-confirm')!.click();
    await Promise.resolve();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.getElementById('modal-overlay')!.classList.contains('hidden')).toBe(true);
  });
});
