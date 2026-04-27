import type { ProjectRecord, ProviderId, SessionRecord } from '../../shared/types.js';

interface BaseOpts {
  id?: string;
  createdAt?: string;
}

export function buildCliSession(opts: BaseOpts & { name: string; providerId: ProviderId; args?: string; cwd?: string }): SessionRecord {
  const { name, providerId, args, cwd, id = crypto.randomUUID(), createdAt = new Date().toISOString() } = opts;
  return {
    id,
    name,
    providerId,
    ...(args ? { args } : {}),
    ...(cwd ? { cwd } : {}),
    cliSessionId: null,
    createdAt,
  };
}

export function buildDiffViewerSession(opts: BaseOpts & { name: string; filePath: string; area: string; worktreePath?: string }): SessionRecord {
  const { name, filePath, area, worktreePath, id = crypto.randomUUID(), createdAt = new Date().toISOString() } = opts;
  return {
    id,
    name,
    type: 'diff-viewer',
    diffFilePath: filePath,
    diffArea: area,
    ...(worktreePath ? { worktreePath } : {}),
    cliSessionId: null,
    createdAt,
  };
}

export function buildRemoteSession(opts: BaseOpts & { id: string; name: string; remoteHostName: string; shareMode: 'readonly' | 'readwrite' }): SessionRecord {
  const { id, name, remoteHostName, shareMode, createdAt = new Date().toISOString() } = opts;
  return {
    id,
    name,
    type: 'remote-terminal',
    remoteHostName,
    shareMode,
    cliSessionId: null,
    createdAt,
  };
}

export function buildBrowserTabSession(opts: BaseOpts & { name: string; url?: string }): SessionRecord {
  const { name, url, id = crypto.randomUUID(), createdAt = new Date().toISOString() } = opts;
  return {
    id,
    name,
    type: 'browser-tab',
    browserTabUrl: url,
    cliSessionId: null,
    createdAt,
  };
}

export function buildProjectTabSession(opts: BaseOpts & { name: string }): SessionRecord {
  const { name, id = crypto.randomUUID(), createdAt = new Date().toISOString() } = opts;
  return {
    id,
    name,
    type: 'project-tab',
    cliSessionId: null,
    createdAt,
  };
}

export function buildFileReaderSession(opts: BaseOpts & { name: string; filePath: string; lineNumber?: number }): SessionRecord {
  const { name, filePath, lineNumber, id = crypto.randomUUID(), createdAt = new Date().toISOString() } = opts;
  return {
    id,
    name,
    type: 'file-reader',
    fileReaderPath: filePath,
    ...(lineNumber !== undefined ? { fileReaderLine: lineNumber } : {}),
    cliSessionId: null,
    createdAt,
  };
}

export function buildMcpInspectorSession(opts: BaseOpts & { name: string }): SessionRecord {
  const { name, id = crypto.randomUUID(), createdAt = new Date().toISOString() } = opts;
  return {
    id,
    name,
    type: 'mcp-inspector',
    cliSessionId: null,
    createdAt,
  };
}

/**
 * Append a session to a project, mark it active, and (when in swarm mode)
 * add it to the swarm panes. Does not call persist() or emit events — those
 * remain the caller's responsibility.
 */
export function attachSessionToProject(
  project: ProjectRecord,
  session: SessionRecord,
  opts: { addToSwarm?: boolean } = {},
): SessionRecord {
  project.sessions.push(session);
  project.activeSessionId = session.id;
  if (opts.addToSwarm && project.layout.mode === 'swarm') {
    project.layout.splitPanes.push(session.id);
  }
  return session;
}
