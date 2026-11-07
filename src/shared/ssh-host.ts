/** Valid SSH destination: an ssh_config alias, host, or user@host. Never an option (no leading '-'). */
export function isValidSshHost(host: string): boolean {
  return /^[A-Za-z0-9_.@:-]+$/.test(host) && !host.startsWith('-');
}

export interface SshHostInfo { alias: string; hostName?: string; user?: string; port?: string }

/** Option label for an ssh_config host: `alias  (user@hostname:port)`. */
export function sshHostLabel(h: SshHostInfo): string {
  return h.hostName ? `${h.alias}  (${h.user ? `${h.user}@` : ''}${h.hostName}${h.port ? `:${h.port}` : ''})` : h.alias;
}

/** "Run on" select options: the local/default choice first, then every ssh_config host. */
export function sshHostOptions(hosts: SshHostInfo[], defaultLabel: string): Array<{ value: string; label: string }> {
  return [{ value: '', label: defaultLabel }, ...hosts.map((h) => ({ value: h.alias, label: sshHostLabel(h) }))];
}
