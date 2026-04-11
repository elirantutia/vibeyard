import type { CliProviderMeta, SettingsValidationResult } from '../../shared/types.js';

export interface ProviderStatus {
  meta: CliProviderMeta;
  validation: SettingsValidationResult;
  binaryOk: boolean;
}

export function hasProviderIssue({ meta, validation, binaryOk }: ProviderStatus): boolean {
  if (!binaryOk) return false;
  if ((meta.capabilities.costTracking || meta.capabilities.contextWindow) && validation.statusLine !== 'vibeyard') return true;
  if (meta.capabilities.hookStatus && validation.hooks !== 'complete') return true;
  return false;
}
