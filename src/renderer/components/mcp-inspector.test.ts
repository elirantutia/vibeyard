// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import {
  createInspectorPane,
  destroyInspectorPane,
  getInspectorInstance,
  disconnectInspector,
} from './mcp-inspector.js';

interface McpApi {
  connect: Mock;
  disconnect: Mock;
  listTools: Mock;
  listResources: Mock;
  listPrompts: Mock;
}

let mcp: McpApi;

function defer(): { promise: Promise<unknown>; resolve: (v: unknown) => void } {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function flush(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

beforeEach(() => {
  mcp = {
    connect: vi.fn(async () => ({ success: true })),
    disconnect: vi.fn(async () => ({ success: true })),
    listTools: vi.fn(async () => ({ success: true, data: [] })),
    listResources: vi.fn(async () => ({ success: true, data: [] })),
    listPrompts: vi.fn(async () => ({ success: true, data: [] })),
  };
  (globalThis as unknown as { window: { vibeyard: { mcp: McpApi } } }).window.vibeyard = { mcp };
  document.body.innerHTML = '';
});

function startConnect(sessionId: string): { done: () => void } {
  createInspectorPane(sessionId);
  const instance = getInspectorInstance(sessionId)!;
  document.body.appendChild(instance.element);
  const pane = instance.element;
  (pane.querySelector('.mcp-url-input') as HTMLInputElement).value = 'http://localhost:3000/mcp';
  const d = defer();
  mcp.connect.mockReturnValue(d.promise);
  (pane.querySelector('.mcp-connect-btn') as HTMLButtonElement).click();
  return { done: d.resolve };
}

describe('mcp-inspector lifecycle', () => {
  it('destroying the pane while connecting requests a disconnect', () => {
    startConnect('s1');
    expect(mcp.connect).toHaveBeenCalledWith('s1', 'http://localhost:3000/mcp');

    destroyInspectorPane('s1');

    expect(mcp.disconnect).toHaveBeenCalledWith('s1');
    expect(getInspectorInstance('s1')).toBeUndefined();
  });

  it('ignores a connect completion after the pane was destroyed', async () => {
    const { done } = startConnect('s1');
    destroyInspectorPane('s1');

    done({ success: true });
    await flush();

    expect(getInspectorInstance('s1')).toBeUndefined();
  });

  it('disconnectInspector requests a disconnect even while connecting', async () => {
    startConnect('s1');

    await disconnectInspector('s1');

    expect(mcp.disconnect).toHaveBeenCalledWith('s1');
    expect(getInspectorInstance('s1')?.connected).toBe(false);
  });
  it('a stale completion does not flip a recreated pane to connected', async () => {
    const { done } = startConnect('s1');
    destroyInspectorPane('s1');
    createInspectorPane('s1');
    const pane = getInspectorInstance('s1')!.element;
    document.body.appendChild(pane);

    done({ success: true });
    await flush();

    expect(getInspectorInstance('s1')?.connected).toBe(false);
    expect((pane.querySelector('.mcp-connect-btn') as HTMLButtonElement).textContent).toBe('Connect');
  });

  it('destroy then recreate the same id connects fresh', async () => {
    createInspectorPane('s1');
    destroyInspectorPane('s1');
    expect(mcp.disconnect).toHaveBeenCalledWith('s1');

    const { done } = startConnect('s1');
    done({ success: true });
    await flush();

    expect(getInspectorInstance('s1')?.connected).toBe(true);
  });
});
