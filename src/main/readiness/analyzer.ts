import type { ReadinessResult } from '../../shared/types';
import type { ReadinessCheckProducer, TaggedCheck, TopCategory } from './types';
import { getAvailableProviderIds } from '../providers/registry';
import { computeCategoryScore, getTrackedFiles } from './utils';
import { aiInstructionsProducer } from './checkers/ai-instructions';
import { codexInstructionsProducer } from './checkers/codex-instructions';
import { geminiInstructionsProducer } from './checkers/gemini-instructions';
import { customExtensionsProducer } from './checkers/custom-extensions';
import { claudeContextProducer } from './checkers/claude-context';
import { codexContextProducer } from './checkers/codex-context';
import { geminiContextProducer } from './checkers/gemini-context';
import { genericContextProducer } from './checkers/context-optimization';

const allProducers: ReadinessCheckProducer[] = [
  aiInstructionsProducer,
  codexInstructionsProducer,
  geminiInstructionsProducer,
  customExtensionsProducer,
  claudeContextProducer,
  codexContextProducer,
  geminiContextProducer,
  genericContextProducer,
];

const CATEGORIES: { id: TopCategory; name: string; weight: number }[] = [
  { id: 'instructions', name: 'Instructions', weight: 0.50 },
  { id: 'context', name: 'Context', weight: 0.30 },
  { id: 'optimizations', name: 'Optimizations', weight: 0.20 },
];

export async function analyzeReadiness(projectPath: string): Promise<ReadinessResult> {
  const availableIds = new Set(getAvailableProviderIds());

  const activeProducers = allProducers.filter(
    p => !p.providerId || availableIds.has(p.providerId)
  );

  const ctx = { trackedFiles: getTrackedFiles(projectPath) };

  const allTagged: TaggedCheck[] = activeProducers.flatMap(p => {
    const tagged = p.produce(projectPath, ctx);
    // Auto-stamp providerIds from producer if not already set
    if (p.providerId) {
      for (const t of tagged) {
        if (!t.check.providerIds) {
          t.check.providerIds = [p.providerId];
        }
      }
    }
    return tagged;
  });

  const grouped = new Map<TopCategory, TaggedCheck[]>();
  for (const tagged of allTagged) {
    const list = grouped.get(tagged.category) ?? [];
    list.push(tagged);
    grouped.set(tagged.category, list);
  }

  const categories = CATEGORIES
    .map(def => {
      const checks = (grouped.get(def.id) ?? []).map(t => t.check);
      return {
        id: def.id,
        name: def.name,
        weight: def.weight,
        score: computeCategoryScore(checks),
        checks,
      };
    })
    .filter(cat => cat.checks.length > 0);

  // Normalize weights to active categories
  const totalWeight = categories.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight > 0) {
    for (const cat of categories) {
      cat.weight = cat.weight / totalWeight;
    }
  }

  const overallScore = Math.round(
    categories.reduce((sum, cat) => sum + cat.score * cat.weight, 0)
  );

  return {
    overallScore,
    categories,
    scannedAt: new Date().toISOString(),
  };
}
