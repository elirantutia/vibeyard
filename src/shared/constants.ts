/** Glob patterns for files to exclude from large-file scanning (readiness checks). */
export const DEFAULT_SCAN_IGNORE = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Gemfile.lock',
  'Cargo.lock',
  'composer.lock',
  'poetry.lock',
  'go.sum',
  'Pipfile.lock',
  '*.min.js',
  '*.min.css',
  '*.bundle.js',
  '*.generated.*',
];

/** Directories to exclude from large-file alerts (never worth splitting). */
export const EXCLUDED_DIRECTORIES = [
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
];

/** Extra glob patterns to exclude from large-file alerts (beyond DEFAULT_SCAN_IGNORE). */
export const EXTRA_ALERT_IGNORE = [
  '*.map',
  '*.wasm',
  '*.pb',
  '*.bundle.*',
];
