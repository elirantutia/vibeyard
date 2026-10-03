import { describe, it, expect } from 'vitest';
import {
  validateShareKey,
  generateShareKey,
  encryptPayload,
  decryptPayload,
  DecryptionError,
  generateChallenge,
  computeChallengeResponse,
  bytesToHex,
  hexToBytes,
} from './share-crypto.js';

describe('share key', () => {
  it('generates distinct 128-bit keys', () => {
    const a = generateShareKey();
    const b = generateShareKey();
    expect(validateShareKey(a)).toBeNull();
    expect(a).not.toBe(b);
  });

  it('rejects short and malformed keys', () => {
    expect(validateShareKey('1234')).not.toBeNull();
    expect(validateShareKey('g'.repeat(32))).not.toBeNull();
    expect(validateShareKey('')).not.toBeNull();
  });
});

describe('encryptPayload / decryptPayload', () => {
  it('round-trips correctly', async () => {
    const plaintext = '{"type":"offer","sdp":"v=0\\r\\n..."}';
    const pin = '4829';
    const encrypted = await encryptPayload(plaintext, pin);
    const decrypted = await decryptPayload(encrypted, pin);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (random salt/IV)', async () => {
    const plaintext = 'hello world';
    const pin = '1234';
    const a = await encryptPayload(plaintext, pin);
    const b = await encryptPayload(plaintext, pin);
    expect(a).not.toBe(b);
  });

  it('throws DecryptionError on wrong PIN', async () => {
    const encrypted = await encryptPayload('secret data', '1111');
    await expect(decryptPayload(encrypted, '2222')).rejects.toThrow(DecryptionError);
  });

  it('throws DecryptionError on corrupted ciphertext', async () => {
    await expect(decryptPayload('not-valid-base64!!!', '1234')).rejects.toThrow(DecryptionError);
  });

  it('throws DecryptionError on truncated data', async () => {
    const short = btoa('abc');
    await expect(decryptPayload(short, '1234')).rejects.toThrow(DecryptionError);
  });
});

describe('generateChallenge', () => {
  it('returns 32 bytes', () => {
    const challenge = generateChallenge();
    expect(challenge).toBeInstanceOf(Uint8Array);
    expect(challenge.length).toBe(32);
  });
});

describe('bytesToHex / hexToBytes', () => {
  it('round-trips', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    const hex = bytesToHex(bytes);
    expect(hex).toBe('00017f80ff');
    expect(hexToBytes(hex)).toEqual(bytes);
  });
});

describe('computeChallengeResponse', () => {
  it('is deterministic for the same inputs', async () => {
    const challenge = new Uint8Array(32);
    challenge.fill(42);
    const pin = '5678';
    const a = await computeChallengeResponse(challenge, pin);
    const b = await computeChallengeResponse(challenge, pin);
    expect(a).toBe(b);
  });

  it('produces different output for different PINs', async () => {
    const challenge = new Uint8Array(32);
    challenge.fill(7);
    const a = await computeChallengeResponse(challenge, '1111');
    const b = await computeChallengeResponse(challenge, '2222');
    expect(a).not.toBe(b);
  });

  it('produces different output for different challenges', async () => {
    const pin = '9999';
    const c1 = new Uint8Array(32);
    c1.fill(1);
    const c2 = new Uint8Array(32);
    c2.fill(2);
    const a = await computeChallengeResponse(c1, pin);
    const b = await computeChallengeResponse(c2, pin);
    expect(a).not.toBe(b);
  });

  it('returns a 64-character hex string (SHA-256 = 32 bytes)', async () => {
    const challenge = generateChallenge();
    const response = await computeChallengeResponse(challenge, '1234');
    expect(response).toMatch(/^[0-9a-f]{64}$/);
  });
});
