export interface ProjectTabInstance {
  sessionId: string;
  projectId: string;
  element: HTMLElement;
  destroy(): void;
}

export const instances = new Map<string, ProjectTabInstance>();

export function getProjectTabInstance(sessionId: string): ProjectTabInstance | undefined {
  return instances.get(sessionId);
}
