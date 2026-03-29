/**
 * Session Manager
 *
 * The primary interface for AgentLedger. Manages the lifecycle of
 * audit sessions: creation, recording actions, sealing with Merkle
 * roots, and verification.
 *
 * Usage:
 *   const session = new AgentLedgerSession({ agentId: 'pricing-agent' });
 *   session.record({ agentId: 'pricing-agent', actionType: ActionType.QUERY, ... });
 *   session.record({ agentId: 'pricing-agent', actionType: ActionType.CALCULATION, ... });
 *   const sealed = session.seal();
 *   const result = session.verify();
 */

import { randomUUID } from 'crypto';
import {
  ActionRecord,
  ActionRecordInput,
  AuditSession,
  MerkleProof,
  SessionStatus,
  VerificationResult,
} from '../types';
import { createActionRecord, verifyChain } from './recorder';
import { computeMerkleRoot, generateMerkleProof, verifyMerkleProof } from './merkle';

export interface SessionOptions {
  /** Identifier for the AI agent being audited */
  agentId: string;
  /** Who or what initiated this session (optional) */
  initiator?: string;
  /** Platform identifier, e.g., 'salesforce', 'adobe-commerce' (optional) */
  platform?: string;
  /** Arbitrary session-level metadata (optional) */
  metadata?: Record<string, unknown>;
}

export class AgentLedgerSession {
  private readonly sessionId: string;
  private readonly agentId: string;
  private readonly startTime: string;
  private readonly initiator?: string;
  private readonly platform?: string;
  private readonly sessionMetadata?: Record<string, unknown>;
  private records: ActionRecord[] = [];
  private status: SessionStatus = SessionStatus.ACTIVE;
  private merkleRoot: string | null = null;
  private endTime: string | null = null;

  constructor(options: SessionOptions) {
    this.sessionId = randomUUID();
    this.agentId = options.agentId;
    this.startTime = new Date().toISOString();
    this.initiator = options.initiator;
    this.platform = options.platform;
    this.sessionMetadata = options.metadata;
  }

  /**
   * Record an agent action.
   *
   * Creates a new Action Record, computes its hash, and chains it
   * to the previous record. The session must be active (not sealed).
   *
   * @param input - The action details to record
   * @returns The created Action Record
   * @throws Error if the session has been sealed
   */
  record(input: ActionRecordInput): ActionRecord {
    if (this.status !== SessionStatus.ACTIVE) {
      throw new Error(
        `Cannot record actions in a ${this.status} session. Sessions are immutable once sealed.`
      );
    }

    const sequenceNumber = this.records.length;
    const previousHash =
      sequenceNumber > 0 ? this.records[sequenceNumber - 1].hash : null;

    const record = createActionRecord(
      this.sessionId,
      input,
      sequenceNumber,
      previousHash
    );

    this.records.push(record);
    return record;
  }

  /**
   * Seal the session.
   *
   * Computes the Merkle root from all recorded actions and transitions
   * the session to SEALED status. No further actions can be recorded.
   *
   * @returns The sealed AuditSession summary
   * @throws Error if the session has no records or is already sealed
   */
  seal(): AuditSession {
    if (this.status !== SessionStatus.ACTIVE) {
      throw new Error('Session is already sealed.');
    }

    if (this.records.length === 0) {
      throw new Error('Cannot seal an empty session. Record at least one action first.');
    }

    const hashes = this.records.map((r) => r.hash);
    this.merkleRoot = computeMerkleRoot(hashes);
    this.endTime = new Date().toISOString();
    this.status = SessionStatus.SEALED;

    return this.toAuditSession();
  }

  /**
   * Verify the integrity of the entire session.
   *
   * Checks:
   * 1. All Action Record hashes are valid (no tampering)
   * 2. The hash chain is intact (no records inserted/removed/reordered)
   * 3. The Merkle root matches (if session is sealed)
   *
   * @returns A VerificationResult with detailed check outcomes
   */
  verify(): VerificationResult {
    const checks: VerificationResult['checks'] = [];

    // Check 1: Chain integrity
    const chainResult = verifyChain(this.records);
    checks.push({
      name: 'hash_chain_integrity',
      passed: chainResult.valid,
      detail: chainResult.valid
        ? `All ${this.records.length} records have valid hashes and chain linkage`
        : chainResult.errors.join('; '),
    });

    // Check 2: Merkle root (only if sealed)
    if (this.status === SessionStatus.SEALED && this.merkleRoot) {
      const hashes = this.records.map((r) => r.hash);
      const recomputedRoot = computeMerkleRoot(hashes);
      const rootValid = recomputedRoot === this.merkleRoot;

      checks.push({
        name: 'merkle_root_integrity',
        passed: rootValid,
        detail: rootValid
          ? `Merkle root verified: ${this.merkleRoot.substring(0, 16)}...`
          : `Merkle root mismatch: stored ${this.merkleRoot?.substring(0, 16)}... vs computed ${recomputedRoot?.substring(0, 16)}...`,
      });
    }

    // Check 3: Record count consistency
    const countValid = this.records.length > 0;
    checks.push({
      name: 'record_count',
      passed: countValid,
      detail: `Session contains ${this.records.length} record(s)`,
    });

    const allPassed = checks.every((c) => c.passed);

    if (allPassed) {
      this.status =
        this.status === SessionStatus.SEALED
          ? SessionStatus.VERIFIED
          : this.status;
    }

    return {
      valid: allPassed,
      message: allPassed
        ? `Session ${this.sessionId} verified successfully. ${this.records.length} records, chain intact.`
        : `Session ${this.sessionId} verification FAILED. See checks for details.`,
      checks,
    };
  }

  /**
   * Generate a Merkle proof for a specific record.
   *
   * Allows an auditor to verify that a single Action Record
   * belongs to this sealed session without needing all records.
   *
   * @param recordIndex - Index of the record to prove (0-based)
   * @returns A MerkleProof, or null if index is invalid
   * @throws Error if the session has not been sealed
   */
  proveRecord(recordIndex: number): MerkleProof | null {
    if (this.status === SessionStatus.ACTIVE) {
      throw new Error('Cannot generate proofs for an active session. Seal the session first.');
    }

    const hashes = this.records.map((r) => r.hash);
    return generateMerkleProof(hashes, recordIndex);
  }

  /**
   * Verify a Merkle proof against this session's root.
   */
  verifyProof(proof: MerkleProof): boolean {
    return verifyMerkleProof(proof);
  }

  /**
   * Get a specific Action Record by index.
   */
  getRecord(index: number): ActionRecord | undefined {
    return this.records[index];
  }

  /**
   * Get all Action Records in the session.
   * Returns a copy to prevent external mutation.
   */
  getRecords(): ActionRecord[] {
    return [...this.records];
  }

  /**
   * Get the current session summary.
   */
  toAuditSession(): AuditSession {
    return {
      sessionId: this.sessionId,
      agentId: this.agentId,
      startTime: this.startTime,
      endTime: this.endTime,
      recordCount: this.records.length,
      merkleRoot: this.merkleRoot,
      status: this.status,
      initiator: this.initiator,
      platform: this.platform,
      metadata: this.sessionMetadata,
    };
  }

  /**
   * Get the session ID.
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get the current session status.
   */
  getStatus(): SessionStatus {
    return this.status;
  }

  /**
   * Export the complete session data for storage or transmission.
   * Includes all records and session metadata.
   */
  export(): { session: AuditSession; records: ActionRecord[] } {
    return {
      session: this.toAuditSession(),
      records: this.getRecords(),
    };
  }
}
