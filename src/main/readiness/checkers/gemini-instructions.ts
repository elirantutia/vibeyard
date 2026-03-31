import { makeInstructionProducer } from './ai-instructions';

export const geminiInstructionsProducer = makeInstructionProducer('gemini', {
  fileName: 'GEMINI.md',
  idPrefix: 'gemini-md',
  displayName: 'GEMINI.md',
});
