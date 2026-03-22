<p align="center">
  <img src="build/vibeyard-black.png" alt="Vibeyard" width="128" />
</p>

<h1 align="center">Vibeyard</h1>

<p align="center">
  <a href="https://github.com/elirantutia/vibeyard/releases"><img src="https://img.shields.io/github/v/release/elirantutia/vibeyard" alt="GitHub Release" /></a>
  <a href="https://github.com/elirantutia/vibeyard/blob/main/LICENSE"><img src="https://img.shields.io/github/license/elirantutia/vibeyard" alt="License" /></a>
  <a href="https://github.com/elirantutia/vibeyard/issues"><img src="https://img.shields.io/github/issues/elirantutia/vibeyard" alt="Issues" /></a>
  <a href="https://github.com/elirantutia/vibeyard/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs Welcome" /></a>
</p>

<p align="center">
  <strong>The IDE built for AI coding agents.</strong><br/>
  Manage multiple agent sessions, run them in parallel, track costs, and never lose context — starting with Claude Code.
</p>

---

## Why Vibeyard?

Running AI coding agents in a bare terminal gets messy fast. Vibeyard gives you a proper workspace — multi-session management, split panes, swarm mode, cost tracking, and session resume — so you can focus on building, not juggling terminals.

## Highlights

- **Multi-session management** — run multiple agent sessions per project, each in its own PTY
- **Swarm mode** — grid view of all sessions at once, spin up new ones with `Cmd+\`
- **Cost & context tracking** — real-time spend, token usage, and context window monitoring per session
- **AI Readiness Score** — see how well-prepared your project is for AI-assisted coding, with one-click fixes
- **Session resume** — pick up where you left off, even after restarting the app
- **Smart alerts** — detects missing tools, context bloat, and session health issues
- **Keyboard-driven** — full shortcut support, built for speed

> Built for Claude Code today. More AI CLI providers coming soon.

## Install

### macOS

Download the latest `.dmg` from [GitHub Releases](https://github.com/elirantutia/vibeyard/releases), drag to Applications, and launch. Signed and notarized by Apple.

Requires [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated.

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
  <sub>Vibeyard is an independent project and is not affiliated with or endorsed by Anthropic.</sub>
</p>
