import { sha256, hashActionRecord, combineHashes } from '../core/hash';

describe('sha256', () => {
  it('should produce a 64-character hex string', () => {
    const hash = sha256('hello');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should be deterministic', () => {
    const hash1 = sha256('test-data');
    const hash2 = sha256('test-data');
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different inputs', () => {
    const hash1 = sha256('input-a');
    const hash2 = sha256('input-b');
    expect(hash1).not.toBe(hash2);
  });

  it('should handle empty string', () => {
    const hash = sha256('');
    expect(hash).toHaveLength(64);
  });

  it('should handle unicode characters', () => {
    const hash = sha256('こんにちは世界');
    expect(hash).toHaveLength(64);
  });
});

describe('hashActionRecord', () => {
  const baseFields = {
    id: 'record-001',
    sessionId: 'session-001',
    sequenceNumber: 0,
    timestamp: '2026-03-29T10:00:00.000Z',
    agentId: 'test-agent',
    actionType: 'query',
    input: { query: 'get price' },
    output: { price: 100 },
    previousHash: null,
  };

  it('should produce a valid SHA-256 hash', () => {
    const hash = hashActionRecord(baseFields);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should be deterministic for identical inputs', () => {
    const hash1 = hashActionRecord(baseFields);
    const hash2 = hashActionRecord(baseFields);
    expect(hash1).toBe(hash2);
  });

  it('should change when any field changes', () => {
    const original = hashActionRecord(baseFields);

    // Change each field and verify the hash changes
    const fieldsToTest = [
      { ...baseFields, id: 'record-002' },
      { ...baseFields, sessionId: 'session-002' },
      { ...baseFields, sequenceNumber: 1 },
      { ...baseFields, timestamp: '2026-03-29T11:00:00.000Z' },
      { ...baseFields, agentId: 'other-agent' },
      { ...baseFields, actionType: 'update' },
      { ...baseFields, input: { query: 'get discount' } },
      { ...baseFields, output: { price: 200 } },
      { ...baseFields, previousHash: 'abc123' },
    ];

    for (const modified of fieldsToTest) {
      expect(hashActionRecord(modified)).not.toBe(original);
    }
  });

  it('should produce consistent hashes regardless of object key order', () => {
    const hash1 = hashActionRecord({
      ...baseFields,
      input: { a: 1, b: 2, c: 3 },
    });
    const hash2 = hashActionRecord({
      ...baseFields,
      input: { c: 3, a: 1, b: 2 },
    });
    expect(hash1).toBe(hash2);
  });

  it('should handle optional fields', () => {
    const withReasoning = hashActionRecord({
      ...baseFields,
      reasoning: 'some reasoning',
    });
    const withoutReasoning = hashActionRecord(baseFields);
    expect(withReasoning).not.toBe(withoutReasoning);
  });

  it('should include previousHash in computation', () => {
    const withPrev = hashActionRecord({
      ...baseFields,
      previousHash: 'abc123def456',
    });
    const withoutPrev = hashActionRecord({
      ...baseFields,
      previousHash: null,
    });
    expect(withPrev).not.toBe(withoutPrev);
  });
});

describe('combineHashes', () => {
  it('should produce a valid hash', () => {
    const result = combineHashes('aaa', 'bbb');
    expect(result).toHaveLength(64);
  });

  it('should be order-dependent', () => {
    const ab = combineHashes('hash-a', 'hash-b');
    const ba = combineHashes('hash-b', 'hash-a');
    expect(ab).not.toBe(ba);
  });

  it('should be deterministic', () => {
    const r1 = combineHashes('left', 'right');
    const r2 = combineHashes('left', 'right');
    expect(r1).toBe(r2);
  });
});
