import { appState } from '../state.js';
import { createPlanModeRow } from '../dom-utils.js';
import { setPendingPrompt } from './terminal-pane.js';
import { getFileViewerInstance } from './file-viewer.js';
import { getFileReaderInstance } from './file-reader.js';
import { promptNewSession } from './tab-bar.js';
import { wireSubmitDisabled } from './submit-disabled.js';

type PaneKind = 'file-viewer' | 'file-reader';

export interface PaneContext {
  sessionId: string;
  kind: PaneKind;
  paneEl: HTMLElement;
  bodyEl: HTMLElement;
  filePath: string;
  viewMode?: 'raw' | 'rendered';
  lineStart?: number;
  lineEnd?: number;
  selectedText: string;
}

let askBubble: HTMLButtonElement | null = null;
let popover: HTMLDivElement | null = null;
let popoverInfo: HTMLDivElement | null = null;
let popoverTextarea: HTMLTextAreaElement | null = null;
let popoverPlanModeCheckbox: HTMLInputElement | null = null;
let currentCtx: PaneContext | null = null;

function findFilePane(node: Node | null): { el: HTMLElement; kind: PaneKind; bodyEl: HTMLElement } | null {
  let el: Element | null = node instanceof Element ? node : node?.parentElement ?? null;
  while (el && !(el instanceof HTMLElement && el.dataset.paneKind)) {
    el = el.parentElement;
  }
  if (!(el instanceof HTMLElement)) return null;
  const kind = el.dataset.paneKind;
  if (kind !== 'file-viewer' && kind !== 'file-reader') return null;
  const bodySelector = kind === 'file-viewer' ? '.file-viewer-body' : '.file-reader-body';
  const bodyEl = el.querySelector(bodySelector) as HTMLElement | null;
  if (!bodyEl) return null;
  return { el, kind, bodyEl };
}

function findLineNumber(node: Node | null): number | undefined {
  let el: Element | null = node instanceof Element ? node : node?.parentElement ?? null;
  while (el && !el.classList?.contains('file-reader-line')) el = el.parentElement;
  if (!el) return undefined;
  const numEl = el.querySelector('.file-reader-line-num');
  const n = numEl ? parseInt(numEl.textContent ?? '', 10) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function getPaneContext(): PaneContext | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString();
  if (!text.trim()) return null;
  const pane = findFilePane(sel.anchorNode);
  if (!pane) return null;
  if (!pane.bodyEl.contains(sel.anchorNode) || !pane.bodyEl.contains(sel.focusNode)) return null;

  const sessionId = pane.el.dataset.sessionId;
  if (!sessionId) return null;

  if (pane.kind === 'file-viewer') {
    const inst = getFileViewerInstance(sessionId);
    if (!inst) return null;
    return {
      sessionId,
      kind: 'file-viewer',
      paneEl: pane.el,
      bodyEl: pane.bodyEl,
      filePath: inst.filePath,
      selectedText: text,
    };
  }

  const inst = getFileReaderInstance(sessionId);
  if (!inst || inst.kind === 'image' || inst.unsupported) return null;

  let lineStart: number | undefined;
  let lineEnd: number | undefined;
  if (inst.viewMode === 'raw') {
    const range = sel.getRangeAt(0);
    const a = findLineNumber(range.startContainer);
    const b = findLineNumber(range.endContainer);
    if (a && b) {
      lineStart = Math.min(a, b);
      lineEnd = Math.max(a, b);
    } else {
      lineStart = a ?? b;
      lineEnd = lineStart;
    }
  }

  return {
    sessionId,
    kind: 'file-reader',
    paneEl: pane.el,
    bodyEl: pane.bodyEl,
    filePath: inst.filePath,
    viewMode: inst.viewMode,
    lineStart,
    lineEnd,
    selectedText: text,
  };
}

function clampToPane(el: HTMLElement, paneRect: DOMRect, left: number, top: number): void {
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  const r = el.getBoundingClientRect();
  if (left + r.width > paneRect.width) left = paneRect.width - r.width - 8;
  if (top + r.height > paneRect.height) top = paneRect.height - r.height - 8;
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function getSelectionRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const rects = sel.getRangeAt(0).getClientRects();
  if (rects.length === 0) return sel.getRangeAt(0).getBoundingClientRect();
  return rects[rects.length - 1];
}

function ensureBubble(): HTMLButtonElement {
  if (askBubble) return askBubble;
  const b = document.createElement('button');
  b.className = 'file-prompt-bubble';
  b.type = 'button';
  b.textContent = 'Ask AI';
  b.style.display = 'none';
  b.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (currentCtx) openComposer(currentCtx);
  });
  askBubble = b;
  return b;
}

function ensureComposer(): HTMLDivElement {
  if (popover) return popover;
  const p = document.createElement('div');
  p.className = 'browser-inspect-panel';
  p.style.display = 'none';

  const info = document.createElement('div');
  info.className = 'inspect-element-info';
  p.appendChild(info);

  const inputRow = document.createElement('div');
  inputRow.className = 'inspect-input-row';
  const textarea = document.createElement('textarea');
  textarea.className = 'inspect-instruction-input';
  textarea.rows = 3;
  textarea.placeholder = 'Describe what you want to do…';
  inputRow.appendChild(textarea);
  p.appendChild(inputRow);

  const { row: planModeRow, checkbox: planModeCheckbox } = createPlanModeRow();
  p.appendChild(planModeRow);

  const submitGroup = document.createElement('div');
  submitGroup.className = 'inspect-submit-group';
  const submitBtn = document.createElement('button');
  submitBtn.className = 'inspect-submit-btn';
  submitBtn.type = 'button';
  submitBtn.textContent = 'Send to AI';
  const customBtn = document.createElement('button');
  customBtn.className = 'inspect-dropdown-btn';
  customBtn.type = 'button';
  customBtn.textContent = '▼';
  customBtn.title = 'Send to custom session';
  submitGroup.appendChild(submitBtn);
  submitGroup.appendChild(customBtn);
  p.appendChild(submitGroup);

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
    }
  });
  submitBtn.addEventListener('click', (e) => {
    e.preventDefault();
    submit();
  });
  customBtn.addEventListener('click', (e) => {
    e.preventDefault();
    submitToCustomSession();
  });
  wireSubmitDisabled(textarea, submitBtn, customBtn);

  popover = p;
  popoverInfo = info;
  popoverTextarea = textarea;
  popoverPlanModeCheckbox = planModeCheckbox;
  return p;
}

export function buildPrompt(ctx: PaneContext, instruction: string): string {
  const text = ctx.selectedText;
  if (ctx.kind === 'file-viewer') {
    return `Regarding the following diff snippet from \`${ctx.filePath}\`:\n\n\`\`\`diff\n${text}\n\`\`\`\n\n${instruction}`;
  }
  const rangeLabel =
    ctx.lineStart && ctx.lineEnd && ctx.lineStart !== ctx.lineEnd
      ? `lines ${ctx.lineStart}-${ctx.lineEnd}`
      : ctx.lineStart
        ? `line ${ctx.lineStart}`
        : 'the following text';
  if (ctx.viewMode === 'rendered') {
    const quoted = text.replace(/\n/g, '\n> ');
    return `Regarding ${rangeLabel} in \`${ctx.filePath}\`:\n\n> ${quoted}\n\n${instruction}`;
  }
  return `Regarding ${rangeLabel} in \`${ctx.filePath}\`:\n\n\`\`\`\n${text}\n\`\`\`\n\n${instruction}`;
}

function openComposer(ctx: PaneContext): void {
  hideBubble();
  const p = ensureComposer();
  if (p.parentElement !== ctx.paneEl) ctx.paneEl.appendChild(p);
  p.style.display = 'flex';

  popoverInfo!.innerHTML = '';
  const tag = document.createElement('div');
  tag.className = 'inspect-tag-line';
  const locLabel =
    ctx.kind === 'file-reader' && ctx.lineStart
      ? `${ctx.filePath}:${ctx.lineStart}${ctx.lineEnd && ctx.lineEnd !== ctx.lineStart ? `-${ctx.lineEnd}` : ''}`
      : ctx.filePath;
  tag.textContent = locLabel;
  popoverInfo!.appendChild(tag);

  popoverTextarea!.value = '';
  popoverTextarea!.dispatchEvent(new Event('input'));
  popoverPlanModeCheckbox!.checked = true;

  const paneRect = ctx.paneEl.getBoundingClientRect();
  const selRect = getSelectionRect();
  p.style.minWidth = '0';
  p.style.maxWidth = `${Math.max(0, paneRect.width - 16)}px`;
  p.style.maxHeight = `${Math.max(0, paneRect.height - 16)}px`;
  if (selRect) {
    const left = selRect.right - paneRect.left + 8;
    const top = selRect.bottom - paneRect.top + 8;
    clampToPane(p, paneRect, left, top);
  } else {
    clampToPane(p, paneRect, 16, 16);
  }

  popoverTextarea!.focus();
}

function hideBubble(): void {
  if (askBubble) askBubble.style.display = 'none';
}

function dismiss(): void {
  hideBubble();
  if (popover) popover.style.display = 'none';
  currentCtx = null;
}

function composeOrNull(): { prompt: string; instruction: string; ctx: PaneContext } | null {
  if (!currentCtx || !popoverTextarea) return null;
  const instruction = popoverTextarea.value.trim();
  if (!instruction) return null;
  const prompt = buildPrompt(currentCtx, instruction);
  return { prompt, instruction, ctx: currentCtx };
}

function submit(): void {
  const composed = composeOrNull();
  if (!composed) return;
  const project = appState.activeProject;
  if (!project) return;
  const fileName = composed.ctx.filePath.split('/').pop() || 'file';
  const sessionName = `${fileName}: ${composed.instruction.slice(0, 30)}`;
  const planMode = popoverPlanModeCheckbox?.checked ?? true;
  const newSession = appState.addPlanSession(project.id, sessionName, planMode);
  if (newSession) {
    setPendingPrompt(newSession.id, composed.prompt);
  }
  dismiss();
}

function submitToCustomSession(): void {
  const composed = composeOrNull();
  if (!composed) return;
  promptNewSession((session) => {
    setPendingPrompt(session.id, composed.prompt);
    dismiss();
  });
}

function showBubbleForSelection(ctx: PaneContext): void {
  const selRect = getSelectionRect();
  if (!selRect) return;
  const b = ensureBubble();
  if (b.parentElement !== ctx.paneEl) ctx.paneEl.appendChild(b);
  b.style.display = 'inline-flex';
  const paneRect = ctx.paneEl.getBoundingClientRect();
  const left = selRect.right - paneRect.left + 4;
  const top = selRect.bottom - paneRect.top + 4;
  clampToPane(b, paneRect, left, top);
}

const FILE_PANE_SELECTOR = '[data-pane-kind="file-viewer"],[data-pane-kind="file-reader"]';
let checkPending = false;

function onMouseUp(e: MouseEvent): void {
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (popover?.contains(t) || askBubble?.contains(t)) return;
  if (!t.closest(FILE_PANE_SELECTOR)) return;
  if (checkPending) return;
  checkPending = true;
  // Defer so the browser has finalized the selection by the time we read it.
  setTimeout(() => {
    checkPending = false;
    const ctx = getPaneContext();
    if (!ctx) {
      hideBubble();
      return;
    }
    currentCtx = ctx;
    showBubbleForSelection(ctx);
  }, 0);
}

function onSelectionChange(): void {
  if (popover && popover.style.display !== 'none') return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) hideBubble();
}

function onDocMouseDown(e: MouseEvent): void {
  const t = e.target;
  if (!(t instanceof Node)) return;
  if (popover && popover.style.display !== 'none' && !popover.contains(t) && !askBubble?.contains(t)) {
    dismiss();
  }
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && popover && popover.style.display !== 'none') {
    dismiss();
  }
}

export function initFilePrompt(): void {
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('mousedown', onDocMouseDown, true);
  document.addEventListener('keydown', onKeyDown);
}
