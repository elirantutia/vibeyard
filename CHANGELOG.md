# Changelog

All notable changes to this project will be documented in this file.

## [0.2.6] - 2026-03-20

### Features
- Session archiving on /clear (CLI session ID change)

### Fixes
- Capture CLI session ID on SessionStart hook for /clear detection
- Map Stop hook event to completed instead of waiting

### Changes
- Make history item row clickable instead of resume button
- Remove Linux build target from release workflow

## [0.2.5] - 2026-03-20

### Features
- Sidebar view visibility preferences
- Session history UI, sidebar panel, and resume bug fix
- Session history with archiving, resume, and duplicate tab prevention
- Clickable file paths in terminal output
- Test coverage for CLI provider abstraction
- Unread session indicator on sidebar project names
- CLI provider abstraction for multi-tool support
- Open source foundations: governance, security, shared types, CI, and Linux builds
- Startup validation for Claude CLI prerequisite
- Comprehensive test coverage for state, shortcuts, hook-status, claude-cli, and auto-updater
- Git worktree support, PTY cwd tracking, and fix PATH resolution in release builds

### Fixes
- Atomic state file writes to prevent corruption on crash
- Completed status dot being immediately overwritten by Stop hook
- Tab close activating adjacent tab instead of first tab
- Unread session indicator not showing for non-active projects
- Preferences modal resizing when switching sections
- Escape key not closing preferences and help dialogs
- Session staying "working" after API errors by adding StopFailure hook
- Shift+Enter submitting prompt instead of inserting newline
- Incorrect Gatekeeper instructions in README

### Changes
- Improve help and preferences dialog width
- Improve open-source readiness with README overhaul, community files, and naming fixes
- Update README with build-from-source instructions
- Update commit command to warn against staging unrelated changes
- Update xterm to v6, electron to v41, and minor addon bumps
- Update config sections to be collapsed by default

## [0.2.4] - 2026-03-19

### Fixes
- GitHub releases being draft and missing release notes

## [0.2.3] - 2026-03-19

### Changes
- Build and release to macOS-only with unsigned app and add README

## [0.2.2] - 2026-03-19

### Features
- Test run step to commit command before staging and committing
- Git workflow section to CLAUDE.md requiring /commit command
- Test step to release command before version bump

### Fixes
- Release workflow git push 403 by granting write permissions to GITHUB_TOKEN
- Claude prompt passed via heredoc stdin to avoid shell parsing issues
- Test assertions to include filePath property added to config objects

### Changes
- Extract deterministic steps from Claude prompt in release workflow
- Release workflow to CI-driven process via workflow_dispatch and Claude Code CLI

## [0.2.1] - 2026-03-19

### Features
- Clickable file viewer for agents, MCP, skills, and commands in sidebar
- Commands section to sidebar for custom slash commands
- Release slash command for version bump, changelog, tag, and push
- Auto-update mechanism with GitHub Releases and CI workflow
- Quick open file viewer with Cmd+P shortcut
- Unit test infrastructure with vitest and coverage reporting
- Diff viewer for git panel files

### Fixes
- MCP server listing to read from all Claude CLI config sources

### Changes
- Claude code custom commands and changelog
