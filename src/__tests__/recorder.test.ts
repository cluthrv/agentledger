import { createActionRecord, verifyActionRecord, verifyChain } from '../core/recorder';
import { ActionType, ActionRecordInput } from '../types';

const sampleInput: ActionRecordInput = {
  agentId: 'pricing-agent',
  actionType: ActionType.QUERY,
  input: { query: 'Get base price for SKU-1234' },
  output: { price: 149.99, currency: 'USD' },
  reasoning: 'Retrieved from CPQ price book',
};

describe('createActionRecord', () => {
  it('should create a record with all required fields', () => {
    const record = createActionRecord('session-1', sampleInput, 0, null);

    expect(record.id).toBeDefined();
    expect(record.sessionId).toBe('session-1');
    expect(record.sequenceNumber).toBe(0);
    expect(record.timestamp).toBeDefined();
    expect(record.agentId).toBe('pricing-agent');
    expect(record.actionType).toBe(ActionType.QUERY);
    expect(record.input).toEqual({ query: 'Get base price for SKU-1234' });
    expect(record.output).toEqual({ price: 149.99, currency: 'USD' });
    expect(record.reasoning).toBe('Retrieved from CPQ price book');
    expect(record.hash).toHaveLength(64);
    expect(record.previousHash).toBeNull();
  });

  it('should set previousHash from the prior record', () => {
    const first = createActionRecord('session-1', sampleInput, 0, null);
    const second = createActionRecord('session-1', sampleInput, 1, first.hash);

    expect(second.previousHash).toBe(first.hash);
    expect(second.sequenceNumber).toBe(1);
  });

  it('should produce unique IDs for each record', () => {
    const r1 = createActionRecord('session-1', sampleInput, 0, null);
    const r2 = createActionRecord('session-1', sampleInput, 1, r1.hash);
    expect(r1.id).not.toBe(r2.id);
  });

  it('should produce unique hashes for each record', () => {
    const r1 = createActionRecord('session-1', sampleInput, 0, null);
    const r2 = createActionRecord('session-1', sampleInput, 1, r1.hash);
    expect(r1.hash).not.toBe(r2.hash);
  });
});

describe('verifyActionRecord', () => {
  it('should return true for an unmodified record', () => {
    const record = createActionRecord('session-1', sampleInput, 0, null);
    expect(verifyActionRecord(record)).toBe(true);
  });

  it('should return false if the output is tampered with', () => {
    const record = createActionRecord('session-1', sampleInput, 0, null);
    const tampered = { ...record, output: { price: 0.01, currency: 'USD' } };
    expect(verifyActionRecord(tampered)).toBe(false);
  });

  it('should return false if the reasoning is tampered with', () => {
    const record = createActionRecord('session-1', sampleInput, 0, null);
    const tampered = { ...record, reasoning: 'Unauthorized override' };
    expect(verifyActionRecord(tampered)).toBe(false);
  });

  it('should return false if the agentId is tampered with', () => {
    const record = createActionRecord('session-1', sampleInput, 0, null);
    const tampered = { ...record, agentId: 'rogue-agent' };
    expect(verifyActionRecord(tampered)).toBe(false);
  });

  it('should return false if the timestamp is tampered with', () => {
    const record = createActionRecord('session-1', sampleInput, 0, null);
    const tampered = { ...record, timestamp: '2020-01-01T00:00:00.000Z' };
    expect(verifyActionRecord(tampered)).toBe(false);
  });
});

describe('verifyChain', () => {
  function buildChain(count: number): ReturnType<typeof createActionRecord>[] {
    const records: ReturnType<typeof createActionRecord>[] = [];
    for (let i = 0; i < count; i++) {
      const prev: string | null = i > 0 ? records[i - 1].hash : null;
      records.push(
        createActionRecord('session-1', {
          ...sampleInput,
          actionType: i % 2 === 0 ? ActionType.QUERY : ActionType.UPDATE,
        }, i, prev)
      );
    }
    return records;
  }

  it('should verify a valid chain of records', () => {
    const records = buildChain(5);
    const result = verifyChain(records);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should verify an empty chain', () => {
    const result = verifyChain([]);
    expect(result.valid).toBe(true);
  });

  it('should verify a single-record chain', () => {
    const records = buildChain(1);
    const result = verifyChain(records);
    expect(result.valid).toBe(true);
  });

  it('should detect a tampered record in the chain', () => {
    const records = buildChain(5);
    // Tamper with record 2
    records[2] = { ...records[2], output: { price: 0.01 } };

    const result = verifyChain(records);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Record 2'))).toBe(true);
  });

  it('should detect a broken chain link', () => {
    const records = buildChain(5);
    // Break the chain by modifying previousHash on record 3
    records[3] = { ...records[3], previousHash: 'fake-hash' };

    const result = verifyChain(records);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('chain is broken'))).toBe(true);
  });

  it('should detect incorrect first record previousHash', () => {
    const records = buildChain(3);
    records[0] = { ...records[0], previousHash: 'should-be-null' };

    const result = verifyChain(records);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('null previousHash'))).toBe(true);
  });

  it('should detect out-of-order sequence numbers', () => {
    const records = buildChain(3);
    records[1] = { ...records[1], sequenceNumber: 5 };

    const result = verifyChain(records);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('sequenceNumber'))).toBe(true);
  });

  it('should verify a longer chain (20 records)', () => {
    const records = buildChain(20);
    const result = verifyChain(records);
    expect(result.valid).toBe(true);
  });
});
