/**
 * The project's folder on *this* machine, or undefined when it has none: a
 * remote (SSH) project's `path` is on its host, and the built-in Temporary
 * project has no folder at all (each of its sessions carries its own). Every
 * project-folder feature (git, file listing, shell cwd, the fs sandbox) asks
 * this instead of checking `remoteHost` / `temporary` itself.
 */
export function localProjectFolder(project: { path: string; remoteHost?: string; temporary?: boolean }): string | undefined {
  return project.temporary || project.remoteHost || !project.path ? undefined : project.path;
}
