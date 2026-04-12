import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderId, CliProviderMeta } from '../../shared/types.js';

const mockState = vi.hoisted(() => ({
  activeProject: { id: 'p1', path: '/project', sessions: [] },
  on: vi.fn(() => () => {}),
  preferences: { sidebarViews: { configSections: true } },
}));

const mockAvailability = vi.hoisted(() => ({
  snapshot: null as { providers: CliProviderMeta[]; availability: Map<ProviderId, boolean> } | null,
}));

vi.mock('../state.js', () => ({
  appState: mockState,
}));

vi.mock('./mcp-add-modal.js', () => ({
  showMcpAddModal: vi.fn(),
}));

vi.mock('../provider-availability.js', () => ({
  getProviderAvailabilitySnapshot: () => mockAvailability.snapshot,
  getAvailableProviderMetas: () => {
    const snap = mockAvailability.snapshot;
    if (!snap) return [];
    return snap.providers.filter(p => snap.availability.get(p.id));
  },
  getProviderDisplayName: (id: ProviderId) => id,
  loadProviderAvailability: vi.fn(async () => {}),
}));

function setAvailable(ids: ProviderId[]): void {
  mockAvailability.snapshot = {
    providers: ids.map(id => ({ id, displayName: id } as CliProviderMeta)),
    availability: new Map(ids.map(id => [id, true])),
  };
}

describe('getActiveConfigProviderId', () => {
  beforeEach(() => {
    vi.resetModules();
    mockAvailability.snapshot = null;
  });

  it('returns the only available provider', async () => {
    setAvailable(['codex']);
    const { getActiveConfigProviderId } = await import('./config-sections.js');
    expect(getActiveConfigProviderId('p1')).toBe('codex');
  });

  it('returns the first available provider when no selection is stored', async () => {
    setAvailable(['claude', 'codex']);
    const { getActiveConfigProviderId } = await import('./config-sections.js');
    expect(getActiveConfigProviderId('p1')).toBe('claude');
  });

  it('falls back to first available when the previously-shown provider becomes unavailable', async () => {
    setAvailable(['claude', 'codex']);
    const { getActiveConfigProviderId } = await import('./config-sections.js');
    expect(getActiveConfigProviderId('p1')).toBe('claude');
    setAvailable(['codex']);
    expect(getActiveConfigProviderId('p1')).toBe('codex');
  });

  it('defaults to claude when snapshot is not loaded', async () => {
    const { getActiveConfigProviderId } = await import('./config-sections.js');
    expect(getActiveConfigProviderId('p1')).toBe('claude');
  });
});
