/**
 * Hashing utilities for AgentLedger.
 *
 * All cryptographic operations use SHA-256 via Node.js built-in crypto module.
 * No external dependencies required.
 */

import { createHash } from 'crypto';

/**
 * Compute SHA-256 hash of an arbitrary string.
 */
export function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Compute the hash of an Action Record's content fields.
 *
 * The hash covers all content fields in a deterministic order,
 * plus the previous record's hash, creating the chain linkage.
 *
 * Field ordering is fixed to ensure identical inputs always produce
 * identical hashes regardless of object property ordering.
 */
export function hashActionRecord(fields: {
  id: string;
  sessionId: string;
  sequenceNumber: number;
  timestamp: string;
  agentId: string;
  actionType: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  reasoning?: string;
  metadata?: Record<string, unknown>;
  previousHash: string | null;
}): string {
  // Deterministic serialization: fixed field order, sorted object keys
  const canonical = JSON.stringify([
    fields.id,
    fields.sessionId,
    fields.sequenceNumber,
    fields.timestamp,
    fields.agentId,
    fields.actionType,
    sortedStringify(fields.input),
    sortedStringify(fields.output),
    fields.reasoning ?? '',
    fields.metadata ? sortedStringify(fields.metadata) : '',
    fields.previousHash ?? '',
  ]);

  return sha256(canonical);
}

/**
 * Combine two hashes for Merkle tree construction.
 * Concatenates left + right and hashes the result.
 */
export function combineHashes(left: string, right: string): string {
  return sha256(left + right);
}

/**
 * Deterministic JSON serialization with sorted keys.
 * Ensures the same object always produces the same string
 * regardless of property insertion order.
 */
function sortedStringify(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}
