import type { ReadinessCheckProducer, TaggedCheck, AnalysisContext } from '../types';
import { runAllInstructionChecks, type InstructionFileOpts } from './instruction-file-checks';
import type { ProviderId } from '../../../shared/types';

export function makeInstructionProducer(providerId: ProviderId, opts: InstructionFileOpts): ReadinessCheckProducer {
  return {
    providerId,
    produce(projectPath: string, _ctx: AnalysisContext): TaggedCheck[] {
      return runAllInstructionChecks(projectPath, opts).map(check => ({
        category: 'instructions',
        check,
      }));
    },
  };
}

export const aiInstructionsProducer = makeInstructionProducer('claude', {
  fileName: 'CLAUDE.md',
  idPrefix: 'claude-md',
  displayName: 'CLAUDE.md',
});
