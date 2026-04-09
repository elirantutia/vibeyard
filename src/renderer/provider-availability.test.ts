import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CliProviderMeta } from '../shared/types.js';

type ProviderModule = typeof import('./provider-availability.js');

const listProviders = vi.fn();
const checkBinary = vi.fn();

beforeEach(() => {
  vi.resetModules();
  listProviders.mockReset();
  checkBinary.mockReset();
  (globalThis as unknown as { window: unknown }).window = {
    vibeyard: {
      provider: { listProviders, checkBinary },
    },
  };
});

async function loadModule(): Promise<ProviderModule> {
  return (await import('./provider-availability.js')) as ProviderModule;
}

const metaClaude: CliProviderMeta = {
  id: 'claude',
  displayName: 'Claude Code',
  capabilities: { hooks: true } as CliProviderMeta['capabilities'],
} as CliProviderMeta;

const metaCodex: CliProviderMeta = {
  id: 'codex',
  displayName: 'Codex',
  capabilities: { hooks: false } as CliProviderMeta['capabilities'],
} as CliProviderMeta;

describe('provider-availability', () => {
  describe('before load', () => {
    it('hasMultipleAvailableProviders returns false when nothing loaded', async () => {
      const mod = await loadModule();
      expect(mod.hasMultipleAvailableProviders()).toBe(false);
    });

    it('getProviderAvailabilitySnapshot returns null when nothing loaded', async () => {
      const mod = await loadModule();
      expect(mod.getProviderAvailabilitySnapshot()).toBeNull();
    });

    it('getCachedProviderMetas returns empty array when nothing loaded', async () => {
      const mod = await loadModule();
      expect(mod.getCachedProviderMetas()).toEqual([]);
    });

    it('getProviderCapabilities returns null when nothing loaded', async () => {
      const mod = await loadModule();
      expect(mod.getProviderCapabilities('claude')).toBeNull();
    });

    it('getProviderDisplayName falls back to providerId when nothing loaded', async () => {
      const mod = await loadModule();
      expect(mod.getProviderDisplayName('claude')).toBe('claude');
    });
  });

  describe('loadProviderMetas', () => {
    it('caches the result and only calls listProviders once', async () => {
      listProviders.mockResolvedValue([metaClaude]);
      const mod = await loadModule();
      await mod.loadProviderMetas();
      await mod.loadProviderMetas();
      expect(listProviders).toHaveBeenCalledTimes(1);
      expect(mod.getCachedProviderMetas()).toEqual([metaClaude]);
    });
  });

  describe('loadProviderAvailability', () => {
    it('populates availability map from checkBinary results', async () => {
      listProviders.mockResolvedValue([metaClaude, metaCodex]);
      checkBinary.mockImplementation(async (id: string) => ({ ok: id === 'claude' }));
      const mod = await loadModule();
      await mod.loadProviderAvailability();
      const snapshot = mod.getProviderAvailabilitySnapshot();
      expect(snapshot).not.toBeNull();
      expect(snapshot!.availability.get('claude')).toBe(true);
      expect(snapshot!.availability.get('codex')).toBe(false);
      expect(snapshot!.providers).toEqual([metaClaude, metaCodex]);
    });
  });

  describe('hasMultipleAvailableProviders', () => {
    it('returns false when zero available', async () => {
      listProviders.mockResolvedValue([metaClaude, metaCodex]);
      checkBinary.mockResolvedValue({ ok: false });
      const mod = await loadModule();
      await mod.loadProviderAvailability();
      expect(mod.hasMultipleAvailableProviders()).toBe(false);
    });

    it('returns false when exactly one available', async () => {
      listProviders.mockResolvedValue([metaClaude, metaCodex]);
      checkBinary.mockImplementation(async (id: string) => ({ ok: id === 'claude' }));
      const mod = await loadModule();
      await mod.loadProviderAvailability();
      expect(mod.hasMultipleAvailableProviders()).toBe(false);
    });

    it('returns true when two or more available', async () => {
      listProviders.mockResolvedValue([metaClaude, metaCodex]);
      checkBinary.mockResolvedValue({ ok: true });
      const mod = await loadModule();
      await mod.loadProviderAvailability();
      expect(mod.hasMultipleAvailableProviders()).toBe(true);
    });
  });

  describe('getProviderCapabilities / getProviderDisplayName', () => {
    it('returns capabilities for a known provider', async () => {
      listProviders.mockResolvedValue([metaClaude]);
      const mod = await loadModule();
      await mod.loadProviderMetas();
      expect(mod.getProviderCapabilities('claude')).toEqual(metaClaude.capabilities);
    });

    it('returns null for an unknown provider', async () => {
      listProviders.mockResolvedValue([metaClaude]);
      const mod = await loadModule();
      await mod.loadProviderMetas();
      expect(mod.getProviderCapabilities('codex')).toBeNull();
    });

    it('returns displayName for a known provider', async () => {
      listProviders.mockResolvedValue([metaClaude]);
      const mod = await loadModule();
      await mod.loadProviderMetas();
      expect(mod.getProviderDisplayName('claude')).toBe('Claude Code');
    });

    it('falls back to providerId for unknown provider after load', async () => {
      listProviders.mockResolvedValue([metaClaude]);
      const mod = await loadModule();
      await mod.loadProviderMetas();
      expect(mod.getProviderDisplayName('codex')).toBe('codex');
    });
  });
});
