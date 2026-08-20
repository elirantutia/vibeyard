/**
 * Embed a JS value as a Python literal, for the hook scripts the providers
 * generate.
 *
 * Use this instead of a raw `r'...'` literal for anything path-shaped:
 * `JSON.stringify`'s escapes (`\\`, `\"`, `\uXXXX`) are all valid Python ones,
 * whereas a raw literal breaks on an apostrophe in the path — a Windows user
 * named O'Brien — and the resulting SyntaxError kills the entire hook script
 * silently. See the same note in `hook-status.ts`'s `buildStatusLinePython`.
 *
 * Lives here rather than in `hook-commands.ts` so provider suites that mock that
 * module don't have to stub a pure serializer.
 */
export function pyLiteral(value: unknown): string {
  return JSON.stringify(value);
}
