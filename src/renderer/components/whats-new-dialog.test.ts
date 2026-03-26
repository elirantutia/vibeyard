import { describe, it, expect, vi } from 'vitest';

vi.mock('./modal.js', () => ({ closeModal: vi.fn() }));
vi.mock('../state.js', () => ({ appState: { lastSeenVersion: undefined, setLastSeenVersion: vi.fn() } }));

import { parseChangelog } from './whats-new-dialog';

const SAMPLE_CHANGELOG = `# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-04-01

### Features
- New feature A
- New feature B

### Fixes
- Bug fix X

### Changes
- Changed Y

## [0.2.11] - 2026-03-24

### Features
- Demo GIF to README
- Smarter tool failure classification

### Fixes
- Sidebar flickering

## [0.2.10] - 2026-03-23

### Features
- Per-hook status breakdown
`;

describe('parseChangelog', () => {
  it('extracts the correct version section', () => {
    const notes = parseChangelog(SAMPLE_CHANGELOG, '0.3.0');
    expect(notes).not.toBeNull();
    expect(notes!.date).toBe('2026-04-01');
    expect(notes!.features).toEqual(['New feature A', 'New feature B']);
    expect(notes!.fixes).toEqual(['Bug fix X']);
    expect(notes!.changes).toEqual(['Changed Y']);
  });

  it('extracts a middle version correctly', () => {
    const notes = parseChangelog(SAMPLE_CHANGELOG, '0.2.11');
    expect(notes).not.toBeNull();
    expect(notes!.date).toBe('2026-03-24');
    expect(notes!.features).toEqual([
      'Demo GIF to README',
      'Smarter tool failure classification',
    ]);
    expect(notes!.fixes).toEqual(['Sidebar flickering']);
    expect(notes!.changes).toEqual([]);
  });

  it('extracts the last version in the file', () => {
    const notes = parseChangelog(SAMPLE_CHANGELOG, '0.2.10');
    expect(notes).not.toBeNull();
    expect(notes!.features).toEqual(['Per-hook status breakdown']);
    expect(notes!.fixes).toEqual([]);
    expect(notes!.changes).toEqual([]);
  });

  it('returns null for a version not in the changelog', () => {
    const notes = parseChangelog(SAMPLE_CHANGELOG, '9.9.9');
    expect(notes).toBeNull();
  });

  it('returns null for a version with no list items', () => {
    const changelog = `# Changelog

## [1.0.0] - 2026-01-01

## [0.9.0] - 2025-12-01

### Features
- Something
`;
    const notes = parseChangelog(changelog, '1.0.0');
    expect(notes).toBeNull();
  });

  it('handles versions with special regex characters', () => {
    const notes = parseChangelog(SAMPLE_CHANGELOG, '0.3.0');
    expect(notes).not.toBeNull();
  });
});
