import type { TeamMember } from '../../../shared/types.js';
import { buildNewFileUrl } from '../../../shared/team-config.js';
import { memberToMarkdown, slugifyMemberId } from './frontmatter.js';

export async function shareTeamMember(member: TeamMember): Promise<void> {
  const md = memberToMarkdown(member);
  const filename = `${slugifyMemberId(member.id || member.name)}.md`;
  await window.vibeyard.clipboard.write(md);
  await window.vibeyard.app.openExternal(buildNewFileUrl(filename));
}
