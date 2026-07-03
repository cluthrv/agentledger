# AgentLedger for Salesforce

Cryptographic decision provenance for Salesforce AI agents.

## The problem

Agentforce agents now make real business decisions on their own: advancing opportunities, escalating cases, approving discounts, updating records. When one of those decisions is later questioned, you need to be able to answer three things:

1. What did the agent actually decide?
2. Why did it decide that?
3. Has that record been changed since?

Salesforce event logs tell you the agent ran. They do not preserve a tamper-evident record of the agent's reasoning that survives someone editing it afterward. That is the gap AgentLedger fills.

Consider a concrete case. An agent approves a 40% discount on a large deal. Three weeks later, finance asks why. You open the record and the reasoning says it was standard policy. But is that what the agent actually concluded, or did someone edit the field afterward? Without a tamper-evident record, you cannot tell. With AgentLedger, verification either confirms the record is exactly what the agent produced, or flags that it was altered after sealing.

## Why AI agents need this when regular automation did not

Traditional Salesforce automation is deterministic. The same input produces the same output, so you can reproduce what happened by re-running it. AI agents are not deterministic. The same opportunity can produce different reasoning on different runs, and you cannot reproduce a past decision by re-running the agent. The only record of why an agent decided what it did is the reasoning it captured at that moment. If that reasoning is stored as ordinary editable text, it is not evidence. AgentLedger makes it evidence.

## Logging, audit, provenance

These three are often confused. They answer different questions.

- **Logging** answers: did it run? Salesforce event logs do this well.
- **Audit** answers: what did it do, and in what order? Field History and event logs partially do this.
- **Provenance** answers: can you prove the record of what it decided has not changed since? This requires cryptographic sealing, and it is what AgentLedger provides.

Logs and audit trails can be edited by anyone with the right access, and nothing detects the edit. Provenance makes any change mathematically detectable. AgentLedger is provenance. It complements Salesforce's logging rather than replacing it.

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
| 4 Invocable Actions | Start, Record, Seal, Verify, for use in any Agentforce agent. |
| `AgentLedger_Admin` | Permission set granting object, field, and Apex access. |

## The four Invocable Actions

These are what an Agentforce agent calls. They are object-agnostic and require no custom code.

**Start AgentLedger Session** begins a session linked to a record.
Inputs: `agentId`, `relatedRecordId`, `platform`. Returns: `sessionId`.

**Record Agent Action** records one decision or action.
Inputs: `sessionId`, `agentId`, `actionType`, `inputContext`, `outputResult`, `reasoning`. Returns: `recordHash`, `sequenceNumber`.
`actionType` is one of: Query, Validation, Decision, Calculation, Create, Update, Escalation, Tool_Call, Delete.

**Seal AgentLedger Session** seals the session and computes the Merkle root.
Inputs: `sessionId`. Returns: `merkleRoot`.

**Verify AgentLedger Session** checks integrity of a sealed session.
Inputs: `sessionId`. Returns: `valid`, `message`.

## Who it's for

Different people ask different questions of an AI agent's decisions. AgentLedger answers all three from the same record.

| Role | Their question | What AgentLedger gives them |
|---|---|---|
| Compliance / audit | Can we prove the agent followed policy? | A sealed, verifiable record of every decision and its reasoning |
| Sales / service manager | Why did the agent do that? | Plain-language reasoning on the record page, per decision |
| Risk / legal | Has anyone altered the record since? | On-demand verification returning Verified or Tampered |

## Use cases and what's at stake

The framework is object-agnostic, so the pattern applies wherever an agent makes consequential decisions.

| Use case | The agent decides | What's at stake |
|---|---|---|
| Opportunity qualification | Whether to advance or hold a deal | Forecast integrity, why a deal was prioritized |
| Case escalation | Urgency and routing | SLA compliance, why a customer was or wasn't escalated |
| Quote / discount approval | Whether to approve pricing | Margin, policy adherence, audit defensibility |
| Contract renewal | Churn risk and renewal strategy | Revenue decisions, why a renewal was flagged |

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

- **Opportunity Qualification**: an agent reviews an Opportunity, records its qualification reasoning, and seals the session.
- **Case Escalation**: an agent reviews a Case, updates it (Priority, Status), and records the update as a tamper-evident action in the chain.

The Case example demonstrates that AgentLedger records not just what an agent *read*, but what it *changed*, capturing real data mutations in the audit trail.

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
