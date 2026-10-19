import { canonicalJson } from '../core/canonical';
import { hashActionRecord, hashActionRecordV2, sha256, RECORD_HASH_V2_TAG } from '../core/hash';
import {
  computeMerkleRoot,
  computeMerkleRootV2,
  generateMerkleProofV2,
  merkleLeafV2,
  merkleNodeV2,
  verifyMerkleProofV2,
} from '../core/merkle';
import { AgentLedgerSession } from '../core/session';
import { ActionType } from '../types';

const record = () => ({
  id: 'r1',
  sessionId: 's1',
  sequenceNumber: 7,
  timestamp: '2026-10-19T00:00:00.000Z',
  agentId: 'credit-agent',
  actionType: 'tool_call',
  input: { tool: 'create_credit_line', args: { customerId: 'MER-100', amount: 2400000 } },
  output: { creditLineId: 'CL-5678', status: 'active' },
  metadata: { tool: 'create_credit_line', serverReceipt: { signature: 'sig' } },
  previousHash: 'ab'.repeat(32),
});

describe('canonicalJson', () => {
  it('sorts keys at every depth and drops undefined members', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] }, u: undefined })).toBe(
      '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}'
    );
  });

  it('formats numbers as ECMAScript does (RFC 8785)', () => {
    expect(canonicalJson([1e21, 1e-7, 0.1, -0, 2400000, 1.5, 123456789012345680000])).toBe(
      '[1e+21,1e-7,0.1,0,2400000,1.5,123456789012345680000]'
    );
  });

  it('escapes strings as JSON.stringify does', () => {
    expect(canonicalJson('a"b\\c\n\u0001é')).toBe('"a\\"b\\\\c\\n\\u0001é"');
  });

  it('sorts keys by UTF-16 code units', () => {
    expect(canonicalJson({ b: 1, B: 2, é: 3, a: 4 })).toBe('{"B":2,"a":4,"b":1,"é":3}');
  });

  it('serializes undefined array elements as null', () => {
    expect(canonicalJson([1, undefined, 2])).toBe('[1,null,2]');
  });

  it('rejects non-finite numbers and unsupported types', () => {
    expect(() => canonicalJson(NaN)).toThrow();
    expect(() => canonicalJson(Infinity)).toThrow();
    expect(() => canonicalJson(() => 1)).toThrow();
  });
});

describe('hashActionRecordV2', () => {
  it('detects a change to a nested field', () => {
    const edited = record();
    edited.input.args.amount = 240000;
    expect(hashActionRecordV2(edited)).not.toBe(hashActionRecordV2(record()));
  });

  it('detects a change inside nested metadata', () => {
    const edited = record();
    edited.metadata.serverReceipt.signature = 'forged';
    expect(hashActionRecordV2(edited)).not.toBe(hashActionRecordV2(record()));
  });

  it('does not depend on key order', () => {
    const r = record();
    const reordered = { ...r, input: { args: { amount: 2400000, customerId: 'MER-100' }, tool: 'create_credit_line' } };
    expect(hashActionRecordV2(reordered)).toBe(hashActionRecordV2(r));
  });

  it('is domain-separated', () => {
    const r = record();
    const { metadata, ...rest } = r;
    const plain = sha256(canonicalJson({ ...rest, metadata }));
    expect(hashActionRecordV2(r)).not.toBe(plain);
    expect(RECORD_HASH_V2_TAG).toBe('agentledger/record-hash/v2\n');
  });

  it('treats null and undefined optional fields the same', () => {
    const base = { ...record(), agentId: undefined, reasoning: undefined, metadata: undefined };
    const withNulls = { ...record(), agentId: null, reasoning: null, metadata: null };
    expect(hashActionRecordV2(withNulls)).toBe(hashActionRecordV2(base));
  });

  it('leaves v1 unchanged: v1 still ignores nested-only changes', () => {
    const edited = record();
    edited.input.args.amount = 240000;
    expect(hashActionRecord(edited)).toBe(hashActionRecord(record()));
  });
});

describe('Merkle v2', () => {
  const hashes = Array.from({ length: 9 }, (_, i) => sha256('record-' + i));

  it('returns null for no records and the leaf hash for one', () => {
    expect(computeMerkleRootV2([])).toBeNull();
    expect(computeMerkleRootV2([hashes[0]])).toBe(merkleLeafV2(hashes[0]));
  });

  it('carries an odd node up instead of duplicating it', () => {
    const [a, b, c] = hashes.map(merkleLeafV2);
    expect(computeMerkleRootV2(hashes.slice(0, 3))).toBe(merkleNodeV2(merkleNodeV2(a, b), c));
  });

  it('separates leaves from nodes', () => {
    expect(merkleLeafV2(hashes[0])).not.toBe(sha256(hashes[0]));
    expect(computeMerkleRootV2(hashes.slice(0, 2))).not.toBe(computeMerkleRoot(hashes.slice(0, 2)));
  });

  it('proves every record for every size from 1 to 9', () => {
    for (let n = 1; n <= 9; n++) {
      const set = hashes.slice(0, n);
      const root = computeMerkleRootV2(set);
      for (let i = 0; i < n; i++) {
        const proof = generateMerkleProofV2(set, i)!;
        expect(proof.root).toBe(root);
        expect(verifyMerkleProofV2(proof)).toBe(true);
        expect(proof.siblings.length).toBeLessThanOrEqual(Math.ceil(Math.log2(n)));
      }
    }
  });

  it('rejects a proof for a different record, a bad index, and bad hashes', () => {
    const proof = generateMerkleProofV2(hashes, 4)!;
    expect(verifyMerkleProofV2({ ...proof, recordHash: hashes[5] })).toBe(false);
    expect(verifyMerkleProofV2({ ...proof, recordHash: 'not-hex' })).toBe(false);
    expect(generateMerkleProofV2(hashes, 9)).toBeNull();
    expect(generateMerkleProofV2(hashes, -1)).toBeNull();
    expect(() => merkleLeafV2('abc')).toThrow();
  });
});

describe('AgentLedgerSession with canonicalization v2', () => {
  const run = (version?: 'v1' | 'v2') => {
    const session = new AgentLedgerSession({ agentId: 'credit-agent', canonicalization: version });
    session.record({ agentId: 'credit-agent', actionType: ActionType.DECISION, input: {}, output: {}, reasoning: 'Recommend DECLINE' });
    session.record({
      agentId: 'credit-agent',
      actionType: ActionType.TOOL_CALL,
      input: { tool: 'create_credit_line', args: { customerId: 'MER-100', amount: 2400000 } },
      output: { creditLineId: 'CL-5678' },
    });
    session.seal();
    return session;
  };

  it('seals with a v2 root and verifies', () => {
    const session = run('v2');
    const exp = session.export();
    expect(session.getHashVersion()).toBe('v2');
    expect(exp.session.canonicalization).toBe('v2');
    expect(exp.session.merkle).toBe('v2');
    expect(exp.session.merkleRoot).toBe(computeMerkleRootV2(exp.records.map((r) => r.hash)));
    expect(session.verify().valid).toBe(true);
  });

  it('detects a nested argument edit under v2', () => {
    const session = run('v2');
    (session.getRecord(1)!.input.args as Record<string, unknown>).amount = 240000;
    const result = session.verify();
    expect(result.valid).toBe(false);
    expect(result.checks.find((c) => c.name === 'hash_chain_integrity')!.passed).toBe(false);
  });

  it('keeps v1 as the default, with v1 behavior unchanged', () => {
    const session = run();
    const exp = session.export();
    expect(session.getHashVersion()).toBe('v1');
    expect(exp.session.canonicalization).toBeUndefined();
    expect(exp.session.merkleRoot).toBe(computeMerkleRoot(exp.records.map((r) => r.hash)));
    (session.getRecord(1)!.input.args as Record<string, unknown>).amount = 240000;
    expect(session.verify().valid).toBe(true); // the documented v1 limitation
  });

  it('generates and verifies v2 proofs', () => {
    const session = run('v2');
    const proof = session.proveRecord(1)!;
    expect(session.verifyProof(proof)).toBe(true);
    expect(session.verifyProof({ ...proof, recordHash: session.getRecord(0)!.hash })).toBe(false);
  });
});
