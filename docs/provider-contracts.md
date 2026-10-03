# Provider contracts

Project context menu → Settings always offers a coding provider and a profile scoped to that provider. `ProjectRecord.defaultProvider` is persisted; absent means the global default. New CLI sessions use explicit override → project default → global default → Claude. Plans and unpinned team chats also prefer an explicit project default over the active tab. Changing the provider resets an incompatible project profile. Running PTYs are not restarted by saving these settings. New-session and board dialogs preselect the project provider.

The registry in `src/main/providers/registry.ts` registers Claude Code, Codex CLI, GitHub Copilot, Gemini CLI, Pi and Oh my Pi. Provider capabilities determine which UI and status paths are enabled; do not assume all providers support profiles, hooks, resume, cost or self titles.

`src/main/pty-manager.ts` builds an argv array for node-pty. Never set `shell: true`. On Windows, `quoteArgForCmdExe` wraps each `cmd.exe` token and rejects double quotes that cannot be conveyed safely. `partitionUserEnv` removes provider-owned variables (`CLAUDE_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, `CLAUDE_IDE_SESSION_ID`) before merging user variables. PATH remains user configurable.

For profile-aware configuration, follow the same profile resolution chain used by spawning. `provider:getConfig` must receive the selected config directory; Pi reads that directory's `mcp.json`. Do not fall back to a different account's default configuration. `removeProfile` refuses removal while sessions or archives still pin it.

Transcript lookup must match the requested working directory. A matching CLI session ID in another project is insufficient. Claude, Codex, Copilot and Gemini report status through hooks where supported; Pi and Oh my Pi poll transcripts. See [session lifecycle](session-lifecycle.md) and [hook compatibility](../HOOKS.md).

Global search discovery accepts an optional abort signal and stops scheduling work when cancelled. Search indexing shares a four-operation budget and in-flight reads across requests. Workers retain compact results, not the full corpus. A versioned local derived index (`search-index-v2` under Electron user data) reuses unchanged source text after memory-cache eviction; mtime, size and ctime invalidate a record. Deleted sources are pruned after successful discovery. This index contains extracted user text and may be deleted to rebuild it; bump its version when extraction semantics change. Its disk size scales with history, while each text record is capped at 50 Ki characters including join separators and the in-memory text cache has an aggregate budget.

See [performance and resource limits](performance.md) for the exact cache budgets, plaintext disk-index lifecycle, cancellation boundaries, and remaining discovery costs. The four-operation indexing budget is not a global limit for all discovery filesystem work.
