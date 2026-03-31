import type { ProviderId, CliProviderMeta } from '../../shared/types';
import type { CliProvider } from './provider';
import { ClaudeProvider } from './claude-provider';
import { CodexProvider } from './codex-provider';
import { GeminiProvider } from './gemini-provider';

const providers = new Map<ProviderId, CliProvider>();

export function initProviders(): void {
  registerProvider(new ClaudeProvider());
  registerProvider(new CodexProvider());
  registerProvider(new GeminiProvider());
}

export function registerProvider(provider: CliProvider): void {
  providers.set(provider.meta.id, provider);
}

export function getProvider(id: ProviderId): CliProvider {
  const provider = providers.get(id);
  if (!provider) {
    throw new Error(`Unknown CLI provider: ${id}`);
  }
  return provider;
}

export function getAllProviders(): CliProvider[] {
  return Array.from(providers.values());
}

export function getProviderMeta(id: ProviderId): CliProviderMeta {
  return getProvider(id).meta;
}

export function getAllProviderMetas(): CliProviderMeta[] {
  return getAllProviders().map(p => p.meta);
}

export function getAvailableProviderIds(): ProviderId[] {
  return getAllProviders()
    .filter(p => p.validatePrerequisites().ok)
    .map(p => p.meta.id);
}
