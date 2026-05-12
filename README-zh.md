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
  <strong>专为 AI 编码代理构建的 IDE。</strong><br/>
  管理多个代理会话、并行运行、跟踪成本，并且永不丢失上下文——支持 Claude Code、Codex CLI 和 Gemini CLI。
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

## 为什么选择 Vibeyard？

在裸终端中运行 AI 编码代理很快就会变得混乱。Vibeyard 给你一个 proper 工作区——可自定义的项目仪表板、看板任务板、多会话管理、分屏窗格、群集模式、成本跟踪和会话恢复——让你专注于构建，而不是在终端之间来回切换。

## 亮点

- **可自定义的项目概览** — 每个项目的拖放仪表板，包含 AI 就绪度、看板、团队、会话、提供商工具和实时 GitHub PR/Issues 的小部件——选择重要的并按你的方式排列
- **看板任务板** — 在每个项目的板上规划工作，支持拖放、搜索和标签过滤；每个卡片可以一键启动或恢复 CLI 会话，任务在会话完成时自动移动到"完成"
- **P2P 会话共享** — 通过加密的点对点连接（WebRTC）与队友共享实时终端会话，支持只读或读写模式和基于 PIN 的认证
- **多会话管理** — 每个项目运行多个代理会话，每个都在自己的 PTY 中；使用群集模式一次查看所有会话的网格视图，使用 `Cmd+\` 启动新会话
- **成本和上下文跟踪** — 每个会话的实时支出、token 使用量和上下文窗口监控
- **会话检查器** — 实时会话遥测，包含时间线、成本分解、工具使用统计和上下文窗口监控（`Cmd+Shift+I`）
- **AI 就绪度评分** — 查看你的项目对 AI 辅助编码的准备程度，支持一键修复
- **会话恢复** — 从上次中断的地方继续，即使重启应用后
- **明暗主题** — 从偏好设置切换应用外观，包括打开终端的实时重新主题
- **智能警报** — 检测缺失工具、上下文膨胀和会话健康问题
- **会话状态指示器** — 每个标签页上的彩色点显示实时会话状态（工作中、等待中、需要输入、已完成），支持可选的桌面通知
- **嵌入式浏览器标签** — 在会话标签中打开任何 URL（例如 `localhost:3000`），切换元素检查以点击任何 DOM 元素，并发送带有精确选择器、文本内容和页面 URL 作为上下文的 AI 编辑指令
- **键盘驱动** — 完整的快捷键支持，为速度而生

> 支持 Claude Code、OpenAI Codex CLI 和 Gemini CLI。更多 AI CLI 提供商即将推出。

## 安装

需要至少安装并认证一个支持的 CLI：[Claude Code](https://docs.anthropic.com/en/docs/claude-code)、[OpenAI Codex CLI](https://github.com/openai/codex) 或 [Gemini CLI](https://github.com/google-gemini/gemini-cli)。

### macOS

从 [GitHub Releases](https://github.com/elirantutia/vibeyard/releases) 下载最新的 `.dmg`，拖到 Applications 并启动。由 Apple 签名和公证。

### Linux

从 [GitHub Releases](https://github.com/elirantutia/vibeyard/releases) 下载最新的 `.deb`（Debian/Ubuntu）或 `.AppImage`（通用）。

```bash
# Debian/Ubuntu
sudo dpkg -i vibeyard_*.deb

# AppImage
chmod +x Vibeyard-*.AppImage
./Vibeyard-*.AppImage
```

### Windows

从 [GitHub Releases](https://github.com/elirantutia/vibeyard/releases) 下载最新的 Setup `.exe`（NSIS 安装程序）或便携版 `.exe`。运行安装程序并从开始菜单启动 Vibeyard，或直接运行便携版。

### npm（macOS、Linux 和 Windows）

```bash
npm i -g vibeyard
vibeyard
```

首次运行时，应用会自动下载并启动。无需额外步骤。

### 从源代码构建

```bash
git clone https://github.com/elirantutia/vibeyard.git
cd vibeyard
npm install && npm start
```

需要 Node v24+（参见 `.nvmrc`）。

## 贡献

欢迎 PR！请参阅[贡献指南](CONTRIBUTING.md)和[行为准则](CODE_OF_CONDUCT.md)。

## 许可证

[MIT](LICENSE)

---

<p align="center">
  <a href="https://github.com/elirantutia/vibeyard"><img src="https://img.shields.io/badge/Star%20Vibeyard%20on%20GitHub-%E2%AD%90-yellow?style=for-the-badge&logo=github" alt="Star on GitHub" /></a>
</p>

<p align="center">
  如果 Vibeyard 对你的工作流程有帮助，一个 star 帮助我们成长。感谢支持！
</p>

<p align="center">
  <sub>Vibeyard 是一个独立项目，与 Anthropic 无关或不受其认可。</sub>
</p>
