#!/usr/bin/env node
// Standalone Electron installer — uses system unzip (extract-zip has a bug
// silently failing to extract Electron.app's Frameworks on some Node/macOS combos)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { downloadArtifact } = require('@electron/get');

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
const pkg = require(path.join(electronDir, 'package.json'));
const version = pkg.version;
const platform = process.env.npm_config_platform || process.platform;
const arch = process.env.npm_config_arch || process.arch;

console.log(`[fix-electron] target: ${version} / ${platform}-${arch}`);

const distDir = path.join(electronDir, 'dist');
if (fs.existsSync(distDir)) {
  console.log('[fix-electron] removing existing dist/');
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

const platformPath = (() => {
  switch (platform) {
    case 'mas':
    case 'darwin': return 'Electron.app/Contents/MacOS/Electron';
    case 'linux':
    case 'freebsd':
    case 'openbsd': return 'electron';
    case 'win32': return 'electron.exe';
    default: throw new Error('unknown platform: ' + platform);
  }
})();

(async () => {
  try {
    const zipPath = await downloadArtifact({
      version,
      artifactName: 'electron',
      platform,
      arch,
      force: process.env.force_no_cache === 'true',
    });
    const zipMb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
    console.log(`[fix-electron] downloaded zip: ${zipPath} (${zipMb} MB)`);

    console.log('[fix-electron] extracting via system unzip (extract-zip is broken for this zip)...');
    const start = Date.now();
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', distDir], { stdio: 'inherit' });
    console.log(`[fix-electron] extracted in ${((Date.now() - start) / 1000).toFixed(1)}s`);

    fs.writeFileSync(path.join(electronDir, 'path.txt'), platformPath);
    console.log(`[fix-electron] wrote path.txt -> ${platformPath}`);

    // Move electron.d.ts up one level (matches install.js behavior)
    const srcTypeDef = path.join(distDir, 'electron.d.ts');
    if (fs.existsSync(srcTypeDef)) {
      fs.renameSync(srcTypeDef, path.join(electronDir, 'electron.d.ts'));
    }

    const binPath = path.join(distDir, platformPath);
    if (!fs.existsSync(binPath)) {
      throw new Error(`binary missing after extract: ${binPath}`);
    }
    console.log(`[fix-electron] ✅ binary verified at ${binPath}`);
    console.log(`[fix-electron] ✅ dist size: ${(execFileSync('du', ['-sh', distDir]).toString().split('\t')[0]).trim()}`);
  } catch (err) {
    console.error('[fix-electron] ❌ FAILED:', err && err.message || err);
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  }
})();