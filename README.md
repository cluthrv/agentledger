# AgentLedger

Cryptographic audit trails for AI agent operations.

AgentLedger creates tamper-evident records of what AI agents do. It uses SHA-256 hash chains and Merkle trees so that any change to a recorded action after the fact becomes cryptographically detectable.

## Two implementations

This repository contains two independent implementations of the same pattern:

| Implementation | Location | Install |
|---|---|---|
| **TypeScript core library** | `src/` (this README) | `npm install @vluthra/agent-ledger` |
| **Salesforce / Agentforce** | [`salesforce/`](salesforce/) | Unlocked package, see [salesforce/README.md](salesforce/README.md) |

The TypeScript library is platform-agnostic and works with any agent framework. The Salesforce implementation is a native Agentforce framework with Invocable Actions and a record-page component. They share the same hashing and sealing model but are separate codebases.

## The problem

AI agents in enterprise platforms make decisions and take actions autonomously. Existing audit mechanisms capture what changed but not why the agent decided to change it, and conventional logs are ordinary mutable data. Nothing about them establishes that they have not been altered since they were written.

AgentLedger addresses that with:

- **Hash-chained action records.** Every recorded action is cryptographically linked to the previous one. Modify a record and the chain breaks.
- **Merkle tree verification.** A single root hash represents an entire agent session. Verify any individual action against the root in O(log n) without accessing all records.
- **Session sealing.** When a session ends, the Merkle root is computed and becomes a cryptographic commitment to the recorded sequence of events.

## What it does and does not cover

AgentLedger verifies the integrity of the records submitted to it. Being precise about the boundary matters:

- It detects changes to recorded actions after sealing. It does not prove that the agent recorded every action that occurred.
- It protects recorded values after they are written. It does not independently confirm that those values match the underlying operation.
- Verification reflects the current state of the records against the sealed fingerprint. It does not provide a continuous chain of custody on its own.
- It supports traceability and evidence integrity. It does not determine regulatory compliance.

## Installation

```bash
npm install @vluthra/agent-ledger
```

## Quick start

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

## How it works

### Hash chaining

Each Action Record's SHA-256 hash includes the hash of the previous record, creating an append-only chain:

```text
Record 0: hash(content0 + null)         -> H0
Record 1: hash(content1 + H0)           -> H1
Record 2: hash(content2 + H1)           -> H2
```

If a record is modified after creation, its hash changes, which breaks the link to the next record. The modification is detectable on verification.

### Merkle trees

When a session is sealed, the record hashes are organized into a binary Merkle tree:

```text
          Root Hash
         /        \
      H(0,1)     H(2,3)
      /    \      /    \
    H(0)  H(1)  H(2)  H(3)
```

The root hash is a single fingerprint for the entire session. A Merkle proof allows verification of any single record against the root in O(log n) operations, without needing access to all other records.

## API reference

### AgentLedgerSession

The primary interface for creating and managing audit sessions.

#### Constructor

```typescript
new AgentLedgerSession(options: SessionOptions)
```

| Option | Type | Required | Description |
|---|---|---|---|
| `agentId` | `string` | Yes | Identifier for the AI agent |
| `initiator` | `string` | No | Who or what started this session |
| `platform` | `string` | No | Platform identifier (e.g. `'salesforce'`) |
| `metadata` | `Record<string, unknown>` | No | Arbitrary session-level metadata |

#### Methods

| Method | Returns | Description |
|---|---|---|
| `record(input)` | `ActionRecord` | Record an agent action and chain it |
| `seal()` | `AuditSession` | Seal the session with a Merkle root |
| `verify()` | `VerificationResult` | Verify chain and Merkle root integrity |
| `proveRecord(index)` | `MerkleProof \| null` | Generate a Merkle proof for one record |
| `verifyProof(proof)` | `boolean` | Verify a Merkle proof |
| `getRecord(index)` | `ActionRecord \| undefined` | Get a specific record |
| `getRecords()` | `ActionRecord[]` | Get all records (copy) |
| `export()` | `{ session, records }` | Export complete session data |

### Action types

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

### Low-level utilities

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

## Use cases

- **B2B commerce:** record AI agents that modify dealer pricing, generate quotes, or update product catalogs
- **CRM:** track AI agents that update customer records, route cases, or make recommendations
- **CPQ:** record AI agents that configure products, calculate pricing, or apply discount rules
- **Governance and audit:** provide a verifiable record of agent decisions for later review
- **Incident response:** reconstruct what an agent recorded when investigating an issue

## Design principles

- **Zero external dependencies.** The core library uses only the Node.js built-in `crypto` module.
- **Platform-agnostic.** Works with any AI agent framework, including LangChain, CrewAI, Salesforce Agentforce, and custom agents.
- **Deterministic hashing.** Identical inputs always produce identical hashes regardless of object property ordering.
- **Tamper-evident by design.** Once created, Action Records cannot be modified without detection.

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

- [x] Salesforce-native implementation (see [`salesforce/`](salesforce/))
- [ ] Python SDK (PyPI package)
- [ ] REST verification API with OpenAPI spec
- [ ] Storage adapters (PostgreSQL, DynamoDB)
- [ ] CLI tool for offline verification

## License

MIT. See [LICENSE](LICENSE).

## Author

Vikas Luthra, enterprise solution architect specializing in B2B commerce, CRM, and CPQ platforms.
