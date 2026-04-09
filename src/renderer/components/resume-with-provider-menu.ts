import type { ProviderId } from '../../shared/types.js';
import { getProviderAvailabilitySnapshot } from '../provider-availability.js';

/**
 * Build context-menu items for "Resume with <other provider>".
 * Returns a leading separator followed by one item per other provider,
 * or an empty array when there are no other providers.
 *
 * Unavailable providers appear disabled with a "(not installed)" suffix.
 */
export function buildResumeWithProviderItems(
  currentProviderId: ProviderId,
  onPick: (targetProviderId: ProviderId) => void,
): HTMLElement[] {
  const snapshot = getProviderAvailabilitySnapshot();
  const others = (snapshot?.providers ?? []).filter((p) => p.id !== currentProviderId);
  if (others.length === 0) return [];

  const elements: HTMLElement[] = [];
  const separator = document.createElement('div');
  separator.className = 'tab-context-menu-separator';
  elements.push(separator);

  for (const p of others) {
    const available = snapshot?.availability.get(p.id) ?? false;
    const item = document.createElement('div');
    item.className = 'tab-context-menu-item' + (!available ? ' disabled' : '');
    item.textContent = `Resume with ${p.displayName}${available ? '' : ' (not installed)'}`;
    if (available) {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        onPick(p.id);
      });
    }
    elements.push(item);
  }
  return elements;
}
