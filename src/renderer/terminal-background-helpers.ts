import type { Preferences, TerminalBackgroundMode } from '../shared/types.js';

export const DEFAULT_TERMINAL_BG_PRESET_ID = 'metro';

export const TERMINAL_BG_PRESETS: readonly { id: string; label: string; gradient: string }[] = [
  {
    id: 'metro',
    label: 'City night',
    gradient: 'linear-gradient(165deg, #183060 0%, #402040 38%, #1a4080 100%)',
  },
  {
    id: 'aurora',
    label: 'Aurora',
    gradient: 'linear-gradient(140deg, #201050 0%, #5838a0 45%, #186060 100%)',
  },
  {
    id: 'ember',
    label: 'Ember',
    gradient: 'linear-gradient(180deg, #301010 0%, #602828 50%, #1c0808 100%)',
  },
  {
    id: 'depths',
    label: 'Depths',
    gradient: 'linear-gradient(160deg, #0c2048 0%, #2050a0 55%, #103850 100%)',
  },
  {
    id: 'synthwave',
    label: 'Synthwave',
    gradient: 'linear-gradient(125deg, #1a0830 0%, #701858 42%, #083a58 100%)',
  },
  {
    id: 'lagoon',
    label: 'Lagoon',
    gradient: 'linear-gradient(160deg, #042830 0%, #0d6e6e 48%, #043a50 100%)',
  },
  {
    id: 'horizon',
    label: 'Horizon',
    gradient: 'linear-gradient(185deg, #102050 0%, #c84820 45%, #284878 100%)',
  },
  {
    id: 'twilight',
    label: 'Twilight',
    gradient: 'linear-gradient(150deg, #281040 0%, #502090 50%, #102040 100%)',
  },
  {
    id: 'magma',
    label: 'Magma',
    gradient: 'linear-gradient(170deg, #200808 0%, #a02010 40%, #401808 100%)',
  },
  {
    id: 'noir',
    label: 'Noir steel',
    gradient: 'linear-gradient(165deg, #101418 0%, #303848 50%, #0a1018 100%)',
  },
] as const;

export function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function effectiveTerminalBackgroundMode(prefs: Preferences | undefined): TerminalBackgroundMode {
  if (!prefs) return 'none';
  const raw = prefs.terminalBackgroundMode;
  const m = typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
  if (m === 'preset' || m === 'custom') return m;
  return 'none';
}

export function getTerminalBackgroundDim(prefs: Preferences | undefined): number {
  return clampUnit(prefs?.terminalBackgroundDim ?? 0.28);
}

export function getTerminalBackgroundSurfaceAlpha(prefs: Preferences | undefined): number {
  return clampUnit(prefs?.terminalBackgroundSurfaceAlpha ?? 0.88);
}

export function getPresetGradientCss(presetId: string | undefined): string {
  const id = presetId && presetId.length > 0 ? presetId : DEFAULT_TERMINAL_BG_PRESET_ID;
  const hit = TERMINAL_BG_PRESETS.find((p) => p.id === id);
  return (hit ?? TERMINAL_BG_PRESETS[0]).gradient;
}

export function normalizePresetId(presetId: string | undefined): string {
  const id = presetId && presetId.length > 0 ? presetId : DEFAULT_TERMINAL_BG_PRESET_ID;
  return TERMINAL_BG_PRESETS.some((p) => p.id === id) ? id : DEFAULT_TERMINAL_BG_PRESET_ID;
}

/**
 * xterm `theme.background` color: opaque black when backdrop off; translucent black when on.
 */
export function getTerminalSurfaceBackgroundColor(prefs: Preferences | undefined): string {
  if (!backdropIsActive(prefs)) {
    return '#000000';
  }
  const a = getTerminalBackgroundSurfaceAlpha(prefs);
  return `rgba(0,0,0,${a})`;
}

export function backdropIsActive(prefs: Preferences | undefined): boolean {
  if (!prefs) return false;
  const mode = effectiveTerminalBackgroundMode(prefs);
  if (mode === 'preset') return true;
  if (mode === 'custom') {
    const p = prefs.terminalBackgroundImagePath;
    return typeof p === 'string' && p.length > 0;
  }
  return false;
}
