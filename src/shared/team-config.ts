// Source of predefined team members. The picker fetches this directory at
// runtime via the GitHub Contents API. Personas live in this repo's
// top-level `personas/` folder so curated content can be updated
// independently of app releases — flip the four fields below to retarget.

export const TEAM_MEMBERS_REPO = {
  owner: 'elirantutia',
  repo: 'vibeyard',
  branch: 'main',
  path: 'personas',
} as const;

export function buildContentsApiUrl(): string {
  const { owner, repo, path, branch } = TEAM_MEMBERS_REPO;
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
}

export function buildRawUrl(filename: string): string {
  const { owner, repo, branch, path } = TEAM_MEMBERS_REPO;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}/${filename}`;
}
