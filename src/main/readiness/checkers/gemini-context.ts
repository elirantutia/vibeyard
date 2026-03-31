import type { ReadinessCheckProducer, TaggedCheck, AnalysisContext } from '../types';
import { checkNotBloated } from './instruction-file-checks';

export const geminiContextProducer: ReadinessCheckProducer = {
  providerId: 'gemini',

  produce(projectPath: string, _ctx: AnalysisContext): TaggedCheck[] {
    const check = checkNotBloated(projectPath, { fileName: 'GEMINI.md', idPrefix: 'gemini-md', displayName: 'GEMINI.md' });
    return [{ category: 'context', check }];
  },
};
