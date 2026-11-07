import { isValidSshHost } from '../shared/ssh-host.js';
import { t } from './i18n.js';

export type RunLocationResult =
  | { ok: true; path: string }
  | { ok: false; field: 'host' | 'path'; error: string };

/**
 * Resolve and verify a folder typed into a dialog, on this computer (`host`
 * '') or on an SSH host. Returns the absolute path, or which field is wrong
 * and the (translated) message to show on it. Shared by the New Project and
 * New Session dialogs so their validation cannot drift.
 */
export async function resolveRunLocation(host: string, rawPath: string): Promise<RunLocationResult> {
  if (host) {
    if (!isValidSshHost(host)) return { ok: false, field: 'host', error: t('sidebar.newProject.remoteHostInvalid') };
    const res = await window.vibeyard.remote.resolveDir(host, rawPath);
    return res.ok
      ? { ok: true, path: res.path }
      : { ok: false, field: 'path', error: t('sidebar.newProject.remoteCheckFailed', { error: res.error }) };
  }
  // fs:isDirectory expands `~` itself, so both calls can run at once.
  const [localPath, isDir] = await Promise.all([
    window.vibeyard.fs.expandPath(rawPath),
    window.vibeyard.fs.isDirectory(rawPath),
  ]);
  return isDir ? { ok: true, path: localPath } : { ok: false, field: 'path', error: t('sidebar.newProject.directoryNotExist') };
}
