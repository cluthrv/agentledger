# AgentLedger

**Cryptographic audit trails for AI agent operations.**

AgentLedger provides tamper-proof verification of what AI agents do in enterprise platforms. It uses SHA-256 hash chains and Merkle trees to create immutable, independently verifiable records of every action an autonomous agent performs.

## The Problem

AI agents in enterprise platforms — Salesforce Agentforce, LangChain agents, custom LLM-powered workflows — make decisions and take actions autonomously. Existing audit mechanisms capture *what changed* but not *why an agent decided to make that change*, and existing logs are mutable: they can be altered after the fact without detection.

AgentLedger closes this gap by providing:

- **Hash-chained action records**: Every agent action is cryptographically linked to the previous one. Modify any record and the chain breaks.
- **Merkle tree verification**: A single root hash represents an entire agent session. Verify any individual action in O(log n) without accessing all records.
- **Session sealing**: When an agent session ends, the Merkle root is computed and the session becomes a cryptographic commitment to the exact sequence of events.

## Installation

```bash
npm install @vluthra/agent-ledger
```

## Quick Start

```typescript
import { AgentLedgerSession, ActionType } from '@vluthra/agent-ledger';

// 1. Create an audit session
const session = new AgentLedgerSession({
  agentId: 'pricing-agent',
  platform: 'salesforce',
  initiator: 'dealer-portal',
});

// 2. Record agent actions
session.record({
  agentId: 'pricing-agent',
  actionType: ActionType.QUERY,
  input: { query: 'Get dealer tier for account ACC-100' },
  output: { tier: 'Gold', discountPct: 15 },
  reasoning: 'Queried account master for dealer classification',
});

session.record({
  agentId: 'pricing-agent',
  actionType: ActionType.CALCULATION,
  input: { basePrice: 200, discountPct: 15 },
  output: { finalPrice: 170 },
  reasoning: 'Applied Gold tier discount to base price',
});

session.record({
  agentId: 'pricing-agent',
  actionType: ActionType.CREATE,
  input: { accountId: 'ACC-100', price: 170 },
  output: { quoteId: 'Q-5678', status: 'draft' },
  reasoning: 'Generated draft quote with validated pricing',
});

// 3. Seal the session (computes Merkle root)
const sealed = session.seal();
console.log(`Session sealed. Merkle root: ${sealed.merkleRoot}`);

// 4. Verify the entire session
const result = session.verify();
console.log(`Verification: ${result.valid ? 'PASSED' : 'FAILED'}`);

// 5. Generate a proof for a specific action
const proof = session.proveRecord(1); // the calculation step
console.log(`Proof valid: ${session.verifyProof(proof!)}`);
```

## How It Works

### Hash Chaining

Each Action Record's SHA-256 hash includes the hash of the previous record, creating an append-only chain:

```
Record 0: hash(content₀ + null)         → H₀
Record 1: hash(content₁ + H₀)           → H₁
Record 2: hash(content₂ + H₁)           → H₂
```

If any record is modified after creation, its hash changes, which breaks the link to the next record. Tampering is immediately detectable.

### Merkle Trees

When a session is sealed, the record hashes are organized into a binary Merkle tree:

```
          Root Hash
         /        \
      H(0,1)     H(2,3)
      /    \      /    \
    H(0)  H(1)  H(2)  H(3)
```

The root hash is a single fingerprint for the entire session. A Merkle proof allows verification of any single record against the root in O(log n) operations, without needing access to all other records.

## API Reference

### `AgentLedgerSession`

The primary interface for creating and managing audit sessions.

#### Constructor

```typescript
new AgentLedgerSession(options: SessionOptions)
```

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `agentId` | `string` | Yes | Identifier for the AI agent |
| `initiator` | `string` | No | Who or what started this session |
| `platform` | `string` | No | Platform identifier (e.g., `'salesforce'`) |
| `metadata` | `Record<string, unknown>` | No | Arbitrary session-level metadata |

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `record(input)` | `ActionRecord` | Record an agent action and chain it |
| `seal()` | `AuditSession` | Seal the session with a Merkle root |
| `verify()` | `VerificationResult` | Verify chain and Merkle root integrity |
| `proveRecord(index)` | `MerkleProof \| null` | Generate a Merkle proof for one record |
| `verifyProof(proof)` | `boolean` | Verify a Merkle proof |
| `getRecord(index)` | `ActionRecord \| undefined` | Get a specific record |
| `getRecords()` | `ActionRecord[]` | Get all records (copy) |
| `export()` | `{ session, records }` | Export complete session data |

### Action Types

```typescript
enum ActionType {
  QUERY        // Agent reads or retrieves data
  UPDATE       // Agent modifies existing records
  CREATE       // Agent creates new records
  DELETE       // Agent removes records
  DECISION     // Agent makes a decision or selects a path
  ESCALATION   // Agent escalates to a human operator
  TOOL_CALL    // Agent invokes an external tool or API
  CALCULATION  // Agent performs a calculation
  VALIDATION   // Agent validates data against rules
}
```

### Low-Level Utilities

For advanced use cases, the individual components are exported:

```typescript
import {
  sha256,
  hashActionRecord,
  combineHashes,
  createActionRecord,
  verifyActionRecord,
  verifyChain,
  buildMerkleTree,
  computeMerkleRoot,
  generateMerkleProof,
  verifyMerkleProof,
} from '@vluthra/agent-ledger';
```

## Use Cases

- **B2B Commerce**: Audit AI agents that modify dealer pricing, generate quotes, or update product catalogs
- **CRM**: Track AI agents that update customer records, route cases, or make recommendations
- **CPQ**: Verify AI agents that configure products, calculate pricing, or apply discount rules
- **Compliance**: Provide regulators with tamper-proof evidence of AI agent behavior
- **Incident Response**: Reconstruct exactly what an AI agent did when investigating issues

## Design Principles

1. **Zero external dependencies**: Core library uses only Node.js built-in `crypto` module
2. **Platform-agnostic**: Works with any AI agent framework (LangChain, CrewAI, Salesforce Agentforce, custom agents)
3. **Deterministic hashing**: Identical inputs always produce identical hashes regardless of object property ordering
4. **Immutability by design**: Once created, Action Records cannot be modified without detection

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Build
npm run build
```

## Roadmap

- [ ] Python SDK (PyPI package)
- [ ] Salesforce-native implementation (AppExchange package)
- [ ] REST verification API with OpenAPI spec
- [ ] Storage adapters (PostgreSQL, DynamoDB)
- [ ] CLI tool for offline verification

## License

MIT

## Author

Vikas Luthra — Enterprise Solution Architect specializing in B2B Commerce, CRM, and CPQ platforms.
