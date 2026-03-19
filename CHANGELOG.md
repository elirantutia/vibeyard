# Changelog

All notable changes to this project will be documented in this file.

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
