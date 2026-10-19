/**
 * Hashing utilities for AgentLedger.
 *
 * All cryptographic operations use SHA-256 via Node.js built-in crypto module.
 * No external dependencies required.
 */

import { createHash } from 'crypto';
import { canonicalJson } from './canonical';

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

/** Domain tag prefixed to the canonical record before hashing (v2). */
export const RECORD_HASH_V2_TAG = 'agentledger/record-hash/v2\n';

/**
 * Compute the v2 hash of an Action Record.
 *
 * sha256("agentledger/record-hash/v2\n" + canonicalJson(content)), where
 * content holds every content field and canonicalJson sorts keys at every
 * depth (RFC 8785). Unlike v1, nested values such as a tool call's arguments
 * are covered. agentId, reasoning and metadata are omitted when null or
 * undefined; previousHash is always present (null for the first record).
 */
export function hashActionRecordV2(fields: {
  id: string;
  sessionId: string;
  sequenceNumber: number;
  timestamp: string;
  agentId?: string | null;
  actionType: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  reasoning?: string | null;
  metadata?: Record<string, unknown> | null;
  previousHash: string | null;
}): string {
  const content = {
    id: fields.id,
    sessionId: fields.sessionId,
    sequenceNumber: fields.sequenceNumber,
    timestamp: fields.timestamp,
    agentId: fields.agentId ?? undefined,
    actionType: fields.actionType,
    input: fields.input,
    output: fields.output,
    reasoning: fields.reasoning ?? undefined,
    metadata: fields.metadata ?? undefined,
    previousHash: fields.previousHash ?? null,
  };
  return sha256(RECORD_HASH_V2_TAG + canonicalJson(content));
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
