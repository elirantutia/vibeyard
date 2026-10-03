<p align="center">
  <img src="build/vibeyard-black.png" alt="Vibeyard" width="128" />
</p>

<h1 align="center">Vibeyard</h1>

<p align="center">
  <a href="https://github.com/elirantutia/vibeyard/releases"><img src="https://img.shields.io/github/v/release/elirantutia/vibeyard" alt="GitHub Release" /></a>
  <a href="https://github.com/elirantutia/vibeyard/blob/main/LICENSE"><img src="https://img.shields.io/github/license/elirantutia/vibeyard" alt="License" /></a>
  <a href="https://github.com/elirantutia/vibeyard/issues"><img src="https://img.shields.io/github/issues/elirantutia/vibeyard" alt="Issues" /></a>
  <a href="https://github.com/elirantutia/vibeyard/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs Welcome" /></a>
  <a href="https://star-history.com/#elirantutia/vibeyard&Date"><img src="https://img.shields.io/github/stars/elirantutia/vibeyard?style=social" alt="GitHub Stars" /></a>
  <a href="https://x.com/EliranTutia"><img src="https://img.shields.io/badge/Follow-%40EliranTutia-black?logo=x" alt="Follow on X" /></a>
</p>

<p align="center">
  <strong>The IDE built for AI coding agents.</strong><br/>
  Manage multiple agent sessions, run them in parallel, track costs, and never lose context — with Claude Code, Codex CLI, GitHub Copilot, Gemini CLI, Pi, and Oh my Pi.
</p>

---

<p align="center">
  <img src="assets/vibyard_720.gif" alt="Vibeyard Demo" width="800" />
</p>

<p align="center">
  <img src="assets/web-ui-short.gif" alt="Vibeyard UI Edit Demo" width="800" />
</p>

<p align="center">
  <img src="assets/kanban.gif" alt="Vibeyard Kanban Board Demo" width="800" />
</p>

## Why Vibeyard?

Running AI coding agents in a bare terminal gets messy fast. Vibeyard gives you a proper workspace — a customizable project dashboard, a kanban task board, multi-session management, split panes, swarm mode, cost tracking, and session resume — so you can focus on building, not juggling terminals.

## Highlights

- **Customizable project overview** — drag-and-drop dashboard per project with widgets for AI Readiness, Kanban, Team, Sessions, Provider Tools, and live GitHub PRs/Issues — pick what matters and arrange it your way
- **Kanban task board** — plan work on a per-project board with drag-and-drop, search, and tag filtering; each card can spawn or resume a CLI session in one click, and tasks auto-move to Done when their session completes
- **P2P session sharing** — share live terminal sessions over encrypted peer-to-peer connections (WebRTC), with read-only or read-write modes and a generated share key
- **Multi-session management** — run multiple agent sessions per project, each in its own PTY; use swarm mode for a grid view of all sessions at once and spin up new ones with `Cmd+\`
- **Multiple profiles per coding tool** — run separate logins side by side (e.g. work and personal licenses) for any profile-capable CLI — Claude Code, Pi, and Oh my Pi today — each session backed by its own isolated config directory so credentials, settings, and history never mix. Pick a profile per session, per project, or set a default per tool
- **Cost & context tracking** — real-time spend, token usage, and context window monitoring per session (Claude Code)
- **Session inspector** — real-time session telemetry with timeline, cost breakdown, tool usage stats, and context window monitoring (`Cmd+Shift+I`); the fullest detail comes from Claude Code, other backends report what they expose
- **AI Readiness Score** — see how well-prepared your project is for AI-assisted coding, with one-click fixes
- **Session resume** — pick up where you left off, even after restarting the app
- **Light and dark themes** — switch the app appearance from Preferences, including live re-theming of open terminals
- **Smart alerts** — detects missing tools, context bloat, and session health issues
- **Session status indicators** — a typographic glyph on each tab shows real-time session state (`…` working, `?` your turn, `✓` completed, `·` idle), with optional desktop notifications
- **Embedded browser tab** — open any URL (e.g. `localhost:3000`) in a session tab, toggle element inspection to click any DOM element, and send AI editing instructions with the exact selector, text content, and page URL as context
- **Keyboard-driven** — full shortcut support, built for speed

> Supports six AI CLI backends: Claude Code, OpenAI Codex CLI, GitHub Copilot, Gemini CLI, Pi, and Oh my Pi. More coming soon.

## Install

Requires at least one supported CLI installed and authenticated: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [OpenAI Codex CLI](https://github.com/openai/codex), [GitHub Copilot](https://github.com/github/copilot-cli), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent), or Oh my Pi (`omp`).

### macOS

Download the latest `.dmg` from [GitHub Releases](https://github.com/elirantutia/vibeyard/releases), drag to Applications, and launch. The release workflow is configured for signing and notarization; verify the signature of the specific download before relying on it.

### Linux

Download the latest `.deb` (Debian/Ubuntu) or `.AppImage` (universal) from [GitHub Releases](https://github.com/elirantutia/vibeyard/releases).

```bash
# Debian/Ubuntu
sudo dpkg -i Vibeyard-*.deb

# AppImage
chmod +x Vibeyard-*.AppImage
./Vibeyard-*.AppImage
```

### Windows

Download the latest Setup `.exe` (NSIS installer) or portable `.exe` from [GitHub Releases](https://github.com/elirantutia/vibeyard/releases). Run the installer and launch Vibeyard from the Start menu, or run the portable build directly.

### npm (macOS, Linux & Windows)

```bash
npm i -g vibeyard
vibeyard
```

On first run, the launcher downloads the packaged app for the current npm package version and starts it. Linux uses the x64 AppImage release asset. A matching release asset must exist for the package version.

### Build from Source

```bash
git clone https://github.com/elirantutia/vibeyard.git
cd vibeyard
npm install && npm start
```

Source builds require Node v24+ (see `.nvmrc`). The published npm launcher accepts Node 18+ because it downloads a packaged app rather than building Electron from source.

## Search and preview limits

In the current source build, large text and Markdown files use bounded preview pages. Find searches only the displayed page; use Previous/Next or raw-view go-to-line to move through the file. Untracked Git diffs over 256 KiB or 5,000 lines show a size-limit message. Session search reuses a local derived index, and the inspector keeps bounded recent history. See [performance and resource limits](docs/performance.md) for exact limits, cache location and rebuild instructions. These changes have not been verified in a published package.

## Contributing

PRs welcome! See the [Contributing Guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)

---

<p align="center">
  <a href="https://github.com/elirantutia/vibeyard"><img src="https://img.shields.io/badge/Star%20Vibeyard%20on%20GitHub-%E2%AD%90-yellow?style=for-the-badge&logo=github" alt="Star on GitHub" /></a>
</p>

<p align="center">
  If Vibeyard helps your workflow, a star helps us grow. Thanks for the support!
</p>

<p align="center">
  <sub>Vibeyard is an independent project and is not affiliated with or endorsed by Anthropic.</sub>
</p>
