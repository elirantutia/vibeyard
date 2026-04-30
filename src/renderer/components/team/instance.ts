export interface TeamInstance {
  sessionId: string;
  projectId: string;
  element: HTMLElement;
  destroy(): void;
}

export const instances = new Map<string, TeamInstance>();

export function getTeamInstance(sessionId: string): TeamInstance | undefined {
  return instances.get(sessionId);
}
