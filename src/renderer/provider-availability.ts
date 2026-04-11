import type { ProviderId, CliProviderMeta, CliProviderCapabilities } from '../shared/types.js';

let cachedProviders: CliProviderMeta[] | null = null;
let cachedAvailability: Map<ProviderId, boolean> | null = null;

export async function loadProviderMetas(): Promise<void> {
  if (!cachedProviders) {
    cachedProviders = await window.vibeyard.provider.listProviders();
  }
}

export async function loadProviderAvailability(): Promise<void> {
  await loadProviderMetas();
  const checks = await Promise.all(
    cachedProviders.map(async p => ({ id: p.id, ok: await window.vibeyard.provider.checkBinary(p.id) }))
  );
  cachedAvailability = new Map(checks.map(c => [c.id, c.ok]));
}

export function hasMultipleAvailableProviders(): boolean {
  if (!cachedAvailability) return false;
  let count = 0;
  for (const ok of cachedAvailability.values()) {
    if (ok) count++;
    if (count > 1) return true;
  }
  return false;
}

export function getProviderAvailabilitySnapshot(): {
  providers: CliProviderMeta[];
  availability: Map<ProviderId, boolean>;
} | null {
  if (!cachedProviders || !cachedAvailability) return null;
  return {
    providers: cachedProviders,
    availability: cachedAvailability,
  };
}

export function getCachedProviderMetas(): CliProviderMeta[] {
  return cachedProviders ?? [];
}

export function getProviderCapabilities(providerId: ProviderId): CliProviderCapabilities | null {
  if (!cachedProviders) return null;
  return cachedProviders.find(provider => provider.id === providerId)?.capabilities ?? null;
}

export function getProviderDisplayName(providerId: ProviderId): string {
  if (!cachedProviders) return providerId;
  return cachedProviders.find(provider => provider.id === providerId)?.displayName ?? providerId;
}
