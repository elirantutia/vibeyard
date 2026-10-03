# UI conventions

Use the existing renderer components, CSS theme variables, modal manager and custom controls. Avoid native `<select>` elements and hard-coded colors. The project overview uses Gridstack and persists `ProjectRecord.overviewLayout` per project. Widget factories are registered in `src/renderer/components/project-tab/widgets/widget-registry.ts`, including readiness, provider tools, GitHub PRs/issues, team, Kanban, sessions, favorites, usage stats and top files by tokens.

Open file reader tabs through `openFileReaderChecked` so a missing file does not leave a stale tab. Rendered Markdown links are intercepted to prevent navigation away from the Electron app document. `src/renderer/i18n.ts` handles English and Chinese with English fallback; only the supported UI areas are translated today.

When planning a new feature, consider whether a Preferences setting is useful. Update tests and these contracts when adding a component, widget or lifecycle behavior.

File-reader previews render bounded pages (2,000 lines / 128 Ki characters) rather than a DOM for the entire file. The partial-preview notice explains that search covers the displayed page and long lines may be truncated. Previous/Next and go-to-line navigate the source without splitting every line into a retained array. Both raw and rendered Markdown use the same page budget. Untracked Git diff previews reject inputs over 256 KiB, over 5,000 lines, or containing NUL bytes, with an explanatory message.

See [performance and resource limits](performance.md) for the current user-facing limits. Preview search is page-local; navigation resets search decorations. Bounded rendered Markdown may end inside a block at a page boundary.
