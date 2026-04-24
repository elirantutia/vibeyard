import { appState, type SessionRecord } from '../../state.js';
import { promptNewSession } from '../tab-bar.js';
import { getTerminalInstance, injectPromptIntoRunningSession, setPendingPrompt } from '../terminal-pane.js';
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

export function getDefaultTarget(): SessionRecord | null {
  const project = appState.activeProject;
  if (!project) return null;

  const isExited = (id: string): boolean => getTerminalInstance(id)?.exited === true;

  // 1. Prefer the session the user was most recently in (matches the sidebar's
  //    highlighted tab). Works even when the active session is a browser tab —
  //    we walk back through the nav history to find the last CLI-backed entry.
  const lastActive = appState.getLastActiveCliSessionInProject(project.id);
  if (lastActive && !isExited(lastActive.id)) return lastActive;

  // 2. Fall back to the first running CLI session in the project.
  const candidates = project.sessions.filter((s) => !s.type || s.type === 'claude');
  if (candidates.length === 0) return null;
  const running = candidates.find((s) => {
    const inst = getTerminalInstance(s.id);
    return inst?.spawned === true && !inst.exited;
  });
  if (running) return running;

  // 3. Fall back to the first non-exited candidate (dormant or never-spawned).
  return candidates.find((s) => !isExited(s.id)) ?? null;
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

export function sendToDefault(instance: BrowserTabInstance): void {
  const prompt = buildPrompt(instance);
  if (!prompt) return;
  const target = getDefaultTarget();
  if (!target) {
    sendToNewSession(instance);
    return;
  }
  deliver(target, prompt);
  dismissInspect(instance);
}

export function sendFlowToDefault(instance: BrowserTabInstance): void {
  const prompt = buildFlowPrompt(instance);
  if (!prompt) return;
  const target = getDefaultTarget();
  if (!target) {
    sendFlowToNewSession(instance);
    return;
  }
  deliver(target, prompt);
  dismissFlow(instance);
}

export async function sendDrawToDefault(instance: BrowserTabInstance): Promise<void> {
  const instruction = instance.drawInstructionInput.value.trim();
  if (!instruction) return;
  const target = getDefaultTarget();
  if (!target) {
    await sendDrawToNewSession(instance);
    return;
  }

  hideDrawError(instance);
  const imagePath = await captureScreenshotPath(instance);
  if (!imagePath) {
    showDrawError(instance, 'Failed to capture screenshot. Try again.');
    return;
  }

  const prompt = buildDrawPrompt(instance, imagePath);
  deliver(target, prompt);
  dismissDraw(instance);
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
