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
  Manage multiple agent sessions, run them in parallel, track costs, and never lose context — starting with Claude Code.
</p>

---

<p align="center">
  <img src="assets/vibyard_720.gif" alt="Vibeyard Demo" width="800" />
</p>

## Why Vibeyard?

Running AI coding agents in a bare terminal gets messy fast. Vibeyard gives you a proper workspace — multi-session management, split panes, swarm mode, cost tracking, and session resume — so you can focus on building, not juggling terminals.

## Highlights

- **P2P session sharing** — share live terminal sessions with teammates over encrypted peer-to-peer connections (WebRTC), with read-only or read-write modes and PIN-based authentication
- **Multi-session management** — run multiple agent sessions per project, each in its own PTY
- **Swarm mode** — grid view of all sessions at once, spin up new ones with `Cmd+\`
- **Cost & context tracking** — real-time spend, token usage, and context window monitoring per session
- **Session inspector** — real-time session telemetry with timeline, cost breakdown, tool usage stats, and context window monitoring (`Cmd+Shift+I`)
- **AI Readiness Score** — see how well-prepared your project is for AI-assisted coding, with one-click fixes
- **Session resume** — pick up where you left off, even after restarting the app
- **Smart alerts** — detects missing tools, context bloat, and session health issues
- **Session status indicators** — color-coded dots on each tab show real-time session state (working, waiting, input needed, completed), with optional desktop notifications
- **Embedded browser tab** — open any URL (e.g. `localhost:3000`) in a session tab, toggle element inspection to click any DOM element, and send AI editing instructions with the exact selector, text content, and page URL as context
- **Keyboard-driven** — full shortcut support, built for speed

> Built for Claude Code today. More AI CLI providers coming soon.

## Install

Requires [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated.

### macOS

Download the latest `.dmg` from [GitHub Releases](https://github.com/elirantutia/vibeyard/releases), drag to Applications, and launch. Signed and notarized by Apple.

### npm (macOS)

```bash
npm i -g vibeyard
vibeyard
```

On first run, the app is automatically downloaded and launched. No extra steps needed.

### Build from Source

```bash
git clone https://github.com/elirantutia/vibeyard.git
cd vibeyard
npm install && npm start
```

Requires Node v24+ (see `.nvmrc`).

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
