// In-memory only: tokens die with the app and are replaced on every spawn, so
// a token that leaks out of a tab is useless after that tab respawns.
import { randomBytes } from 'crypto';

const tokenToSession = new Map<string, string>();
const sessionToToken = new Map<string, string>();

export function issueCtlToken(sessionId: string): string {
  revokeCtlToken(sessionId);
  const token = randomBytes(32).toString('hex');
  tokenToSession.set(token, sessionId);
  sessionToToken.set(sessionId, token);
  return token;
}

export function revokeCtlToken(sessionId: string): void {
  const token = sessionToToken.get(sessionId);
  if (token) tokenToSession.delete(token);
  sessionToToken.delete(sessionId);
}

export function resolveCtlToken(token: string): string | undefined {
  if (!token) return undefined;
  return tokenToSession.get(token);
}

/** @internal Test-only */
export function _resetCtlTokensForTesting(): void {
  tokenToSession.clear();
  sessionToToken.clear();
}

/**
 * A Vibeyard launched from inside a Vibeyard tab (e.g. a dev build) inherits that
 * tab's VIBEYARD_CTL/VIBEYARD_CTL_TOKEN/VIBEYARD_CTL_DIR. Strip them at startup so
 * the parent tab's identity and the parent instance's commands folder never leak
 * into this instance's own shells; agent PTYs get fresh ones.
 */
export function stripInheritedCtlEnv(env: NodeJS.ProcessEnv = process.env): void {
  delete env.VIBEYARD_CTL_TOKEN;
  delete env.VIBEYARD_CTL;
  delete env.VIBEYARD_CTL_DIR;
}
