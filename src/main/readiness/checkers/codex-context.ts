import type { ReadinessCheckProducer, TaggedCheck, AnalysisContext } from '../types';
import { checkNotBloated } from './instruction-file-checks';

export const codexContextProducer: ReadinessCheckProducer = {
  providerId: 'codex',

  produce(projectPath: string, _ctx: AnalysisContext): TaggedCheck[] {
    const check = checkNotBloated(projectPath, { fileName: 'AGENTS.md', idPrefix: 'agents-md', displayName: 'AGENTS.md' });
    return [{ category: 'context', check }];
  },
};
