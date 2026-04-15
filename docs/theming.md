# Theming Guide

Vibeyard supports **dark** and **light** themes, switchable via the Preferences modal. This guide explains the CSS variable system and how to contribute theme-aware code.

## Architecture

Themes are implemented with CSS custom properties scoped to a `data-theme` attribute on `<html>`:

```html
<html data-theme="dark">  <!-- or "light" -->
```

All color/style values use CSS variables defined in `src/renderer/styles/base.css`. The app sets `data-theme` on startup from the persisted preference and updates it when the user changes themes.

## CSS Variable Reference

| Variable | Purpose | Dark | Light |
|---|---|---|---|
| `--bg-primary` | Main background | `#000000` | `#fafaf8` |
| `--bg-secondary` | Secondary surfaces | `#0a0a0a` | `#f0efe9` |
| `--bg-tertiary` | Tertiary surfaces / cards | `#1a1a1a` | `#e4e3dd` |
| `--bg-hover` | Hover states | `#222222` | `#d8d7d1` |
| `--text-primary` | Primary text | `#e0e0e0` | `#2c2c2c` |
| `--text-secondary` | Secondary/subtle text | `#a0a0b0` | `#6e6d68` |
| `--text-muted` | Muted/disabled text | `#606070` | `#a0a098` |
| `--accent` | Primary accent (pink) | `#e94560` | `#e94560` |
| `--accent-dim` | Dimmed accent | `#c73e55` | `#c73e55` |
| `--border` | Borders and dividers | `#333333` | `#d8d6d0` |
| `--tab-active` | Active tab background | `#000000` | `#fafaf8` |
| `--tab-inactive` | Inactive tab background | `#0a0a0a` | `#f0efe9` |
| `--color-warning` | Warning yellow | `#f4b400` | `#f4b400` |
| `--bookmark` | Bookmark color | `#e8a317` | `#e8a317` |

## Terminal (xterm.js) Themes

Terminal color schemes are defined in `src/renderer/terminal-theme.ts`. The file exports:

- `darkTerminalTheme` — for dark mode
- `lightTerminalTheme` — for light mode
- `getTerminalTheme(theme)` — returns the right theme based on `'dark' | 'light'`

When the user changes the app theme, all open terminals are re-themed by calling `xterm.options.theme = getTerminalTheme(newTheme)`.

## Contributing Theme-Aware Code

### DO
- Always use CSS variables for colors: `color: var(--text-primary)`
- Use `var(--bg-secondary)` for card/panel backgrounds
- Use `var(--border)` for all borders
- Use `var(--accent)` for interactive highlights
- Use `var(--color-warning)` for yellow warning indicators

### DON'T
- **Never** hardcode color hex values in CSS: ~~`color: #e0e0e0`~~
- **Never** hardcode colors in TypeScript/JavaScript inline styles
- **Never** add new hardcoded xterm theme objects — use `getTerminalTheme()` from `terminal-theme.ts`

### Adding a New CSS Variable

1. Add it to `src/renderer/styles/base.css` in all three blocks: `:root`, `[data-theme="dark"]`, and `[data-theme="light"]`
2. Document it in the table above
3. Test in both themes before submitting a PR

## Testing Themes

1. Launch the app: `npm start`
2. Open Preferences (gear icon or `Cmd/Ctrl+,`)
3. Toggle between **Dark** and **Light** in the General section
4. Verify your UI change looks correct in both themes
5. Pay attention to contrast ratios — text should be clearly readable

## Palette Notes

The light theme uses a warm neutral palette (off-white backgrounds, warm grays) rather than pure white, for a softer appearance. The pink/magenta accent (`#e94560`) works on both dark and light backgrounds.
