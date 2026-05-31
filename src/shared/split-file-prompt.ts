/**
 * Builds the prompt used to ask the CLI to split oversized files into smaller,
 * focused modules. Shared between the readiness "large files" checker (main
 * process) and the Top Files by Tokens widget (renderer) so the wording lives
 * in one place.
 */
export function buildSplitFilesPrompt(files: string[]): string {
  if (files.length === 1) {
    return `This file is very large and may consume excessive AI context: ${files[0]}. Split it into smaller, focused modules.`;
  }
  return `These files are very large and may consume excessive AI context: ${files.join(', ')}. Split them into smaller, focused modules.`;
}
