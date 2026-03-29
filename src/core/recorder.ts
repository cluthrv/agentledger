/**
 * Action Recorder
 *
 * Creates Action Records and maintains the hash chain within a session.
 * Each record's hash includes the previous record's hash, creating a
 * tamper-evident sequential chain.
 */

import { randomUUID } from 'crypto';
import { ActionRecord, ActionRecordInput } from '../types';
import { hashActionRecord } from './hash';

/**
 * Creates a new Action Record, computes its hash, and chains it
 * to the previous record in the session.
 *
 * @param sessionId - The session this record belongs to
 * @param input - The action details provided by the caller
 * @param sequenceNumber - Position in the session (0-indexed)
 * @param previousHash - Hash of the previous record (null for first)
 * @returns A complete, immutable Action Record with computed hash
 */
export function createActionRecord(
  sessionId: string,
  input: ActionRecordInput,
  sequenceNumber: number,
  previousHash: string | null
): ActionRecord {
  const id = randomUUID();
  const timestamp = new Date().toISOString();

  const hash = hashActionRecord({
    id,
    sessionId,
    sequenceNumber,
    timestamp,
    agentId: input.agentId,
    actionType: input.actionType,
    input: input.input,
    output: input.output,
    reasoning: input.reasoning,
    metadata: input.metadata,
    previousHash,
  });

  return {
    id,
    sessionId,
    sequenceNumber,
    timestamp,
    agentId: input.agentId,
    actionType: input.actionType,
    input: input.input,
    output: input.output,
    reasoning: input.reasoning,
    metadata: input.metadata,
    hash,
    previousHash,
  };
}

/**
 * Verify that an Action Record's hash is valid.
 *
 * Recomputes the hash from the record's fields and compares
 * it to the stored hash. Returns false if any field has been
 * modified after creation.
 */
export function verifyActionRecord(record: ActionRecord): boolean {
  const recomputed = hashActionRecord({
    id: record.id,
    sessionId: record.sessionId,
    sequenceNumber: record.sequenceNumber,
    timestamp: record.timestamp,
    agentId: record.agentId,
    actionType: record.actionType,
    input: record.input,
    output: record.output,
    reasoning: record.reasoning,
    metadata: record.metadata,
    previousHash: record.previousHash,
  });

  return recomputed === record.hash;
}

/**
 * Verify the integrity of an entire chain of Action Records.
 *
 * Checks that:
 * 1. Each record's hash is valid (content has not been modified)
 * 2. Each record's previousHash matches the prior record's hash
 * 3. Sequence numbers are contiguous starting from 0
 * 4. The first record's previousHash is null
 *
 * @returns An object with the overall result and any specific failures
 */
export function verifyChain(records: ActionRecord[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (records.length === 0) {
    return { valid: true, errors: [] };
  }

  // Check first record
  if (records[0].previousHash !== null) {
    errors.push('First record must have null previousHash');
  }

  if (records[0].sequenceNumber !== 0) {
    errors.push(`First record has sequenceNumber ${records[0].sequenceNumber}, expected 0`);
  }

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    // Verify sequence number
    if (record.sequenceNumber !== i) {
      errors.push(
        `Record ${i}: sequenceNumber is ${record.sequenceNumber}, expected ${i}`
      );
    }

    // Verify record hash integrity
    if (!verifyActionRecord(record)) {
      errors.push(
        `Record ${i} (${record.id}): hash verification failed — content may have been tampered with`
      );
    }

    // Verify chain linkage (skip first record)
    if (i > 0) {
      const previous = records[i - 1];
      if (record.previousHash !== previous.hash) {
        errors.push(
          `Record ${i} (${record.id}): previousHash does not match hash of record ${i - 1} — chain is broken`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
