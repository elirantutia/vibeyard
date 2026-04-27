/** Per-session character cap when indexing transcript content for global search. */
export const MAX_INDEX_CHARS_PER_SESSION = 50 * 1024;

/** UUID v4-shaped string used as a cliSessionId by Claude/Codex/Copilot. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Joins extracted user-message snippets with a clear separator the snippet extractor can land on. */
export const TRANSCRIPT_TEXT_SEPARATOR = '\n---\n';
