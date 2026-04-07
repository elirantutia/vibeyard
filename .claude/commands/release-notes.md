Generate release notes for this project and save them to CHANGELOG.md.

## Instructions

1. **Determine the target version:**
   - If an argument was provided (e.g., `v0.3.0`), use that as the version. Strip any leading `v` for display but use the `v`-prefixed form for tags.
   - If no argument was provided, read the version from `package.json` and prefix it with `v` for the tag name.

2. **Find the previous version tag:**
   - Run `git tag --list 'v*' --sort=-version:refname` to list all version tags sorted descending.
   - The previous tag is the first tag that is NOT the current version's tag.
   - If no previous tag exists, use the root commit (`git rev-list --max-parents=0 HEAD`).

3. **Collect commits:**
   - If the current version tag exists: collect commits between the previous tag and the current tag.
   - If the current version tag does NOT exist: collect commits between the previous tag and HEAD.
   - Use `git log <range> --pretty=format:"%s" --no-merges` to get commit subjects.

4. **Categorize commits into sections:**
   - **Features:** commits starting with `add`, `feat`, `implement`, `introduce`, `support` (case-insensitive)
   - **Fixes:** commits starting with `fix`, `resolve`, `patch`, `correct` (case-insensitive)
   - **Changes:** everything else
   - Strip the prefix keyword from the message for cleaner display (e.g., "add dark mode" → "Dark mode")
   - Capitalize the first letter of each entry.

5. **Format the release notes entry:**
   ```
   ## [<version>] - <YYYY-MM-DD>

   ### Features
   - Entry 1
   - Entry 2

   ### Fixes
   - Entry 1

   ### Changes
   - Entry 1
   ```
   - Omit any section that has zero entries.
   - Use today's date.

6. **Update CHANGELOG.md:**
   - If `CHANGELOG.md` does not exist, create it with this header:
     ```
     # Changelog

     All notable changes to this project will be documented in this file.

     ```
   - Prepend the new release entry after the header (after the blank line following the description).
   - Do NOT duplicate an entry if one for this version already exists — warn the user instead.

7. **Output a summary** of what was generated (number of commits categorized, sections included).

$ARGUMENTS
