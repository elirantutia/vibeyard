import type { ReadinessCategory } from '../../shared/types';

export interface ReadinessChecker {
  id: string;
  name: string;
  weight: number;
  analyze(projectPath: string): Promise<ReadinessCategory>;
}
