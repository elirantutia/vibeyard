import type { ReadinessResult } from '../../shared/types';
import type { ReadinessChecker } from './types';
import { aiInstructionsChecker } from './checkers/ai-instructions';
import { customExtensionsChecker } from './checkers/custom-extensions';
import { contextOptimizationChecker } from './checkers/context-optimization';

const checkers: ReadinessChecker[] = [
  aiInstructionsChecker,
  customExtensionsChecker,
  contextOptimizationChecker,
];

export async function analyzeReadiness(projectPath: string): Promise<ReadinessResult> {
  const categories = await Promise.all(checkers.map(c => c.analyze(projectPath)));

  const overallScore = Math.round(
    categories.reduce((sum, cat) => sum + cat.score * cat.weight, 0)
  );

  return {
    overallScore,
    categories,
    scannedAt: new Date().toISOString(),
  };
}
