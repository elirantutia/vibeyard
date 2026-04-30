import { describe, it, expect } from 'vitest';
import { parseTeamMarkdown, memberFromMarkdown } from './frontmatter';

describe('parseTeamMarkdown', () => {
  it('parses frontmatter and body', () => {
    const raw = `---
id: cmo
name: CMO
role: Chief Marketing Officer
---

You are the CMO.`;
    const { meta, body } = parseTeamMarkdown(raw);
    expect(meta).toEqual({ id: 'cmo', name: 'CMO', role: 'Chief Marketing Officer' });
    expect(body).toBe('You are the CMO.');
  });

  it('strips surrounding quotes from values', () => {
    const raw = `---
name: "CMO"
role: 'Chief'
---
body`;
    const { meta } = parseTeamMarkdown(raw);
    expect(meta.name).toBe('CMO');
    expect(meta.role).toBe('Chief');
  });

  it('returns body only when no frontmatter present', () => {
    const { meta, body } = parseTeamMarkdown('just text');
    expect(meta).toEqual({});
    expect(body).toBe('just text');
  });
});

describe('memberFromMarkdown', () => {
  const raw = `---
id: cmo
name: CMO
role: Chief Marketing Officer
description: Strategic marketing leadership
---

You are the CMO.`;

  it('builds a TeamMember from a complete file', () => {
    const m = memberFromMarkdown(raw, { fallbackId: 'fallback', source: 'predefined', sourceUrl: 'https://x' });
    expect(m).toBeTruthy();
    expect(m!.id).toBe('cmo');
    expect(m!.name).toBe('CMO');
    expect(m!.role).toBe('Chief Marketing Officer');
    expect(m!.description).toBe('Strategic marketing leadership');
    expect(m!.systemPrompt).toBe('You are the CMO.');
    expect(m!.source).toBe('predefined');
    expect(m!.sourceUrl).toBe('https://x');
  });

  it('falls back to provided id when frontmatter id is missing', () => {
    const noId = `---
name: CMO
role: Marketing
---
body`;
    const m = memberFromMarkdown(noId, { fallbackId: 'cmo-md', source: 'custom' });
    expect(m!.id).toBe('cmo-md');
  });

  it('returns null when name, role, or body is missing', () => {
    const noName = `---
role: x
---
body`;
    expect(memberFromMarkdown(noName, { fallbackId: 'x', source: 'custom' })).toBeNull();

    const noBody = `---
name: CMO
role: x
---`;
    expect(memberFromMarkdown(noBody, { fallbackId: 'x', source: 'custom' })).toBeNull();
  });
});

