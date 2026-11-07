/**
 * Project card colors. A project's `color` is user data (a hex value it chose),
 * not a theme token, so the preset palette is hex literals picked to read on both
 * the dark and light themes once mixed into the card background (see the
 * `.project-row.has-color` rules in styles/sidebar.css). Any other `#rrggbb` is
 * accepted too, from the custom color picker.
 */
export const PROJECT_COLOR_PALETTE: readonly string[] = [
  '#e94560', // red
  '#e67e22', // orange
  '#f4b400', // yellow
  '#34a853', // green
  '#14b8a6', // teal
  '#4285f4', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Canonical (lowercase `#rrggbb`) form of a project color, or undefined if it is not one. */
export function normalizeProjectColor(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return HEX_COLOR.test(trimmed) ? trimmed.toLowerCase() : undefined;
}
