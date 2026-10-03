// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../state.js', () => ({
  appState: { projects: [], on: () => () => {} },
}));
vi.mock('../../../github-unread.js', () => ({
  ingestItems: vi.fn(), isUnread: () => false, makeItemId: vi.fn(),
  markRead: vi.fn(), markAllReadInProject: vi.fn(),
}));

import { createGithubPRsWidget } from './github-widgets';
import type { WidgetHost } from './widget-host';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

describe('GitHub widget refresh ordering', () => {
  it('does not display an older error after a newer successful fetch', async () => {
    const first = deferred<{ ok: boolean; error?: string; items?: [] }>();
    const second = deferred<{ ok: boolean; error?: string; items?: [] }>();
    const listPRs = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    Object.assign(window, {
      vibeyard: { github: { isAvailable: async () => true, listPRs } },
    });
    const host = {
      projectId: 'p1', widgetId: 'w1', widgetType: 'github-prs',
      getConfig: () => ({ repo: 'owner/repo' }),
      setConfig: vi.fn(), openSettings: vi.fn(), requestRefresh: vi.fn(),
    } as WidgetHost;
    const widget = createGithubPRsWidget(host);
    await vi.waitFor(() => expect(listPRs).toHaveBeenCalledTimes(1));
    widget.refresh?.();
    await vi.waitFor(() => expect(listPRs).toHaveBeenCalledTimes(2));
    second.resolve({ ok: true, items: [] });
    await vi.waitFor(() => expect(widget.element.textContent).toContain('No pull requests'));
    first.resolve({ ok: false, error: 'stale network error' });
    await Promise.resolve();
    expect(widget.element.textContent).not.toContain('stale network error');
    widget.destroy();
  });
});
