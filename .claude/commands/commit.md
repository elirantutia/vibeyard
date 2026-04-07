Create a git commit for the current staged (or unstaged) changes using a structured commit message convention.

## Instructions

1. **Inspect the working tree:**
   - Run `git status` (never use `-uall`) to see untracked and modified files.
   - Run `git diff --staged` to see what is already staged.

2. **Run tests:**
   - Run `npm test` and verify all tests pass.
   - If any test fails, stop and report the failure — do NOT proceed with the commit.

3. **Stage files if nothing is staged:**
   - If there are no staged changes but there are modified/untracked files, stage the relevant ones.
   - Only stage files that are relevant to the current task or session. Do NOT stage unrelated changes that happen to exist in the working tree.
   - NEVER stage files that likely contain secrets (`.env`, `credentials.json`, `.key` files, etc.).
   - Prefer staging specific files by name over `git add -A`.

4. **Analyze the changes and choose a prefix:**
   Pick the most appropriate prefix based on the nature of the changes:

   | Prefix       | When to use                                      | Release Notes Section |
   |--------------|--------------------------------------------------|-----------------------|
   | `add`        | New feature, file, or capability                 | Features              |
   | `feat`       | New feature (alternative to `add`)               | Features              |
   | `implement`  | Completing a planned feature                     | Features              |
   | `introduce`  | Introducing a new concept or component           | Features              |
   | `support`    | Adding support for something new                 | Features              |
   | `fix`        | Bug fix or correction                            | Fixes                 |
   | `resolve`    | Resolving an issue                               | Fixes                 |
   | `patch`      | Small targeted fix                               | Fixes                 |
   | `correct`    | Correcting wrong behavior                        | Fixes                 |
   | `improve`    | Enhancement to existing functionality            | Changes               |
   | `update`     | Updating existing behavior or dependencies       | Changes               |
   | `remove`     | Removing code, features, or files                | Changes               |
   | `refactor`   | Code restructuring without behavior change       | Changes               |
   | `bump`       | Version bump                                     | Changes               |

5. **Format the commit message:**
   - Format: `<prefix> <concise lowercase description>`
   - Examples: `add dark mode support`, `fix session resume on restart`, `refactor PTY lifecycle management`
   - Keep it concise — one line, no period at the end
   - Focus on the "what" and "why", not the "how"

6. **If `$ARGUMENTS` is provided**, use it as guidance or context for the commit message. It may be a description of what was done, a hint about the prefix to use, or a full message to refine.

7. **Create the commit** using a HEREDOC for the message:
   ```
   git commit -m "$(cat <<'EOF'
   <prefix> <description>

   Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

8. **Verify** by running `git status` after the commit to confirm success.

9. Do NOT push to the remote unless explicitly asked.

$ARGUMENTS
