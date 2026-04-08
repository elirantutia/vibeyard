import { appState } from '../../state.js';
import { promptNewSession } from '../tab-bar.js';
import { setPendingPrompt } from '../terminal-pane.js';
import type { BrowserTabInstance } from './types.js';

export function toggleDrawMode(instance: BrowserTabInstance): void {
  instance.drawMode = !instance.drawMode;
  instance.drawBtn.classList.toggle('active', instance.drawMode);
  instance.inspectBtn.disabled = instance.drawMode;
  instance.recordBtn.disabled = instance.drawMode;
  if (instance.drawMode) {
    instance.webview.send('enter-draw-mode');
    instance.drawPanel.style.display = 'flex';
    instance.drawInstructionInput.value = '';
    instance.drawInstructionInput.focus();
  } else {
    instance.webview.send('exit-draw-mode');
    instance.drawPanel.style.display = 'none';
  }
}

export function clearDrawing(instance: BrowserTabInstance): void {
  instance.webview.send('draw-clear');
}

export function dismissDraw(instance: BrowserTabInstance): void {
  instance.drawInstructionInput.value = '';
  if (instance.drawMode) toggleDrawMode(instance);
}

async function captureScreenshotPath(instance: BrowserTabInstance): Promise<string | null> {
  try {
    const image = await instance.webview.capturePage();
    return await window.vibeyard.browser.saveScreenshot(instance.sessionId, image.toDataURL());
  } catch (err) {
    console.error('Failed to capture browser screenshot', err);
    return null;
  }
}

function buildDrawPrompt(instance: BrowserTabInstance, imagePath: string): string {
  const instruction = instance.drawInstructionInput.value.trim();
  const pageUrl = instance.urlInput.value;
  const vp = instance.currentViewport;
  const vpCtx = vp.width !== null ? ` [viewport: ${vp.width}×${vp.height} – ${vp.label}]` : '';
  return (
    `Regarding the page at ${pageUrl}${vpCtx}:\n` +
    `See annotated screenshot: ${imagePath}\n` +
    `${instruction}`
  );
}

export async function sendDrawToNewSession(instance: BrowserTabInstance): Promise<void> {
  const instruction = instance.drawInstructionInput.value.trim();
  if (!instruction) return;
  const project = appState.activeProject;
  if (!project) return;

  const imagePath = await captureScreenshotPath(instance);
  if (!imagePath) return;

  const prompt = buildDrawPrompt(instance, imagePath);
  const newSession = appState.addSession(project.id, `Draw: ${instruction.slice(0, 30)}`);
  if (newSession) {
    setPendingPrompt(newSession.id, prompt);
  }
  dismissDraw(instance);
}

export async function sendDrawToCustomSession(instance: BrowserTabInstance): Promise<void> {
  const instruction = instance.drawInstructionInput.value.trim();
  if (!instruction) return;

  const imagePath = await captureScreenshotPath(instance);
  if (!imagePath) return;

  const prompt = buildDrawPrompt(instance, imagePath);
  promptNewSession((session) => {
    setPendingPrompt(session.id, prompt);
    dismissDraw(instance);
  });
}
