import * as path from 'path';
import * as os from 'os';
import { fileExists, readDirSafe, readFileSafe, dirExists } from '../fs-utils';
import { isWin } from '../platform';

function nvmDir(): string {
  return process.env.NVM_DIR || path.join(os.homedir(), '.nvm');
}

function nvmVersionsDir(): string {
  return path.join(nvmDir(), 'versions', 'node');
}

function nvmDefaultVersion(): string | null {
  const contents = readFileSafe(path.join(nvmDir(), 'alias', 'default'));
  return contents ? contents.trim() || null : null;
}

function* iterateNvmVersionBins(): Generator<string> {
  if (isWin) return;
  const versionsDir = nvmVersionsDir();
  if (!dirExists(versionsDir)) return;

  const seen = new Set<string>();
  const yieldBin = function* (version: string): Generator<string> {
    if (seen.has(version)) return;
    seen.add(version);
    yield path.join(versionsDir, version, 'bin');
  };

  const defaultVersion = nvmDefaultVersion();
  if (defaultVersion) yield* yieldBin(defaultVersion);
  for (const entry of readDirSafe(versionsDir)) yield* yieldBin(entry);
}

export function findBinaryInNvm(binaryName: string): string | null {
  for (const binDir of iterateNvmVersionBins()) {
    const candidate = path.join(binDir, binaryName);
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

export function nvmDefaultNodeBinDir(): string | null {
  for (const binDir of iterateNvmVersionBins()) {
    if (dirExists(binDir)) return binDir;
  }
  return null;
}
