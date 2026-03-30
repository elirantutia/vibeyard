import type { ReadinessCheck, ProviderId } from '../../shared/types';

export type TopCategory = 'instructions' | 'context' | 'optimizations';

export interface TaggedCheck {
  category: TopCategory;
  check: ReadinessCheck;
}

export interface AnalysisContext {
  trackedFiles: string[];
}

export interface ReadinessCheckProducer {
  providerId?: ProviderId;
  produce(projectPath: string, ctx: AnalysisContext): TaggedCheck[];
}
