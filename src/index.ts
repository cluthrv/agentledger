/**
 * AgentLedger
 *
 * Cryptographic audit trails for AI agent operations.
 * Tamper-proof verification using hash chains and Merkle trees.
 *
 * @example
 * ```typescript
 * import { AgentLedgerSession, ActionType } from 'agentledger';
 *
 * const session = new AgentLedgerSession({ agentId: 'pricing-agent' });
 *
 * session.record({
 *   agentId: 'pricing-agent',
 *   actionType: ActionType.QUERY,
 *   input: { query: 'Get dealer pricing for SKU-1234' },
 *   output: { price: 149.99, currency: 'USD' },
 *   reasoning: 'Retrieved base price from CPQ price book',
 * });
 *
 * const sealed = session.seal();
 * const result = session.verify();
 * console.log(result.valid); // true
 * ```
 *
 * @packageDocumentation
 */

// Core session manager
export { AgentLedgerSession, SessionOptions } from './core/session';

// Types
export {
  ActionType,
  SessionStatus,
  ActionRecordInput,
  ActionRecord,
  AuditSession,
  MerkleNode,
  MerkleProof,
  VerificationResult,
  HashVersion,
  MerkleProofV2,
} from './types';

// Low-level utilities (for advanced usage)
export { sha256, hashActionRecord, hashActionRecordV2, RECORD_HASH_V2_TAG, combineHashes } from './core/hash';
export { canonicalJson } from './core/canonical';
export { createActionRecord, verifyActionRecord, verifyChain, recordHasher } from './core/recorder';
export {
  buildMerkleTree,
  computeMerkleRoot,
  generateMerkleProof,
  verifyMerkleProof,
  merkleLeafV2,
  merkleNodeV2,
  computeMerkleRootV2,
  generateMerkleProofV2,
  verifyMerkleProofV2,
} from './core/merkle';
