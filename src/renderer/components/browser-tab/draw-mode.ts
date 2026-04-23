import { appState } from '../../state.js';
import { promptNewSession } from '../tab-bar.js';
import { setPendingPrompt } from '../terminal-pane.js';
import type { BrowserTabInstance } from './types.js';
import { positionPopover } from './popover.js';
import { getViewportContext } from './viewport.js';
import { isWin } from '../../platform.js';

export function toggleDrawMode(instance: BrowserTabInstance): void {
  instance.drawMode = !instance.drawMode;
  instance.drawBtn.classList.toggle('active', instance.drawMode);
  instance.inspectBtn.disabled = instance.drawMode;
  instance.recordBtn.disabled = instance.drawMode;
  if (instance.drawMode) {
    instance.webview.send('enter-draw-mode');
    instance.drawInstructionInput.value = '';
    instance.drawInstructionInput.dispatchEvent(new Event('input'));
  } else {
    instance.webview.send('exit-draw-mode');
    instance.drawPanel.style.display = 'none';
  }
}

export function positionDrawPopover(instance: BrowserTabInstance, x: number, y: number): void {
  const wasHidden = instance.drawPanel.style.display === 'none';
  instance.drawPanel.style.display = 'flex';
  positionPopover(instance, instance.drawPanel, x, y);
  if (wasHidden) instance.drawInstructionInput.focus();
}

export function clearDrawing(instance: BrowserTabInstance): void {
  instance.webview.send('draw-clear');
  instance.drawPanel.style.display = 'none';
}

export function dismissDraw(instance: BrowserTabInstance): void {
  instance.drawInstructionInput.value = '';
  instance.drawInstructionInput.dispatchEvent(new Event('input'));
  hideDrawError(instance);
  if (instance.drawMode) toggleDrawMode(instance);
}

/** @internal Exported for testing */
export function hideDrawError(instance: BrowserTabInstance): void {
  instance.drawErrorEl.style.display = 'none';
  instance.drawErrorEl.textContent = '';
}

/** @internal Exported for testing */
export function showDrawError(instance: BrowserTabInstance, message: string): void {
  instance.drawErrorEl.textContent = message;
  instance.drawErrorEl.style.display = 'block';
  setTimeout(() => hideDrawError(instance), 4000);
}

/** @internal Exported for testing */
export async function captureScreenshotPath(instance: BrowserTabInstance): Promise<string | null> {
  try {
    const image = await instance.webview.capturePage();
    return await window.vibeyard.browser.saveScreenshot(instance.sessionId, image.toDataURL());
  } catch (err) {
    console.error('Failed to capture browser screenshot', err);
    return null;
  }
}

/** @internal Exported for testing */
export function buildDrawPrompt(instance: BrowserTabInstance, imagePath: string): string {
  const instruction = instance.drawInstructionInput.value.trim();
  const pageUrl = instance.urlInput.value;
  const vpCtx = getViewportContext(instance, instance.drawAttachDimsCheckbox.checked);
  // On Windows, cmd.exe /c truncates arguments at newline characters.
  const sep = isWin ? ' | ' : '\n';
  return (
    `Regarding the page at ${pageUrl}${vpCtx}:${sep}` +
    `See annotated screenshot: ${imagePath}${sep}` +
    `${instruction}`
  );
}

export async function sendDrawToNewSession(instance: BrowserTabInstance): Promise<void> {
  const instruction = instance.drawInstructionInput.value.trim();
  if (!instruction) return;
  const project = appState.activeProject;
  if (!project) return;

  hideDrawError(instance);
  const imagePath = await captureScreenshotPath(instance);
  if (!imagePath) {
    showDrawError(instance, 'Failed to capture screenshot. Try again.');
    return;
  }

  const prompt = buildDrawPrompt(instance, imagePath);
  const newSession = appState.addPlanSession(project.id, `Draw: ${instruction.slice(0, 30)}`, instance.drawPlanModeCheckbox.checked);
  if (newSession) {
    setPendingPrompt(newSession.id, prompt);
  }
  dismissDraw(instance);
}

export async function sendDrawToCustomSession(instance: BrowserTabInstance): Promise<void> {
  const instruction = instance.drawInstructionInput.value.trim();
  if (!instruction) return;

  hideDrawError(instance);
  const imagePath = await captureScreenshotPath(instance);
  if (!imagePath) {
    showDrawError(instance, 'Failed to capture screenshot. Try again.');
    return;
  }

  const prompt = buildDrawPrompt(instance, imagePath);
  promptNewSession((session) => {
    setPendingPrompt(session.id, prompt);
    dismissDraw(instance);
  });
}
