import type { SessionRecord } from '../shared/types.js';

export function isCliSession(session: Pick<SessionRecord, 'type'>): boolean {
  return !session.type;
}
