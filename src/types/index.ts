/**
 * AgentLedger Type Definitions
 *
 * Core data structures for cryptographic audit trails
 * of AI agent operations in enterprise platforms.
 */

/**
 * The types of actions an AI agent can perform.
 * Covers the full spectrum of enterprise CRM/CPQ/Commerce operations.
 */
export enum ActionType {
  /** Agent reads or retrieves data */
  QUERY = 'query',
  /** Agent modifies existing records */
  UPDATE = 'update',
  /** Agent creates new records */
  CREATE = 'create',
  /** Agent removes records */
  DELETE = 'delete',
  /** Agent makes a decision or selects a path */
  DECISION = 'decision',
  /** Agent escalates to a human operator */
  ESCALATION = 'escalation',
  /** Agent invokes an external tool or API */
  TOOL_CALL = 'tool_call',
  /** Agent performs a calculation (e.g., pricing, discount) */
  CALCULATION = 'calculation',
  /** Agent validates data against rules or policies */
  VALIDATION = 'validation',
}

/**
 * The lifecycle states of an audit session.
 */
export enum SessionStatus {
  /** Session is actively recording agent actions */
  ACTIVE = 'active',
  /** Session has been cryptographically sealed with a Merkle root */
  SEALED = 'sealed',
  /** Session seal has been independently verified */
  VERIFIED = 'verified',
}

/**
 * Input parameters for creating an Action Record.
 * This is what the caller provides; AgentLedger computes the rest.
 */
export interface ActionRecordInput {
  /** Identifier for the AI agent performing the action */
  agentId: string;
  /** Type of action being performed */
  actionType: ActionType;
  /** The input or context provided to the agent for this action */
  input: Record<string, unknown>;
  /** The output or result produced by the agent */
  output: Record<string, unknown>;
  /** The agent's reasoning or explanation for this action (optional but recommended) */
  reasoning?: string;
  /** Arbitrary metadata for platform-specific context */
  metadata?: Record<string, unknown>;
}

/**
 * A complete Action Record with cryptographic fields computed by AgentLedger.
 *
 * Once created, an Action Record is immutable. Its hash includes the hash
 * of the previous record in the chain, creating a tamper-evident sequence.
 */
export interface ActionRecord {
  /** Unique identifier for this record (UUID v4) */
  id: string;
  /** Session this record belongs to */
  sessionId: string;
  /** Position in the session's action sequence (0-indexed) */
  sequenceNumber: number;
  /** UTC timestamp when this record was created */
  timestamp: string;
  /** Identifier for the AI agent */
  agentId: string;
  /** Type of action performed */
  actionType: ActionType;
  /** Input context provided to the agent */
  input: Record<string, unknown>;
  /** Output produced by the agent */
  output: Record<string, unknown>;
  /** Agent's reasoning or explanation */
  reasoning?: string;
  /** Platform-specific metadata */
  metadata?: Record<string, unknown>;
  /** SHA-256 hash of this record's content + previous hash */
  hash: string;
  /** Hash of the previous record in the chain (null for first record) */
  previousHash: string | null;
}

/**
 * A node in the Merkle tree built from Action Records.
 */
export interface MerkleNode {
  /** SHA-256 hash value of this node */
  hash: string;
  /** Left child node (null for leaf nodes) */
  left: MerkleNode | null;
  /** Right child node (null for leaf nodes) */
  right: MerkleNode | null;
  /** Index of the Action Record (only present on leaf nodes) */
  recordIndex?: number;
}

/**
 * A Merkle proof for verifying a single Action Record against the root.
 * Contains the sibling hashes needed to recompute the root from a leaf.
 */
export interface MerkleProof {
  /** Index of the record being verified */
  recordIndex: number;
  /** Hash of the record (leaf hash) */
  recordHash: string;
  /** Sibling hashes from leaf to root, with position indicators */
  siblings: Array<{
    hash: string;
    position: 'left' | 'right';
  }>;
  /** The Merkle root this proof should resolve to */
  root: string;
}

/**
 * A sealed audit session containing the complete cryptographic summary.
 */
export interface AuditSession {
  /** Unique session identifier (UUID v4) */
  sessionId: string;
  /** Identifier for the AI agent */
  agentId: string;
  /** UTC timestamp when the session started */
  startTime: string;
  /** UTC timestamp when the session was sealed (null if active) */
  endTime: string | null;
  /** Total number of Action Records in this session */
  recordCount: number;
  /** Merkle root hash (null if session is still active) */
  merkleRoot: string | null;
  /** Current session lifecycle state */
  status: SessionStatus;
  /** Optional context about who or what initiated this session */
  initiator?: string;
  /** Optional platform identifier (e.g., 'salesforce', 'adobe-commerce') */
  platform?: string;
  /** Arbitrary session-level metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of a verification operation.
 */
export interface VerificationResult {
  /** Whether the verification passed */
  valid: boolean;
  /** Human-readable description of the verification outcome */
  message: string;
  /** Specific checks performed and their results */
  checks: Array<{
    name: string;
    passed: boolean;
    detail?: string;
  }>;
}
