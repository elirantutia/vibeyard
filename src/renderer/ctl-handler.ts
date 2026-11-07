// Executes external-control commands against live renderer state. Pure over
// injected deps so it can be tested without the DOM; ctl-bridge.ts wires the
// real appState / session-close / terminal-pane functions.
import type { ProjectRecord, SessionRecord, ProviderId } from '../shared/types.js';
import { ctlError, type CtlCommand, type CtlResult, type CtlListEntry, type CtlSessionStatus } from '../shared/ctl-protocol.js';
import type { ExternalSessionOpts } from './state.js';
import { isCliSession } from './session-utils.js';

export interface CtlHandlerDeps {
  projects(): ProjectRecord[];
  addExternalSession(projectId: string, opts: ExternalSessionOpts): SessionRecord | undefined;
  renameSession(projectId: string, sessionId: string, name: string, userRenamed: boolean): void;
  closeSessionWithConfirm(projectId: string, sessionId: string): void;
  needsCloseConfirmation(sessionId: string): boolean;
  hookStatus(sessionId: string): string;
  terminalState(sessionId: string): { spawned: boolean; exited: boolean } | undefined;
  isKnownProvider(providerId: string): boolean;
  /** The provider a new session will actually run on: the requested one, else the default. */
  effectiveProvider(requested?: string): string;
  /** The provider a profile belongs to, or undefined when no such profile exists. */
  profileProvider(profileId: string): string | undefined;
}

const RENAMEABLE = (s: SessionRecord) => s.type !== 'kanban' && s.type !== 'project-tab';

export function toCtlStatus(hook: string, terminal: { spawned: boolean; exited: boolean } | undefined): CtlSessionStatus {
  if (!terminal || !terminal.spawned) return 'not_started';
  if (terminal.exited) return 'exited';
  if (hook === 'working') return 'working';
  if (hook === 'input') return 'input';
  return 'idle';
}

function normalizePath(p: string): string {
  return p.length > 1 ? p.replace(/[\\/]+$/, '') : p;
}

function findProject(deps: CtlHandlerDeps, ref: string): ProjectRecord | undefined {
  const want = normalizePath(ref);
  return deps.projects().find((p) => p.id === ref || normalizePath(p.path) === want);
}

function findSession(deps: CtlHandlerDeps, sessionId: string): { project: ProjectRecord; session: SessionRecord } | undefined {
  for (const project of deps.projects()) {
    const session = project.sessions.find((s) => s.id === sessionId);
    if (session) return { project, session };
  }
  return undefined;
}

function owns(callerId: string, session: SessionRecord): boolean {
  return session.id === callerId || session.createdBy === callerId;
}

export function handleCtlCommand(deps: CtlHandlerDeps, callerId: string, command: CtlCommand): CtlResult {
  switch (command.action) {
    case 'new-session': {
      const project = command.project !== undefined
        ? findProject(deps, command.project)
        : findSession(deps, callerId)?.project;
      if (!project) return ctlError('unknown_project', command.project !== undefined ? `no project '${command.project}'` : 'caller tab no longer exists; pass --project');
      // Its sessions each need a folder picked; ctl has no way to give one.
      if (project.temporary) return ctlError('unsupported', 'the Temporary project has no folder; pass --project <id|path> of a real project');
      if (command.provider !== undefined && !deps.isKnownProvider(command.provider)) return ctlError('invalid_request', `unknown provider '${command.provider}'`);
      // An explicit profile that doesn't exist, or belongs to another provider
      // than the one that will run, must fail: falling through to the default
      // account would run the worker under the wrong login/license.
      if (command.profile !== undefined) {
        const owner = deps.profileProvider(command.profile);
        if (owner === undefined) return ctlError('invalid_request', `unknown profile '${command.profile}'`);
        const effective = deps.effectiveProvider(command.provider);
        if (owner !== effective) return ctlError('invalid_request', `profile '${command.profile}' is for provider '${owner}', not '${effective}'; pass --provider ${owner}`);
      }
      const session = deps.addExternalSession(project.id, {
        name: command.name,
        initialPrompt: command.prompt,
        providerId: command.provider as ProviderId | undefined,
        profileId: command.profile,
        createdBy: callerId,
        focus: command.focus === true,
      });
      if (!session) return ctlError('unknown_project', `no project '${project.id}'`);
      return { ok: true, result: { sessionId: session.id, projectId: project.id, name: session.name } };
    }
    case 'rename': {
      const found = findSession(deps, command.sessionId);
      if (!found) return ctlError('unknown_session', `no session '${command.sessionId}'`);
      if (!owns(callerId, found.session)) return ctlError('not_owner', 'a tab can only rename itself and tabs it created');
      if (!RENAMEABLE(found.session)) return ctlError('unsupported', `cannot rename a ${found.session.type} tab`);
      // A rename to the current name is a no-op: calling renameSession would set userRenamed and stop auto-titling.
      if (command.name === found.session.name) return { ok: true, result: { sessionId: found.session.id, name: found.session.name } };
      deps.renameSession(found.project.id, found.session.id, command.name, true);
      return { ok: true, result: { sessionId: found.session.id, name: found.session.name } };
    }
    case 'close': {
      const found = findSession(deps, command.sessionId);
      if (!found) return ctlError('unknown_session', `no session '${command.sessionId}'`);
      if (!owns(callerId, found.session)) return ctlError('not_owner', 'a tab can only close itself and tabs it created');
      const awaiting = deps.needsCloseConfirmation(found.session.id);
      deps.closeSessionWithConfirm(found.project.id, found.session.id);
      return { ok: true, result: { state: awaiting ? 'awaiting_confirmation' : 'closed' } };
    }
    case 'list': {
      let projects = deps.projects();
      if (command.project !== undefined) {
        const project = findProject(deps, command.project);
        if (!project) return ctlError('unknown_project', `no project '${command.project}'`);
        projects = [project];
      }
      const rows: CtlListEntry[] = [];
      for (const project of projects) {
        for (const s of project.sessions) {
          if (!isCliSession(s)) continue;
          if (command.mine && s.createdBy !== callerId) continue;
          rows.push({
            projectId: project.id,
            sessionId: s.id,
            name: s.name,
            cliSessionId: s.cliSessionId,
            providerId: s.providerId ?? 'claude',
            status: toCtlStatus(deps.hookStatus(s.id), deps.terminalState(s.id)),
            createdBy: s.createdBy ?? null,
            createdAt: s.createdAt,
            cost: s.cost ? { totalCostUsd: s.cost.totalCostUsd } : null,
            userRenamed: s.userRenamed === true,
          });
        }
      }
      return { ok: true, result: rows };
    }
  }
}
