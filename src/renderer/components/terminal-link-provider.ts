import type { ILinkProvider, ILink, IBufferRange, Terminal } from '@xterm/xterm';
import { appState } from '../state.js';

// Matches file paths like: src/foo/bar.ts:10-20, ./src/foo.ts:10, src/foo.ts
// Must contain a `/` and end with a file extension
const FILE_PATH_RE = /(?:^|[\s'"(\[{])(\.\/)?((?:[a-zA-Z0-9_@.-]+\/)+[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+)(?::(\d+)(?:-(\d+))?)?/g;

export class FilePathLinkProvider implements ILinkProvider {
  constructor(
    private projectId: string,
    private projectPath: string,
    private terminal: Terminal
  ) {}

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const line = this.terminal.buffer.active.getLine(bufferLineNumber - 1);
    if (!line) {
      callback(undefined);
      return;
    }

    const lineText = line.translateToString(true);
    const links: ILink[] = [];

    FILE_PATH_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FILE_PATH_RE.exec(lineText)) !== null) {
      const prefix = match[0].length - (match[1] || '').length - match[2].length - (match[3] ? `:${match[3]}` : '').length - (match[4] ? `-${match[4]}` : '').length;
      const startX = match.index + prefix + 1; // 1-based
      const fullMatchText = match[0].substring(prefix);
      const endX = startX + fullMatchText.length - 1;

      const filePath = match[2];
      const lineNumber = match[3] ? parseInt(match[3], 10) : undefined;

      const range: IBufferRange = {
        start: { x: startX, y: bufferLineNumber },
        end: { x: endX, y: bufferLineNumber },
      };

      links.push({
        range,
        text: fullMatchText,
        activate: (event: MouseEvent, _text: string) => {
          if (!event.metaKey) return;
          appState.addFileReaderSession(this.projectId, filePath, lineNumber);
        },
      });
    }

    callback(links.length > 0 ? links : undefined);
  }
}

export class UrlLinkProvider implements ILinkProvider {
  constructor(private terminal: Terminal) {}

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const line = this.terminal.buffer.active.getLine(bufferLineNumber - 1);
    if (!line) { callback(undefined); return; }

    const lineText = line.translateToString(true);
    const links: ILink[] = [];

    for (const match of lineText.matchAll(/https?:\/\/\S+/g)) {
      // Strip trailing punctuation that is unlikely to be part of the URL
      const url = match[0].replace(/[.,;:!?()[\]'"]+$/, '');
      const startX = match.index! + 1; // 1-based xterm coordinate
      const endX = startX + url.length - 1;

      links.push({
        range: {
          start: { x: startX, y: bufferLineNumber },
          end: { x: endX, y: bufferLineNumber },
        },
        text: url,
        activate: (event: MouseEvent) => {
          if (!event.metaKey) return;
          window.vibeyard.app.openExternal(url);
        },
      });
    }

    callback(links.length > 0 ? links : undefined);
  }
}

function buildGitHubPrUrl(remoteUrl: string, prNumber: string): string | null {
  const match = remoteUrl.match(/(?:git@github\.com:|https?:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/);
  if (match) return `https://github.com/${match[1]}/pull/${prNumber}`;
  return null;
}

export class PrLinkProvider implements ILinkProvider {
  private static readonly remoteUrlCache = new Map<string, Promise<string | null>>();

  constructor(private projectPath: string, private terminal: Terminal) {}

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const line = this.terminal.buffer.active.getLine(bufferLineNumber - 1);
    if (!line) { callback(undefined); return; }

    const lineText = line.translateToString(true);
    const links: ILink[] = [];

    for (const match of lineText.matchAll(/PR\s+#(\d+)/g)) {
      const fullText = match[0];
      const prNumber = match[1];
      const startX = match.index! + 1; // 1-based xterm coordinate
      const endX = startX + fullText.length - 1;

      links.push({
        range: {
          start: { x: startX, y: bufferLineNumber },
          end: { x: endX, y: bufferLineNumber },
        },
        text: fullText,
        activate: (event: MouseEvent) => {
          if (!event.metaKey) return;
          (async () => {
            if (!PrLinkProvider.remoteUrlCache.has(this.projectPath)) {
              PrLinkProvider.remoteUrlCache.set(this.projectPath, window.vibeyard.git.getRemoteUrl(this.projectPath));
            }
            const remoteUrl = await PrLinkProvider.remoteUrlCache.get(this.projectPath)!;
            if (!remoteUrl) return;
            const prUrl = buildGitHubPrUrl(remoteUrl, prNumber);
            if (prUrl) window.vibeyard.app.openExternal(prUrl);
          })();
        },
      });
    }

    callback(links.length > 0 ? links : undefined);
  }
}
