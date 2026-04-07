// @vitest-environment happy-dom
/**
 * Dynamic regression test: sidebar.ts — ghost resize bug
 *
 * Bug: When the user started dragging the sidebar resize handle and
 * released the mouse button OUTSIDE the browser window, the 'mouseup'
 * event never fired on document. This left dragging=true, so the sidebar
 * continued moving whenever the mouse re-entered the window.
 *
 * Fix: The 'mousemove' handler now checks e.buttons. If the mouse button
 * is no longer held (e.buttons === 0), it resets the drag state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../state.js', () => ({
  appState: {
    on: vi.fn(),
    projects: [],
    activeProjectId: null,
    sidebarCollapsed: false,
    sidebarWidth: null,
    preferences: { sidebarViews: { costFooter: false } },
    toggleSidebar: vi.fn(),
    setSidebarWidth: vi.fn(),
  },
}));

vi.mock('./modal.js', () => ({
  showModal: vi.fn(),
  setModalError: vi.fn(),
  closeModal: vi.fn(),
}));

vi.mock('./preferences-modal.js', () => ({
  showPreferencesModal: vi.fn(),
}));

vi.mock('../session-cost.js', () => ({
  onChange: vi.fn(),
  getAggregateCost: vi.fn(() => ({ totalCostUsd: 0 })),
}));

vi.mock('../session-unread.js', () => ({
  hasUnreadInProject: vi.fn(() => false),
  onChange: vi.fn(),
}));

// ── DOM setup ─────────────────────────────────────────────────────────────────

function setupSidebarDOM() {
  document.body.innerHTML = `
    <div id="sidebar" style="width: 200px;"></div>
    <div id="sidebar-resize-handle"></div>
    <div id="sidebar-footer"></div>
    <div id="btn-toggle-sidebar"></div>
    <div id="btn-add-project"></div>
    <div id="btn-preferences"></div>
    <div id="project-list"></div>
  `;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fireMousedown(el: Element, x = 200) {
  el.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true, cancelable: true, clientX: x, buttons: 1,
  }));
}

function fireMousemove(x: number, buttons: number) {
  document.dispatchEvent(new MouseEvent('mousemove', {
    bubbles: true, clientX: x, buttons,
  }));
}

function fireMouseup() {
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('sidebar.ts — ghost resize', () => {
  beforeEach(() => {
    setupSidebarDOM();
    vi.resetModules();
  });

  it('sidebar width updates normally during drag', async () => {
    const { initSidebar } = await import('./sidebar.js');
    const { appState } = await import('../state.js');
    initSidebar();

    const handle = document.getElementById('sidebar-resize-handle')!;
    const sidebar = document.getElementById('sidebar')!;

    fireMousedown(handle, 200);
    fireMousemove(300, 1); // buttons=1: mouse held
    expect(sidebar.style.width).toBe('300px');
  });

  it('ghost resize: mousemove with buttons=0 stops drag', async () => {
    const { initSidebar } = await import('./sidebar.js');
    const { appState } = await import('../state.js');
    initSidebar();

    const handle = document.getElementById('sidebar-resize-handle')!;
    const sidebar = document.getElementById('sidebar')!;

    // Start drag
    fireMousedown(handle, 200);
    fireMousemove(250, 1); // normal drag
    expect(sidebar.style.width).toBe('250px');

    // Simulate: user moved mouse outside window and released (mouseup never fired)
    // Mouse re-enters with buttons=0 (button no longer held)
    fireMousemove(350, 0); // buttons=0: mouse released outside window

    // Sidebar should NOT have moved to 350px — drag was cancelled
    expect(sidebar.style.width).toBe('250px');

    // Further mousemoves should also not move the sidebar
    fireMousemove(400, 0);
    expect(sidebar.style.width).toBe('250px');
  });

  it('ghost resize: drag state is cleaned up (cursor reset, class removed)', async () => {
    const { initSidebar } = await import('./sidebar.js');
    initSidebar();

    const handle = document.getElementById('sidebar-resize-handle')!;

    fireMousedown(handle, 200);
    expect(document.body.classList.contains('sidebar-resizing')).toBe(true);
    expect(document.body.style.cursor).toBe('col-resize');

    // Mouse released outside browser (buttons=0 on next mousemove)
    fireMousemove(300, 0);

    expect(document.body.classList.contains('sidebar-resizing')).toBe(false);
    expect(document.body.style.cursor).toBe('');
    expect(handle.classList.contains('active')).toBe(false);
  });

  it('normal mouseup still works correctly', async () => {
    const { initSidebar } = await import('./sidebar.js');
    initSidebar();

    const handle = document.getElementById('sidebar-resize-handle')!;
    const sidebar = document.getElementById('sidebar')!;

    fireMousedown(handle, 200);
    fireMousemove(280, 1);
    fireMouseup(); // normal mouseup inside window

    // Drag ended — further mousemove should not move sidebar
    fireMousemove(400, 1);
    expect(sidebar.style.width).toBe('280px');
  });
});
