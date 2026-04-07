Perform a full release: generate release notes, bump version, commit, tag, and push.

## Instructions

### 1. Run tests

- Run `npm test` and ensure all tests pass before proceeding. If any test fails, stop and report the failure to the user.

### 2. Determine the new version

- The argument specifies the version bump type or an explicit version.
- If the argument is `major`, `minor`, or `patch`, calculate the new version by bumping the corresponding part of the current version in `package.json`.
- If the argument is an explicit version (e.g., `0.3.0` or `v0.3.0`), use that. Strip any leading `v`.
- If no argument is provided, default to `patch`.

### 3. Generate release notes

- Run the `/release-notes` skill with the new version to generate and prepend the changelog entry to `CHANGELOG.md`.

### 4. Bump the version and commit

- Use `npm version <major|minor|patch|explicit-version> --no-git-tag-version` to bump `package.json` and `package-lock.json` without creating a git tag yet.
- Stage `package.json`, `package-lock.json`, and `CHANGELOG.md`.
- Commit with the message: `release: v<version>`

### 5. Create the git tag

- Create an annotated tag: `git tag -a v<version> -m "v<version>"`

### 6. Confirm before pushing

- Show the user a summary of what was done:
  - Version: old → new
  - Changelog entries generated
  - Commit hash
  - Tag name
- Ask the user to confirm before pushing. If confirmed:
  - `git push origin main`
  - `git push origin v<version>`
- If denied, inform the user the commit and tag are local and can be undone.

$ARGUMENTS
