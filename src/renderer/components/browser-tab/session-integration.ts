import { appState, type SessionRecord } from '../../state.js';
import { promptNewSession } from '../tab-bar.js';
import { injectPromptIntoRunningSession, setPendingPrompt } from '../terminal-pane.js';
import type { BrowserTabInstance } from './types.js';
import { buildPrompt, dismissInspect } from './inspect-mode.js';
import { buildFlowPrompt, dismissFlow } from './flow-recording.js';
import {
  buildDrawPrompt,
  captureScreenshotPath,
  dismissDraw,
  hideDrawError,
  sendDrawToNewSession,
  showDrawError,
} from './draw-mode.js';

function deliver(session: SessionRecord, prompt: string): void {
  const project = appState.activeProject;
  if (!injectPromptIntoRunningSession(session.id, prompt)) {
    setPendingPrompt(session.id, prompt);
  }
  if (project) appState.setActiveSession(project.id, session.id);
}

export function sendFlowToNewSession(instance: BrowserTabInstance): void {
  const instruction = instance.flowInstructionInput.value.trim();
  const prompt = buildFlowPrompt(instance);
  if (!prompt) return;
  const project = appState.activeProject;
  if (!project) return;

  const newSession = appState.addPlanSession(project.id, `Flow: ${instruction.slice(0, 30)}`, instance.flowPlanModeCheckbox.checked);
  if (newSession) {
    setPendingPrompt(newSession.id, prompt);
  }
  dismissFlow(instance);
}

export function sendFlowToCustomSession(instance: BrowserTabInstance): void {
  const prompt = buildFlowPrompt(instance);
  if (!prompt) return;

  promptNewSession((session) => {
    setPendingPrompt(session.id, prompt);
    dismissFlow(instance);
  });
}

export function sendToNewSession(instance: BrowserTabInstance): void {
  const info = instance.selectedElement;
  const prompt = buildPrompt(instance);
  if (!info || !prompt) return;
  const project = appState.activeProject;
  if (!project) return;

  const sessionName = `${info.tagName}: ${instance.instructionInput.value.trim().slice(0, 30)}`;
  const newSession = appState.addPlanSession(project.id, sessionName, instance.inspectPlanModeCheckbox.checked);
  if (newSession) {
    setPendingPrompt(newSession.id, prompt);
  }
  dismissInspect(instance);
}

export function sendToCustomSession(instance: BrowserTabInstance): void {
  const prompt = buildPrompt(instance);
  if (!prompt) return;

  promptNewSession((session) => {
    setPendingPrompt(session.id, prompt);
    dismissInspect(instance);
  });
}

export function deliverInspect(instance: BrowserTabInstance, session: SessionRecord): void {
  const prompt = buildPrompt(instance);
  if (!prompt) return;
  deliver(session, prompt);
  dismissInspect(instance);
}

export function deliverFlow(instance: BrowserTabInstance, session: SessionRecord): void {
  const prompt = buildFlowPrompt(instance);
  if (!prompt) return;
  deliver(session, prompt);
  dismissFlow(instance);
}

export async function deliverDraw(instance: BrowserTabInstance, session: SessionRecord): Promise<void> {
  const instruction = instance.drawInstructionInput.value.trim();
  if (!instruction) return;

  hideDrawError(instance);
  const imagePath = await captureScreenshotPath(instance);
  if (!imagePath) {
    showDrawError(instance, 'Failed to capture screenshot. Try again.');
    return;
  }

  const prompt = buildDrawPrompt(instance, imagePath);
  deliver(session, prompt);
  dismissDraw(instance);
}
