import type { ReadinessCheck, ProviderId } from '../../shared/types';

export type TopCategory = 'instructions' | 'context' | 'optimizations';

export interface TaggedCheck {
  category: TopCategory;
  check: ReadinessCheck;
}

export interface AnalysisContext {
  trackedFiles: string[];
  /**
   * Whether a project-relative path is excluded by `.vibeyardignore`. Built once per scan:
   * it reads the file and compiles two picomatch matchers, which is not worth repeating in
   * every producer.
   */
  isIgnored: (relPath: string) => boolean;
}

export interface ReadinessCheckProducer {
  providerId?: ProviderId;
  produce(projectPath: string, ctx: AnalysisContext): TaggedCheck[];
}
