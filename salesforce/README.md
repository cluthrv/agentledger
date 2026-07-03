# AgentLedger for Salesforce

Cryptographic decision provenance for Salesforce AI agents.

## What this is

AgentLedger records every decision an Agentforce agent makes into a permanent, tamper-evident audit trail. Each decision is hashed with SHA-256 and chained to the one before it. When a session ends, all records are sealed under a Merkle root. Any change to any record after sealing is detectable on verification.

It is an evidentiary layer, not a monitoring tool. It sits above Salesforce's observability, not in place of it.

## What Salesforce already gives you, and what it doesn't

Salesforce already lets you see how an agent reasons. Agentforce provides a Plan Tracer, event logs, and response citations. You can watch an agent interpret a prompt, select tools, apply reasoning, and produce an output. For building, debugging, and monitoring agents, these tools are good and you should use them.

But observability and provenance are different things, and they serve different people at different times.

Observability is for the engineer watching the agent now. It answers: is the agent working, why did this run fail, how many steps did it take, what did it cost. It is operational telemetry. It is also transient. Event logs are retention-limited, they are meant for performance analysis, and the reasoning they capture, once written, is ordinary mutable data with no proof it hasn't changed.

Provenance is for the compliance officer, auditor, or lawyer who needs to establish, later, what an agent decided and prove that record is authentic. It answers one question observability does not: can you prove the record of what the agent decided has not been altered since the moment it was made.

That is the gap AgentLedger fills. Not "Salesforce can't show you agent reasoning," it can. The gap is that nothing native makes that reasoning a durable, tamper-evident, independently verifiable record.

## Why this matters more for AI than for regular automation

Traditional Salesforce automation is deterministic. The same input produces the same output, so if you ever need to know what a Flow did, you can re-run it and reproduce the result. The logic is the record.

AI agents are not deterministic. The same opportunity can produce different reasoning on different runs. You cannot reproduce a past decision by re-running the agent. The only record of why an agent decided what it did is the reasoning it captured at that moment. If that reasoning is stored as ordinary editable text, it is not evidence. It is a claim. AgentLedger turns it into evidence.

## A concrete case

An agent approves a 40% discount on a large deal at 2am. Three weeks later, finance asks why. You open the record and the reasoning says the discount met standard policy.

But is that what the agent actually concluded, or did someone edit the field afterward to make a mistake look routine? The event logs may have aged out. The reasoning field is editable, and an edited field looks identical to an original one.

With AgentLedger, you run Verify. It recomputes the cryptographic hash of the record and compares it to the value sealed at decision time. Either it confirms the record is exactly what the agent produced, or it returns Tampered. That is the difference between a claim and proof.

## Doesn't storing the reasoning create the tampering risk?

A fair objection: if AgentLedger stores the reasoning in a Salesforce object, and that object is editable, hasn't AgentLedger introduced the very problem it claims to solve?

No. The reasoning has to be stored somewhere for it to have any value at all. Every existing way teams record agent output today, a field, a note, a Chatter post, an event log, is editable, and none of them can detect an edit. Editability is inherent to storing data in any CRM. AgentLedger does not add an editable surface that wasn't there. It replaces several editable, undetectable surfaces with one editable but tamper-evident one.

Like a tamper-evident seal on a medicine bottle, it does not prevent the bottle from being opened. It makes opening it obvious. The record can still be edited by anyone with access. The difference is that after AgentLedger, the edit is detectable: verification returns Tampered instead of Verified. Forging one field is trivial. Forging the entire hash chain and Merkle root consistently is the hard problem cryptographic sealing creates.

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
