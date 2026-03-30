import { makeInstructionProducer } from './ai-instructions';

export const codexInstructionsProducer = makeInstructionProducer('codex', {
  fileName: 'AGENTS.md',
  idPrefix: 'agents-md',
  displayName: 'AGENTS.md',
});
