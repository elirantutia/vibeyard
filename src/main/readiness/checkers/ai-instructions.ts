import type { ReadinessCheckProducer, TaggedCheck, AnalysisContext } from '../types';
import { runAllInstructionChecks, type InstructionFileOpts } from './instruction-file-checks';
import type { ProviderId } from '../../../shared/types';

export function makeInstructionProducer(providerId: ProviderId, opts: InstructionFileOpts): ReadinessCheckProducer {
  return {
    providerId,
    produce(projectPath: string, ctx: AnalysisContext): TaggedCheck[] {
      return runAllInstructionChecks(projectPath, opts, ctx).map(check => ({
        category: 'instructions',
        check,
      }));
    },
  };
}

export const claudeInstructionFileOpts: InstructionFileOpts = {
  fileName: 'CLAUDE.md',
  fallbackDirectory: '.claude',
  idPrefix: 'claude-md',
  displayName: 'CLAUDE.md',
};

export const aiInstructionsProducer = makeInstructionProducer('claude', claudeInstructionFileOpts);
