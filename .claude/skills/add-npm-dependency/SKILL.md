---
name: add-npm-dependency
description: This skill MUST be used whenever the task involves adding, installing, or upgrading an npm package/library/dependency in this project. Use when the user asks to "add a library", "install <package>", "use <package>", "add a dependency", "bump/upgrade a package", or any change to package.json dependencies. Covers the latest-version policy, esbuild renderer bundling, manual CSS copy, native module rebuilds, and the three build targets.
---

# Adding an npm Library

This is an Electron app with **three separate build targets** (main, preload, renderer) and a few non-obvious bundling rules. Adding a dependency the wrong way silently breaks CSS, native modules, or the renderer bundle. Follow this guide every time.

## Golden Rule: install the latest, caret-pinned

**Always install the newest published version. Never hand-edit `package.json` to set or downgrade a version.**

```bash
npm install <pkg>@latest          # runtime dependency
npm install -D <pkg>@latest       # dev / build-only tool (types, bundlers, test libs)
```

- This records a caret range `^x.y.z` — the repo convention (every dep in `package.json` uses `^`). Leave it as a caret range.
- `package-lock.json` is committed and gets updated by the install. **Both `package.json` and `package-lock.json` are part of your change** — stage both.
- Use **npm only** (the lockfile is `package-lock.json` — not yarn, not pnpm).
- Node **v24** is pinned in `.nvmrc`; `engines.node` is `>=18`. Run `nvm use` first if needed.

## Step 1 — Decide which build target consumes the package

This determines every gotcha that follows.

| Target | Source dirs | How it's built | What's allowed |
|--------|-------------|----------------|----------------|
| **Renderer** | `src/renderer/**` | Bundled by **esbuild** into one IIFE (`build:renderer`) | Plain JS/TS deps only. **No Node built-ins, no native modules.** |
| **Main** | `src/main/**`, `src/shared/**` | `tsc` → CommonJS (`dist/main/`) | Any Node dep, including native modules. Resolved via `require` at runtime against `node_modules` — **not bundled**. |
| **Preload** | `src/preload/**`, `src/shared/**` | `tsc` → CommonJS (`dist/preload/`) | Runs in Node/Electron context; same rules as main. |

- A pure JS/TS library used in the UI (like `marked`, `dompurify`, `gridstack`, `@xterm/*`) just gets `import`ed in renderer code and esbuild bundles it. Nothing else to do (except CSS — see Step 2).
- A library that touches the filesystem, spawns processes, or has a `.node` binary belongs in **main/preload only**.

## Step 2 — CSS / static assets gotcha (esbuild has NO CSS loader)

esbuild only has the `.ts` loader configured. **It will not bundle any CSS the package ships.** If the library needs a stylesheet to work (the way `gridstack` and `@xterm/xterm` do):

1. Add a copy step in `scripts/copy-assets.js` — copy from `node_modules/<pkg>/.../file.css` to `dist/renderer/vendor/<file>.css`. Mirror the existing **gridstack** precedent in that file.
2. Add a `<link rel="stylesheet" href="vendor/<file>.css">` to `src/renderer/index.html` (gridstack/xterm links are already there as examples).

If you skip this, the JS bundles fine but the component renders unstyled. (CLAUDE.md documents this: "esbuild has no CSS loader" — gridstack CSS is copied manually.)

## Step 3 — Native module gotcha (`.node` binaries)

Examples already in the repo: `better-sqlite3`, `node-pty`.

- Must be a regular `dependency` (never imported from the renderer — main/preload only).
- `npm install` triggers the `postinstall` hook → `electron-builder install-app-deps`, which rebuilds the `.node` binary against the **pinned Electron ABI**. If the module fails to load at runtime ("NODE_MODULE_VERSION mismatch"), re-run `npm install` and check the postinstall output.
- If the binary can't load from inside the asar archive, add the package to electron-builder's `asarUnpack` in `package.json` (precedent: `**/node_modules/better-sqlite3/**`).
- Native modules must compile on **macOS, Linux, and Windows** — CI builds all three. Flag the cross-platform risk to the user; see `src/main/platform.ts` for the platform-detection helpers.

## Step 4 — Types

- If the package ships its own type declarations, you're done.
- Otherwise add the community types as a devDependency: `npm install -D @types/<pkg>@latest` (precedent: `@types/better-sqlite3`, `@types/dompurify`, `@types/picomatch`).

## Step 5 — Verify (required, not optional)

There is **no hot reload** — every change needs a rebuild.

```bash
npm run build    # must pass: tsc main + tsc preload + esbuild renderer + copy-assets
npm test         # Vitest suite
```

Then confirm the dependency actually works end to end:
- **Renderer / UI / CSS dep:** `npm start`, and visually confirm the feature renders and styles load.
- **Native / main dep:** launch the app and exercise the feature that uses it.

## Step 6 — Packaging sanity check

electron-builder packages only `dist/main/**`, `dist/preload/**`, `dist/renderer/**`:
- Renderer deps are safe — they're bundled into `dist/renderer/index.js`.
- Main/preload deps resolve from the packaged production `node_modules` at runtime, so they must be in `dependencies` (not `devDependencies`). Keep build-only tooling (bundlers, types, test libs) in `devDependencies`.

## Do / Don't

**Do:**
- `npm install <pkg>@latest`, leave the caret range, commit `package.json` + `package-lock.json`.
- Pick the right target (renderer vs main/preload) before importing.
- Add the CSS copy step + `<link>` for any styled renderer library.
- Run `npm run build` and `npm test` before declaring done.

**Don't:**
- Pin an exact version or hand-edit a version in `package.json`.
- Import Node built-ins or native modules from the renderer.
- Forget the `scripts/copy-assets.js` step for CSS (esbuild won't bundle it).
- Put a native module in `devDependencies` or assume it works without the postinstall rebuild.

$ARGUMENTS
