# AgentLedger for Salesforce

Cryptographic decision provenance for Salesforce AI agents.

AgentLedger records every decision an Agentforce agent makes into a tamper-evident audit trail. Each decision is hashed with SHA-256 and chained to the one before it. When a session ends, all records are sealed under a Merkle root. Any modification to any record after sealing is detected on verification.

Salesforce event logs tell you what an agent did. AgentLedger proves the record of *why* it decided has not changed since it ran.

## Why this exists

Agentforce agents now make real business decisions autonomously: qualifying opportunities, escalating cases, approving quotes, updating records. Salesforce provides execution telemetry through event logs. What it does not provide is cryptographic proof that the reasoning behind a decision has not been altered after the fact.

That gap matters for compliance, audit, and any deployment where autonomous AI decisions carry consequences. AgentLedger fills it at the application layer, storing decision provenance as native Salesforce records on the objects the agents act on.

## How it works

```
Agentforce Agent
  Start Session       -> Agent_Audit_Session__c (Status: Active)
  Record Action x N   -> Agent_Audit_Record__c
      each record hashed (SHA-256) and chained to the previous
  Seal Session        -> Merkle root computed across all record hashes
  Verify (any time)   -> recompute chain + root, compare to stored values
                         -> Valid or Tampered
```

Each agent run is a **session**. Each decision or action within it is a **record**. Records are linked in a hash chain: record 2 references record 1's hash, record 3 references record 2's, and so on. Sealing computes a single Merkle root that fingerprints the entire session. Verification recomputes everything and compares. Any change to any field of any record breaks the chain and is caught.

## What's in the package

| Component | Purpose |
|---|---|
| `Agent_Audit_Session__c` | One record per agent run. Holds status, Merkle root, related record link. |
| `Agent_Audit_Record__c` | One record per decision or action. Holds input, output, reasoning, and hashes. |
| `AgentAuditRecorder` | Core service: startSession, recordAction, sealSession, verifySession. |
| `HashChainService` | SHA-256 hashing and hash-chain verification. |
| `MerkleTreeService` | Merkle root computation and sealing. |
| `RecordAuditTrailController` | Read controller for the Lightning Web Component. |
| `recordAuditTrail` (LWC) | Visual audit trail on any record page, with on-demand Verify. |
| 4 Invocable Actions | Start, Record, Seal, Verify — for use in any Agentforce agent. |
| `AgentLedger_Admin` | Permission set granting object, field, and Apex access. |

## The four Invocable Actions

These are what an Agentforce agent calls. They are object-agnostic and require no custom code.

**Start AgentLedger Session** — begins a session linked to a record.
Inputs: `agentId`, `relatedRecordId`, `platform`. Returns: `sessionId`.

**Record Agent Action** — records one decision or action.
Inputs: `sessionId`, `agentId`, `actionType`, `inputContext`, `outputResult`, `reasoning`. Returns: `recordHash`, `sequenceNumber`.
`actionType` is one of: Query, Validation, Decision, Calculation, Create, Update, Escalation, Tool_Call, Delete.

**Seal AgentLedger Session** — seals the session and computes the Merkle root.
Inputs: `sessionId`. Returns: `merkleRoot`.

**Verify AgentLedger Session** — checks integrity of a sealed session.
Inputs: `sessionId`. Returns: `valid`, `message`.

## Deployment

```bash
# Authenticate to your org
sf org login web --alias my-org

# Deploy the framework
sf project deploy start --source-dir salesforce/force-app --target-org my-org

# Assign the permission set to yourself and to the agent's running user
sf org assign permset --name AgentLedger_Admin --target-org my-org
```

## Setup in Agentforce

Once deployed, wire AgentLedger into any agent in four configuration steps. No code required.

1. **Register the actions.** In Agentforce Studio, open the Asset Library and add the four AgentLedger Apex classes as Agent Actions (Start, Record, Seal, Verify).

2. **Assign them to your agent's topic or subagent**, alongside a standard Get Record Details action so the agent can read the record it's working on.

3. **Add instructions** telling the agent to start a session first, record each meaningful step, and seal before responding. An example instruction set is in [GUIDE.md](GUIDE.md).

4. **Drop the LWC on the record page.** In Lightning App Builder, add the `recordAuditTrail` component to the record page of any object your agents act on (Opportunity, Case, Quote, and so on).

That's it. The same four actions and the same component work on any Salesforce object. Only configuration changes per use case.

## Proven use cases

The framework has been tested end to end, with no code changes between them, on:

- **Opportunity Qualification** — an agent reviews an Opportunity, records its qualification reasoning, and seals the session.
- **Case Escalation** — an agent reviews a Case, updates it (Priority, Status), and records the update as a tamper-evident action in the chain.

The Case example demonstrates that AgentLedger records not just what an agent *read*, but what it *changed* — capturing real data mutations in the audit trail.

## Optional: blockchain anchoring

AgentLedger's Merkle root can optionally be anchored to an external ledger to provide independent, off-platform proof that a session existed at a point in time. This moves the guarantee from tamper-evidence to non-repudiation.

This is an optional extension and is **not included** in this package to keep the core framework dependency-free. A reference implementation anchors the Merkle root to an EVM chain after sealing:

```apex
public static String sealSession(Id sessionId) {
    String merkleRoot = MerkleTreeService.sealSession(sessionId);
    // Optional: anchor merkleRoot to an external ledger
    // BlockchainAnchorService.anchorSessionAsync(sessionId);
    return merkleRoot;
}
```

To enable it, add fields to `Agent_Audit_Session__c` for the transaction hash, network, and anchor status, and implement an async callout to your anchoring endpoint. Contact the author for the reference anchoring service.

## Architecture notes

**Canonical hash input (locked).** Each record hash is computed from a fixed, ordered set of fields. This order must never change after deployment, or previously sealed sessions would fail verification.

**Immutable records.** Audit records are created once and never updated by the framework. The permission set grants create and read but not delete on the objects.

**Native storage.** Everything lives in standard Salesforce custom objects. No external dependencies, no managed package required. Deploy the source and go.

## Documentation

See [GUIDE.md](GUIDE.md) for the full technical guide: architecture, every class and method, the canonical hash format, agent instruction examples, and test procedures.

## Related

- Core TypeScript library: `@vluthra/agent-ledger` on npm
- Repository root for the cross-platform framework

## License

See [LICENSE](../LICENSE).
