import { EventEmitter } from 'node:events';

import type { CostData } from '../shared/types';

export interface CostDataPayload {
  sessionId: string;
  costData: CostData;
}

export interface CostEvents {
  on(event: 'costData', listener: (payload: CostDataPayload) => void): this;
  off(event: 'costData', listener: (payload: CostDataPayload) => void): this;
  emit(event: 'costData', payload: CostDataPayload): boolean;
}

class TypedCostEvents extends EventEmitter implements CostEvents {}

export const costEvents: CostEvents = new TypedCostEvents();
