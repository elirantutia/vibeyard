import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    alias: {
      // CI installs with ELECTRON_SKIP_BINARY_DOWNLOAD=1, so importing the real
      // `electron` module throws ("Electron failed to install correctly").
      // Redirect it to a test stub for suites that transitively load a module
      // which value-imports from 'electron' (e.g. hook-status.ts).
      electron: fileURLToPath(new URL('./test/electron-stub.ts', import.meta.url)),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      include: [
        'src/main/**/*.ts',
        'src/renderer/**/*.ts',
      ],
      exclude: [
        'src/main/main.ts',
        'src/main/ipc-handlers.ts',
        'src/main/mcp-ipc-handlers.ts',
        'src/main/menu.ts',
        'src/main/mcp-client.ts',
        'src/renderer/index.ts',
        'src/renderer/components/**',
        'src/renderer/keybindings.ts',
        'src/renderer/notification-sound.ts',
        'src/renderer/git-status.ts',
        'src/preload/**',
      ],
    },
  },
});
