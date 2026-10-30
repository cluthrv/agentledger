import { canonicalJson, toJSONValue } from '../core/canonical';
import { hashActionRecord, hashActionRecordV2 } from '../core/hash';
import { createActionRecord } from '../core/recorder';
import { AgentLedgerSession } from '../core/session';
import { verifyExportedSession, ExportedSession } from '../core/verify';
import { ActionType, HashVersion } from '../types';

const saveAndLoad = (s: AgentLedgerSession): ExportedSession => JSON.parse(JSON.stringify(s.export()));

const runWith = (version: HashVersion, output: Record<string, unknown>) => {
  const s = new AgentLedgerSession({ agentId: 'a', canonicalization: version });
  s.record({ agentId: 'a', actionType: ActionType.QUERY, input: {}, output });
  s.seal();
  return s;
};

describe('toJSONValue', () => {
  it('reduces values the way JSON.stringify does', () => {
    const value = {
      at: new Date('2026-10-30T12:00:00Z'),
      gone: undefined,
      fn: () => 1,
      list: [1, undefined, () => 2],
      map: new Map([['k', 1]]),
      custom: { toJSON: () => 'custom' },
      nested: { n: NaN },
    };
    expect(toJSONValue(value)).toEqual(JSON.parse(JSON.stringify(value)));
  });

  it('returns a copy that shares nothing with the input', () => {
    const input = { args: { amount: 1 } };
    const copy = toJSONValue(input) as typeof input;
    input.args.amount = 2;
    expect(copy.args.amount).toBe(1);
  });

  it('rejects non-finite numbers when strict, and names the path', () => {
    expect(() => toJSONValue({ a: { b: [1, Infinity] } }, { strictNumbers: true })).toThrow('$.a.b[1]');
  });

  it('rejects circular references with a clear message', () => {
    const c: Record<string, unknown> = { x: 1 };
    c.self = c;
    expect(() => toJSONValue({ c })).toThrow('circular reference at $.c.self');
    expect(() => canonicalJson(c)).toThrow('canonicalJson: cannot serialize a circular reference');
  });

  it('allows the same object twice when it is not circular', () => {
    const shared = { v: 1 };
    expect(toJSONValue({ a: shared, b: shared })).toEqual({ a: { v: 1 }, b: { v: 1 } });
  });

  it('rejects bigint', () => {
    expect(() => toJSONValue({ n: BigInt(10) })).toThrow('bigint at $.n');
  });
});

describe('Dates and other toJSON values', () => {
  const base = {
    id: 'r', sessionId: 's', sequenceNumber: 0, timestamp: 't', agentId: 'a',
    actionType: 'query', input: {}, previousHash: null,
  };

  it('v2 hashes a Date by its value', () => {
    const a = hashActionRecordV2({ ...base, output: { at: new Date('2026-10-30T12:00:00Z') } });
    const b = hashActionRecordV2({ ...base, output: { at: new Date('1999-01-01T00:00:00Z') } });
    const asString = hashActionRecordV2({ ...base, output: { at: '2026-10-30T12:00:00.000Z' } });
    expect(a).not.toBe(b);
    expect(a).toBe(asString);
  });

  it('stores a Date as its ISO string, as a saved file holds it', () => {
    const s = runWith('v2', { at: new Date('2026-10-30T12:00:00Z') });
    expect(s.getRecord(0)!.output.at).toBe('2026-10-30T12:00:00.000Z');
  });

  it.each(['v1', 'v2'] as const)('a %s session with a Date verifies after save and reload', (version) => {
    const s = runWith(version, { at: new Date('2026-10-30T12:00:00Z'), when: { start: new Date(0) } });
    expect(s.verify().valid).toBe(true);
    expect(verifyExportedSession(saveAndLoad(s)).valid).toBe(true);
  });
});

describe('records are isolated from the caller', () => {
  it('ignores changes the caller makes to its own objects after record()', () => {
    const s = new AgentLedgerSession({ agentId: 'a', canonicalization: 'v2' });
    const args = { customerId: 'MER-100', amount: 2400000 };
    const output = { status: 'active' };
    s.record({ agentId: 'a', actionType: ActionType.TOOL_CALL, input: { tool: 't', args }, output });
    args.amount = 1;
    output.status = 'changed';
    s.seal();
    expect(s.verify().valid).toBe(true);
    expect((s.getRecord(0)!.input.args as typeof args).amount).toBe(2400000);
    expect(verifyExportedSession(saveAndLoad(s)).valid).toBe(true);
  });

  it('ignores changes made to records it returned', () => {
    const s = new AgentLedgerSession({ agentId: 'a', canonicalization: 'v2' });
    const returned = s.record({ agentId: 'a', actionType: ActionType.QUERY, input: {}, output: { v: 1 } });
    returned.output.v = 2;
    s.getRecord(0)!.output.v = 3;
    s.getRecords()[0]!.output.v = 4;
    s.export().records[0]!.output.v = 5;
    s.seal();
    expect(s.verify().valid).toBe(true);
    expect(s.getRecord(0)!.output.v).toBe(1);
  });

  it('rejects NaN under v2 and keeps v1 turning it into null', () => {
    expect(() => runWith('v2', { x: NaN })).toThrow('non-finite number NaN at $.x');
    const v1 = runWith('v1', { x: NaN });
    expect(v1.getRecord(0)!.output.x).toBeNull();
    expect(verifyExportedSession(saveAndLoad(v1)).valid).toBe(true);
  });

  it('leaves the hash of plain JSON content unchanged by the copy', () => {
    const fields = {
      agentId: 'a', actionType: ActionType.TOOL_CALL,
      input: { tool: 't', args: { a: 1, b: [1, 'x', null], c: { d: true } } },
      output: { ok: true }, metadata: { m: 1 },
    };
    for (const version of ['v1', 'v2'] as const) {
      const r = createActionRecord('s', fields, 0, null, version);
      const hasher = version === 'v2' ? hashActionRecordV2 : hashActionRecord;
      expect(r.hash).toBe(hasher({ ...r, input: fields.input, output: fields.output, metadata: fields.metadata }));
    }
  });
});

describe('verifyExportedSession', () => {
  const sealed = (version: HashVersion) => {
    const s = new AgentLedgerSession({ agentId: 'a', canonicalization: version });
    s.record({ agentId: 'a', actionType: ActionType.DECISION, input: {}, output: {}, reasoning: 'Recommend DECLINE' });
    s.record({ agentId: 'a', actionType: ActionType.TOOL_CALL, input: { tool: 'create_credit_line', args: { amount: 2400000 } }, output: { id: 'CL-1' } });
    s.record({ agentId: 'a', actionType: ActionType.QUERY, input: {}, output: { done: true } });
    s.seal();
    return saveAndLoad(s);
  };
  const failed = (doc: ExportedSession) => verifyExportedSession(doc).checks.filter((c) => !c.passed).map((c) => c.name);

  it.each(['v1', 'v2'] as const)('verifies a saved %s session', (version) => {
    const result = verifyExportedSession(sealed(version));
    expect(result.valid).toBe(true);
    expect(result.checks.map((c) => c.name)).toEqual(['hash_version', 'hash_chain_integrity', 'session_consistency', 'merkle_root_integrity']);
  });

  it('catches a nested argument edit (v2)', () => {
    const doc = sealed('v2');
    (doc.records[1]!.input.args as Record<string, unknown>).amount = 240000;
    expect(failed(doc)).toEqual(['hash_chain_integrity']);
  });

  it('catches a removed record', () => {
    const doc = sealed('v2');
    doc.records.splice(1, 1);
    expect(failed(doc)).toEqual(expect.arrayContaining(['hash_chain_integrity', 'session_consistency', 'merkle_root_integrity']));
  });

  it('catches a re-hashed edit through the root', () => {
    const doc = sealed('v2');
    doc.session.merkleRoot = 'ab'.repeat(32);
    expect(failed(doc)).toEqual(['merkle_root_integrity']);
  });

  it('catches a record from another session', () => {
    const doc = sealed('v2');
    doc.records[2]!.sessionId = 'someone-else';
    expect(failed(doc)).toEqual(expect.arrayContaining(['session_consistency']));
  });

  it('rejects a v2 session relabelled as v1, and mixed versions', () => {
    const relabelled = sealed('v2');
    delete relabelled.session.canonicalization;
    delete relabelled.session.merkle;
    expect(verifyExportedSession(relabelled).valid).toBe(false);

    const mixed = sealed('v2');
    mixed.session.merkle = 'v1';
    expect(failed(mixed)).toContain('hash_version');

    const conflicting = sealed('v2');
    conflicting.canonicalization = 'v1';
    expect(failed(conflicting)).toContain('hash_version');
  });

  it('accepts the versions at the top level, as the MCP demo writes them', () => {
    const doc = sealed('v2');
    delete doc.session.canonicalization;
    delete doc.session.merkle;
    doc.canonicalization = 'v2';
    doc.merkle = 'v2';
    expect(verifyExportedSession(doc).valid).toBe(true);
  });

  it('verifies an unsealed export by its chain alone', () => {
    const s = new AgentLedgerSession({ agentId: 'a' });
    s.record({ agentId: 'a', actionType: ActionType.QUERY, input: {}, output: {} });
    const result = verifyExportedSession(saveAndLoad(s));
    expect(result.valid).toBe(true);
    expect(result.checks.find((c) => c.name === 'merkle_root_integrity')).toBeUndefined();
  });

  it('rejects something that is not an exported session', () => {
    expect(verifyExportedSession({} as ExportedSession).valid).toBe(false);
    expect(verifyExportedSession(null as unknown as ExportedSession).checks[0]!.name).toBe('document_shape');
  });
});
