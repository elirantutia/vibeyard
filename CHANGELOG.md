# Changelog

All notable changes to this project will be documented in this file.

## [0.2.27] - 2026-04-12

### Features

- Copilot CLI provider with hooks and config support
- Image preview in file reader
- Multi-terminal support to project terminal panel
- GitHub Discussions link to sidebar
- Scope config panel to project with provider dropdown

### Fixes

- False positive tool-not-found alerts from successful command output
- Claude detection for nvm installs on macOS

### Changes

- Hook script cleanup to avoid racing with long-lived CLI processes
- AI readiness provider filter with inline description
- Missing-provider dialog copy

## [0.2.26] - 2026-04-10

### Features

- Version-gated claude code hook installation
- Resume with different provider

### Fixes

- Windows platform compatibility and unify shortcut system
- Setup badge showing for uninstalled providers
- Auto-override legacy vibeyard statusline path on upgrade
- Cost attribution in session inspector tools and costs tabs

### Changes

- Split hook script dir from runtime status dir
- Centralize platform checks in platform.ts

## [0.2.25] - 2026-04-09

### Features

- Browser tab draw mode with annotated screenshots (#53)
- Add Windows support (#45)
- Cmd+[ and cmd+] shortcuts for tab back/forward history

### Fixes

- Browser tab not wrapping host:port urls with http://
- Browser tab wrapping non-http urls with http://
- Memory leaks from global drag listeners and unsubscribable onChange (#35)
- Browser tab panel lingering after close
- Codex and gemini cli detection in packaged builds

### Changes

- Split browser-tab-pane into focused modules

## [0.2.23] - 2026-04-07

### Features

- Browser flow recording for capturing click/navigate sequences
- New tab page with Vibeyard branding and dev port quick links
- Viewport picker to browser tab for responsive testing
- Custom size entry to browser tab viewport picker

### Fixes

- Persist browser tab URL on navigation so it survives app restart
- Ctrl+Shift+C clipboard copy in terminal panels
- Sidebar resize drag freezing when browser tab is open
- False "gh not installed" alert on HTTP 404 errors
- Require any CLI provider instead of Claude specifically

### Changes

- Browser tab reload icon size without changing button dimensions

## [0.2.22] - 2026-04-04

### Features

- Browser tab session type for embedded web UI editing
- Tests for terminal-pane pending prompt injection via startup arg
- Pending prompt inject via startup arg and fix-in-custom-session button in readiness modal
- Mcp usage badges in session inspector timeline
- Nested agent actions in session inspector timeline
- Enhanced agent info to session inspector
- Search match counter
- Markdown rendering support in file reader pane
- Session status indicators to README highlights
- Plan mode to fix sessions so CLI plans before implementing
- Provider filter to AI readiness analysis

### Fixes

- Parallel agent grouping in session inspector timeline
- Large-file alert not triggering for Read tool token-limit errors
- Large-file split alert not triggering and add file exclusions
- Tool alert misclassifying API 404 errors as "not installed"
- Text selection in git diff panel disappearing on file changes
- Readiness modal provider filter to only show registered providers
- External CLI sessions triggering notifications from Vibeyard
- Notification click to activate session and focus app window
- Session inspector shortcut to use Cmd+Shift+I on Mac via menu accelerator
- Path autocomplete showing only first 20 dirs before filtering
- Auto-fill project name from path when typing or using autocomplete

### Changes

- Split session-inspector into focused modules
- Use makeReadFailure helper in test for consistency
- Terminal selection visibility
- .npmrc and .pypirc from readiness sensitive file patterns
- Readme with session inspector feature in highlights

## [0.2.21] - 2026-04-01

### Features

- Gemini CLI provider support (#28)
- Codex CLI provider support (#27)
- Min-release-age=30 to project npmrc for supply chain security

### Fixes

- Allow text selection and copy in expanded inspector timeline items
- Skip large file alert for non-project files like .claude tool results
- Expand ~ in new project path field and add directory autocomplete (#24)

### Changes

- New-session shortcut default from Cmd+S to Cmd+T

## [0.2.20] - 2026-03-30

### Features

- Session inspector panel (#23)
- Go-to-line bar for file reader and fix stale CSS in build
- Search/filter input to branch switcher dropdown
- File watcher for live reload and fix quick-open to show all files including untracked and gitignored

### Fixes

- Session inspector opening unexpectedly on new session start
- Session inspector panel layout in swarm mode
- Non-CLI panels closing when focusing a session in swarm mode
- Git panel and diff viewer flickering on updates
- Yellow focus outline on file reader pane during go-to-line
- Quick-open file search to respect gitignore and rank results by relevance
- Terminal toggle button tooltip to show real shortcut

## [0.2.19] - 2026-03-29

### Features

- Large file read failure detector with split suggestion alert
- Cmd+J as alternate shortcut to toggle project terminal

### Fixes

- Large-file alert fix button by using SessionStart hook instead of setTimeout
- Alert banner flickering by disabling animation after initial fade-in
- Fix-prompt not delivered to new session by using SessionStart hook
- Session auto-naming capturing prompt text between separator lines via bare \r

### Changes

- Css style.css by splitting it into smaller files
- Large-files fix prompt to use direct CTA instead of suggestion
- Large file threshold from 5000 to 2000 lines in AI readiness checker
- Delete-project warning dialog to clarify only internal data is removed
- Ubuntu from CI matrix since app is macOS-only
- What's new dialog dismiss behavior and fix event listener cleanup

## [0.2.18] - 2026-03-29

### Features

- Ctrl+F search support in project shell terminal
- Git branch switcher menu when clicking branch name in status bar
- Cmd+W closes active session, Cmd+Shift+W closes window
- Make GitHub issue/PR references clickable in terminals
- Make URLs clickable in Claude Code session terminals

### Changes

- Update package-lock.json to add peer dependencies for several packages
- Clean up CHANGELOG.md by removing old versions

## [0.2.17] - 2026-03-28

### Features

- P2P session sharing via WebRTC
- CLI launcher for npm global install (npm i -g vibeyard)
- MacOS Intel (x64) builds alongside ARM64
- Middle-click to close session tabs
- Right-click context menu to project items in sidebar
- Debug mode preference toggle and gate dev-only UI behind it
- Copy internal ID option to session tab context menu
- Hook event name to debug panel hookStatus output
- Cmd+Click to open terminal URLs in default browser
- What's New dialog on startup after app update

### Fixes

- Auto-focus terminal when creating new session via + button
- Session status stuck on waiting after interrupt by passing hookName to setHookStatus
- Diff viewer badge showing raw "working" instead of "Changes"

### Changes

- Sessions menu from menu bar, keep shortcuts as hidden items
- Session status 'permission' to 'input' for broader user-input semantics
- Session activity staleness timeout

## [0.2.12] - 2026-03-26

### Features
- File system watcher for real-time git panel updates
- Current model name to session status line
- GitHub stars badge and star CTA to README

### Fixes
- Session terminal stealing focus from project terminal panel
- Tab rename losing focus when other sessions update

### Changes
- Update failure notification banner

## [0.2.11] - 2026-03-24

### Features
- Demo GIF to README
- Smarter tool failure classification (not-found, permission-denied, auth-required)
- Confirmation warning when removing a project with session history
- Real-time config panel updates via file watching
- Hover action icons for git panel file items
- Desktop notifications when background sessions need attention
- Planning guidance to check for preferences configurability

### Fixes
- Sidebar flickering from config watcher and readiness rescan
- AI Readiness modal resizing when expanding category items

### Changes
- Rescan AI Readiness on startup and project switch
- .cursorrules, AGENTS.md, and copilot-instructions checks from AI Readiness
- Native statusLine conflict dialog with in-app modal

## [0.2.10] - 2026-03-23

### Features
- Per-hook status breakdown to preferences setup section
- MCP server management to config sections sidebar
- Session bookmark feature to history panel
- Setup section and GitHub links to preferences modal
- Settings guard for Claude Code statusLine and hooks configuration
- Right-click context menu for git panel files
- Files field to package.json for npm publishing

### Fixes
- Bookmark and delete targeting wrong history entry after /clear
- History list jumping to top on bookmark or delete
- Swarm session order not preserved when toggling modes
- Swarm empty cells persisting after disabling swarm mode
- Auto session naming extracting prompt text instead of title

### Changes
- Remove deprecated CLAUDE_CODE_STATUSLINE references
- Update README to be concise and marketing-focused

## [0.2.9] - 2026-03-22

### Fixes
- Add picomatch to production dependencies for release builds

## [0.2.8] - 2026-03-22

### Features
- MacOS code signing and notarization for CI builds
- Logo and shields.io badges to README
- App icon for all platforms
- Auto-open new project modal when app starts with no projects
- Max character limit for session title names
- Tests for toolfailure file handling and detector edge cases
- Missing tool detection alerts via PostToolUseFailure hooks
- Dimmed empty cell with new session button in swarm mode grid
- Side panel for non-CLI tabs in swarm mode
- Sidebar toggle when clicking the active project
- Unread border indicator for swarm mode panes
- Swarm mode to display all sessions simultaneously in a grid

### Fixes
- Empty sessions being saved to history on close
- Swarm mode not showing sessions resumed from history
- Swarm mode grid order not persisting across restarts

### Changes
- README logo to transparent background version
- SoundOnSessionWaiting default to enabled
- Rename app from CCIDE to Vibeyard
- Expand missing tool catalog and remove hardcoded install instructions
- README with swarm mode and missing tool alerts features
- Default layout mode to swarm for new projects
- Allow swarm mode with a single session

## [0.2.7] - 2026-03-22

### Features
- Copy session ID option to tab context menu
- Auto-naming sessions from CLI conversation title
- Collapsible sidebar with toggle button and Cmd+B shortcut
- Cmd+F search in file-reader and diff-viewer panes
- Cmd+Click requirement to open files from terminal links
- .vibeyardignore for AI readiness large-file scan exclusions
- AI readiness scanner with auto-created .vibeyardignore for large-file exclusions
- Default args per project with checkbox to persist across sessions
- Insights preferences toggle and fix-in-new-session CTA button
- Big initial context alert when pre-context exceeds 15% of context window
- Cost and context window persistence across app restarts
- Usage stats modal reading Claude Code's stats-cache.json
- Preference to disable session history archiving

### Fixes
- Cost details text overlapping labels in help modal
- Empty gap between terminal and debug panel
- Session stuck on working state after Escape interrupt
- Waiting status description in help modal to be more accurate
- Fs:readFile blocking config files outside project directories
- Git panel flickering: debounce refreshes, in-place DOM updates, skip redundant rebuilds
- Use statusLine setting instead of deprecated CLAUDE_CODE_STATUSLINE env var for cost/context data
- Status bar reliability: handle macOS fs.watch null filename, add polling fallback, fix context window field names
- Tab drag reorder and add move left/right context menu options

### Changes
- Remove ptyData logging from debug panel for better performance
- Remove red focus stroke from terminal panes
- Remove stale scan badge from AI Readiness section
- Update theme background colors to black
- Update README with AI Readiness Score feature
- Improve git polling to pause when app is inactive or no project is open
- Update README with recent features and remove Linux installation section
- Update wide modal width from 700px to 850px max-width

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
