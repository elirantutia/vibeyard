#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  mkdirp(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  mkdirp(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist', 'renderer');

mkdirp(dist);

copyFile(path.join(root, 'src', 'renderer', 'index.html'), path.join(dist, 'index.html'));
copyFile(path.join(root, 'src', 'renderer', 'styles.css'), path.join(dist, 'styles.css'));

// Remove old styles dir and copy fresh
copyDir(path.join(root, 'src', 'renderer', 'styles'), path.join(dist, 'styles'));

copyFile(
  path.join(root, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css'),
  path.join(dist, 'xterm.css')
);
copyFile(path.join(root, 'build', 'icon.png'), path.join(dist, 'icon.png'));
copyFile(path.join(root, 'CHANGELOG.md'), path.join(dist, 'CHANGELOG.md'));

copyDir(
  path.join(root, 'src', 'renderer', 'assets', 'providers'),
  path.join(dist, 'assets', 'providers')
);

console.log('Assets copied.');
