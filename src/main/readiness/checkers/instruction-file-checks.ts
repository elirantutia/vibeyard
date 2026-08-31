import * as path from 'path';
import type { ReadinessCheck } from '../../../shared/types';
import type { AnalysisContext } from '../types';
import { fileExists, readFileSafe, countFileLines } from '../utils';

export interface InstructionFileOpts {
  fileName: string;           // e.g. 'CLAUDE.md' or 'AGENTS.md'
  fallbackDirectory?: string; // e.g. '.claude'
  idPrefix: string;           // e.g. 'claude-md' or 'agents-md'
  displayName: string;        // e.g. 'CLAUDE.md' or 'AGENTS.md'
}

/** Line counts above which an instruction file starts costing more context than it earns. */
export const SIZE_WARN_LINES = 300;
export const SIZE_FAIL_LINES = 500;

/** Defensive bound on how many nested-file rows a single scan may add to the readiness list. */
const MAX_NESTED_ROWS = 20;

/**
 * The project-relative locations an instruction file may live at, in precedence order.
 * Returned as POSIX paths so they can be compared directly against `git ls-files` output,
 * which uses forward slashes on every platform.
 */
export function instructionFileCandidates(opts: InstructionFileOpts): string[] {
  const candidates = [opts.fileName];
  if (opts.fallbackDirectory) {
    candidates.push(`${opts.fallbackDirectory}/${opts.fileName}`);
  }
  return candidates;
}

export function resolveInstructionFilePath(projectPath: string, opts: InstructionFileOpts): string | null {
  for (const rel of instructionFileCandidates(opts)) {
    const candidate = path.join(projectPath, rel);
    if (fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

/** Grades a line count already known to exceed `SIZE_WARN_LINES`, and words the verdict. */
function describeTooLong(label: string, lines: number): { status: 'warning' | 'fail'; score: number; description: string } {
  return lines <= SIZE_FAIL_LINES
    ? { status: 'warning', score: 50, description: `${label} is ${lines} lines — consider trimming for focus.` }
    : { status: 'fail', score: 0, description: `${label} is ${lines} lines — too long, may waste context window.` };
}

function trimFixPrompt(label: string): string {
  return `The ${label} file is too long (over ${SIZE_WARN_LINES} lines). Trim it to focus on the most important information for AI agents. Move detailed documentation to separate files and keep ${label} between 50-${SIZE_WARN_LINES} lines.`;
}

export function checkFileExists(projectPath: string, opts: InstructionFileOpts): ReadinessCheck {
  const exists = resolveInstructionFilePath(projectPath, opts) !== null;
  return {
    id: `${opts.idPrefix}-exists`,
    name: `${opts.displayName} exists`,
    status: exists ? 'pass' : 'fail',
    description: exists
      ? `${opts.displayName} found`
      : `No ${opts.displayName} file found. This is the primary way to give AI agents context about your project.`,
    score: exists ? 100 : 0,
    maxScore: 100,
    fixPrompt: exists
      ? undefined
      : `Create a ${opts.displayName} file for this project. Analyze the codebase and generate a comprehensive ${opts.displayName} that includes: project description, build/run commands, test commands, architecture overview, key file locations, and coding conventions. Make it thorough but concise (50-300 lines).`,
    effort: 'low',
    impact: 90,
    rationale: `${opts.displayName} is the first thing the AI reads about your project. Without it, the AI has to infer architecture, commands, and conventions from scratch every session — slower, costlier, and more error-prone. A focused instructions file pays for itself within a few prompts.`,
  };
}

export function checkBuildCommands(content: string | null, opts: InstructionFileOpts): ReadinessCheck {
  if (!content) {
    return {
      id: `${opts.idPrefix}-build`,
      name: `${opts.displayName} has build commands`,
      status: 'fail',
      description: `${opts.displayName} missing — cannot check for build commands.`,
      score: 0,
      maxScore: 100,
    };
  }
  const hasBuild = /\b(build|compile|run|start|dev|npm run|yarn |pnpm |make|cargo |go build|gradle|mvn)\b/i.test(content);
  return {
    id: `${opts.idPrefix}-build`,
    name: `${opts.displayName} has build commands`,
    status: hasBuild ? 'pass' : 'fail',
    description: hasBuild ? 'Build/run commands documented' : `No build or run commands found in ${opts.displayName}.`,
    score: hasBuild ? 100 : 0,
    maxScore: 100,
    fixPrompt: hasBuild ? undefined : `Update the ${opts.displayName} file to include build and run commands. Add a "Build & Run" section with the exact commands needed to build and run this project.`,
    effort: 'low',
    impact: 60,
    rationale: 'Without explicit build/run commands, the AI guesses based on the package manager or framework — and often guesses wrong on monorepos or projects with custom scripts. Listing the canonical commands removes a whole class of "command not found" failures.',
  };
}

export function checkTestCommands(content: string | null, opts: InstructionFileOpts): ReadinessCheck {
  if (!content) {
    return {
      id: `${opts.idPrefix}-test`,
      name: `${opts.displayName} has test commands`,
      status: 'fail',
      description: `${opts.displayName} missing — cannot check for test commands.`,
      score: 0,
      maxScore: 100,
    };
  }
  const hasTest = /\b(test|spec|jest|vitest|pytest|mocha|rspec|cargo test|go test|npm test|yarn test)\b/i.test(content);
  return {
    id: `${opts.idPrefix}-test`,
    name: `${opts.displayName} has test commands`,
    status: hasTest ? 'pass' : 'fail',
    description: hasTest ? 'Test commands documented' : `No test commands found in ${opts.displayName}.`,
    score: hasTest ? 100 : 0,
    maxScore: 100,
    fixPrompt: hasTest ? undefined : `Update the ${opts.displayName} file to include test commands. Add a "Testing" section with the exact commands needed to run tests in this project.`,
    effort: 'low',
    impact: 60,
    rationale: 'Documented test commands let the AI verify its own changes before handing back. Without them, it either skips testing or invents a command, which breaks the loop and wastes a turn.',
  };
}

export function checkArchitecture(content: string | null, opts: InstructionFileOpts): ReadinessCheck {
  if (!content) {
    return {
      id: `${opts.idPrefix}-architecture`,
      name: `${opts.displayName} has architecture section`,
      status: 'fail',
      description: `${opts.displayName} missing — cannot check for architecture documentation.`,
      score: 0,
      maxScore: 100,
    };
  }
  const hasArch = /\b(architecture|overview|structure|description|design|data flow|components)\b/i.test(content);
  return {
    id: `${opts.idPrefix}-architecture`,
    name: `${opts.displayName} has architecture section`,
    status: hasArch ? 'pass' : 'fail',
    description: hasArch ? 'Architecture/overview documented' : `No architecture or project overview found in ${opts.displayName}.`,
    score: hasArch ? 100 : 0,
    maxScore: 100,
    fixPrompt: hasArch ? undefined : `Update the ${opts.displayName} file to include an architecture overview. Add an "Architecture" section describing the project structure, key components, data flow, and important design decisions.`,
    effort: 'medium',
    impact: 70,
    rationale: 'A short architecture overview lets the AI skip the "where does this live?" exploration phase and jump straight into the right module. Without it, it spelunks files trying to reverse-engineer your structure.',
  };
}

export function checkFileSize(content: string | null, opts: InstructionFileOpts): ReadinessCheck {
  if (!content) {
    return {
      id: `${opts.idPrefix}-size`,
      name: `${opts.displayName} appropriate size`,
      status: 'fail',
      description: `${opts.displayName} missing.`,
      score: 0,
      maxScore: 100,
    };
  }
  const lines = content.split('\n').length;
  const tooShortPrompt = `The ${opts.displayName} file is too short. Expand it to include comprehensive project documentation (aim for 50-${SIZE_WARN_LINES} lines) covering: build commands, test commands, architecture, key files, and conventions.`;

  // Each branch carries its own fixPrompt so no threshold is tested twice.
  const verdict =
    lines > SIZE_WARN_LINES
      ? { ...describeTooLong(opts.displayName, lines), fixPrompt: trimFixPrompt(opts.displayName) }
      : lines >= 50
        ? { status: 'pass' as const, score: 100, description: `${opts.displayName} is ${lines} lines — good size.`, fixPrompt: undefined }
        : lines >= 10
          ? { status: 'warning' as const, score: 50, description: `${opts.displayName} is only ${lines} lines — consider adding more detail.`, fixPrompt: tooShortPrompt }
          : { status: 'fail' as const, score: 0, description: `${opts.displayName} is only ${lines} lines — too short to be useful.`, fixPrompt: tooShortPrompt };

  return {
    ...verdict,
    id: `${opts.idPrefix}-size`,
    name: `${opts.displayName} appropriate size`,
    maxScore: 100,
    effort: 'low',
    impact: 30,
    rationale: `${opts.displayName} is loaded into every prompt, so its bytes compete with your actual code for context. Too short and the AI lacks grounding; too long and it crowds out the files the AI actually needs to read.`,
  };
}

/**
 * Size checks for instruction files that live *below* the project root — e.g. a monorepo's
 * `packages/api/AGENTS.md`. The root checks only ever look at `instructionFileCandidates`,
 * so without this a 700-line nested file is invisible and every message names the root file.
 *
 * Candidates come from `git ls-files` (already computed once per scan), which costs no extra
 * I/O and inherits .gitignore, so vendored copies under node_modules never show up. Only
 * oversized files produce a row: a short package-level instructions file is correct, not a
 * defect, and a row per nested file would swamp the readiness list on a monorepo.
 *
 * The rows are `informational`, so they are listed and filterable but do not move the
 * category score. They can only ever grade 0 or 50 — counting them would let a monorepo's
 * file count dominate the 50%-weighted Instructions category, dragging it to 20% while every
 * root file is perfect. The root file stays the scored signal.
 */
export function checkNestedFileSizes(
  projectPath: string,
  ctx: AnalysisContext,
  opts: InstructionFileOpts,
): ReadinessCheck[] {
  // A nested path always has a separator before the filename, so this suffix test also
  // excludes the bare root file — and, unlike splitting, allocates nothing per candidate.
  const suffix = `/${opts.fileName}`;
  const rootCandidates = new Set(instructionFileCandidates(opts));
  const oversized: { rel: string; lines: number }[] = [];

  for (const rel of ctx.trackedFiles) {
    if (!rel.endsWith(suffix)) continue;
    if (rootCandidates.has(rel) || ctx.isIgnored(rel)) continue;

    try {
      // countFileLines streams through a fixed buffer, so even a committed multi-MB
      // instructions file is never materialized as one string.
      const lines = countFileLines(path.join(projectPath, rel));
      if (lines <= SIZE_WARN_LINES) continue;
      oversized.push({ rel, lines });
    } catch {
      // Unreadable or vanished between the git listing and now — nothing to report.
    }
  }

  // Worst offenders first, so the cap truncates the least useful rows rather than whatever
  // sorts last alphabetically.
  oversized.sort((a, b) => b.lines - a.lines);

  return oversized.slice(0, MAX_NESTED_ROWS).map(({ rel, lines }) => ({
    ...describeTooLong(rel, lines),
    id: `${opts.idPrefix}-size:${rel}`,
    name: `${rel} size`,
    score: 0,
    maxScore: 0,
    informational: true,
    fixPrompt: trimFixPrompt(rel),
    effort: 'low' as const,
    impact: 30,
    rationale: `${rel} is loaded whenever the AI works under ${path.posix.dirname(rel)}, and it stacks on top of the root instructions file. Past ~${SIZE_WARN_LINES} lines it crowds out the code the AI actually needs to read in the one directory where it matters most.`,
  }));
}

export function checkNotBloated(projectPath: string, opts: InstructionFileOpts): ReadinessCheck {
  const instructionPath = resolveInstructionFilePath(projectPath, opts);
  const content = instructionPath ? readFileSafe(instructionPath) : null;
  if (!content) {
    return {
      id: `${opts.idPrefix}-bloat`,
      name: `${opts.displayName} not bloated`,
      status: 'pass',
      description: `No ${opts.displayName} to check for bloat (checked in instructions).`,
      score: 100,
      maxScore: 100,
    };
  }
  const lines = content.split('\n').length;
  const bloatRationale = `Every byte of ${opts.displayName} is paid for on every prompt. Past ~${SIZE_WARN_LINES} lines you're spending real context budget on text the AI may not need that turn. Trim to essentials and offload depth to linked files.`;
  if (lines <= SIZE_WARN_LINES) {
    return { id: `${opts.idPrefix}-bloat`, name: `${opts.displayName} not bloated`, status: 'pass', description: `${opts.displayName} is ${lines} lines — within limits.`, score: 100, maxScore: 100, effort: 'low', impact: 30, rationale: bloatRationale };
  }
  if (lines <= SIZE_FAIL_LINES) {
    return {
      id: `${opts.idPrefix}-bloat`, name: `${opts.displayName} not bloated`, status: 'warning', description: `${opts.displayName} is ${lines} lines — getting large.`, score: 50, maxScore: 100,
      fixPrompt: `The ${opts.displayName} file is getting large. Review it and move detailed documentation to separate files. Keep ${opts.displayName} focused on essential context that AI agents need for every interaction.`,
      effort: 'medium', impact: 30, rationale: bloatRationale,
    };
  }
  return {
    id: `${opts.idPrefix}-bloat`, name: `${opts.displayName} not bloated`, status: 'fail', description: `${opts.displayName} is ${lines} lines — too large, wastes context window.`, score: 0, maxScore: 100,
    fixPrompt: `The ${opts.displayName} file is too large and wastes AI context window space. Aggressively trim it: move detailed docs to separate files, remove redundant information, and keep only the most critical context. Target under ${SIZE_WARN_LINES} lines.`,
    effort: 'medium', impact: 60, rationale: bloatRationale,
  };
}

export function runAllInstructionChecks(
  projectPath: string,
  opts: InstructionFileOpts,
  ctx: AnalysisContext,
): ReadinessCheck[] {
  const instructionPath = resolveInstructionFilePath(projectPath, opts);
  const content = instructionPath ? readFileSafe(instructionPath) : null;
  return [
    checkFileExists(projectPath, opts),
    checkBuildCommands(content, opts),
    checkTestCommands(content, opts),
    checkArchitecture(content, opts),
    checkFileSize(content, opts),
    ...checkNestedFileSizes(projectPath, ctx, opts),
  ];
}
