import * as path from 'path';
import * as os from 'os';
import {
  createCompatibleTranscriptModule,
  readSessionHeaderSync,
  readSessionHeaderAsync,
  readTranscriptTitleSync,
  HEADER_READ_BYTES,
} from './pi-compatible-transcripts';

/**
 * OMP's on-disk transcript contract (shared with Pi — see
 * pi-compatible-transcripts.ts) parameterized with OMP's default agent dir.
 */
export { HEADER_READ_BYTES, readSessionHeaderSync, readSessionHeaderAsync, readTranscriptTitleSync };
export type { CompatibleSessionHeader as OmpSessionHeader } from './pi-compatible-transcripts';

const { agentDir, sessionsRoot } = createCompatibleTranscriptModule(
  path.join(os.homedir(), '.omp', 'agent')
);

/** OMP's agent dir: ~/.omp/agent by default, relocated via PI_CODING_AGENT_DIR (profiles). */
export const ompAgentDir = agentDir;

export const ompSessionsRoot = sessionsRoot;
