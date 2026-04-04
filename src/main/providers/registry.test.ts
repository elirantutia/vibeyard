import { describe, it, expect, beforeEach } from 'vitest';
import type { CliProvider } from './provider';
import type { CliProviderMeta } from '../../shared/types';
import { initProviders, registerProvider, getProvider, getAllProviders, getProviderMeta, getAllProviderMetas } from './registry';

const fakeMeta: CliProviderMeta = {
  id: 'copilot',
  displayName: 'Copilot CLI',
  binaryName: 'copilot',
  capabilities: {
    sessionResume: false,
    costTracking: false,
    contextWindow: false,
    hookStatus: false,
    configReading: false,
    shiftEnterNewline: false,
    pendingPromptTrigger: 'session-start',
  },
  defaultContextWindowSize: 128_000,
};

function makeFakeProvider(meta: CliProviderMeta): CliProvider {
  return {
    meta,
    resolveBinaryPath: () => '/usr/bin/fake',
    validatePrerequisites: () => ({ ok: true, message: '' }),
    buildEnv: (_sid, env) => env,
    buildArgs: () => [],
    installHooks: async () => {},
    installStatusScripts: () => {},
    cleanup: () => {},
    getConfig: async () => ({ mcpServers: [], agents: [], skills: [], commands: [] }),
    getShiftEnterSequence: () => null,
    validateSettings: () => ({ statusLine: 'vibeyard', hooks: 'complete', hookDetails: {} }),
    reinstallSettings: () => {},
  };
}

beforeEach(() => {
  // Re-init to reset registry to only the Claude provider
  initProviders();
});

describe('initProviders', () => {
  it('registers the Claude provider', () => {
    const provider = getProvider('claude');
    expect(provider).toBeDefined();
    expect(provider.meta.id).toBe('claude');
  });

  it('registers the Codex provider', () => {
    const provider = getProvider('codex');
    expect(provider).toBeDefined();
    expect(provider.meta.id).toBe('codex');
  });
});

describe('getProvider', () => {
  it('registers the Gemini provider', () => {
    const provider = getProvider('gemini');
    expect(provider).toBeDefined();
    expect(provider.meta.id).toBe('gemini');
  });

  it('throws for unknown provider ID', () => {
    expect(() => getProvider('copilot')).toThrow('Unknown CLI provider: copilot');
  });
});

describe('registerProvider', () => {
  it('makes a custom provider retrievable', () => {
    const fake = makeFakeProvider(fakeMeta);
    registerProvider(fake);
    expect(getProvider('copilot')).toBe(fake);
  });
});

describe('getAllProviders', () => {
  it('returns all registered providers', () => {
    registerProvider(makeFakeProvider(fakeMeta));
    const all = getAllProviders();
    expect(all.length).toBe(4);
    const ids = all.map(p => p.meta.id);
    expect(ids).toContain('claude');
    expect(ids).toContain('codex');
    expect(ids).toContain('gemini');
    expect(ids).toContain('copilot');
  });
});

describe('getProviderMeta', () => {
  it('returns meta for a given provider ID', () => {
    const meta = getProviderMeta('claude');
    expect(meta.id).toBe('claude');
    expect(meta.displayName).toBe('Claude Code');
  });
});

describe('getAllProviderMetas', () => {
  it('returns meta array for all providers', () => {
    registerProvider(makeFakeProvider(fakeMeta));
    const metas = getAllProviderMetas();
    expect(metas.length).toBe(4);
    expect(metas.map(m => m.id)).toContain('codex');
    expect(metas.map(m => m.id)).toContain('gemini');
    expect(metas.map(m => m.id)).toContain('copilot');
  });
});
