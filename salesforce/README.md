# AgentLedger for Salesforce

Cryptographic decision provenance for Salesforce AI agents.

AgentLedger records every decision an Agentforce agent makes into a permanent, tamper-evident audit trail. Each decision is hashed with SHA-256 and chained to the one before it. When a session ends, all records are sealed under a Merkle root. If any record is modified after sealing, verification fails and the change becomes cryptographically detectable.

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

## What gets recorded

For each agent action, AgentLedger stores:

- **Action Type**: Query, Validation, Decision, Calculation, Create, Update, Escalation, Tool_Call, or Delete
- **Input Context**: what data the agent looked at
- **Output Result**: what the agent produced or decided
- **Reasoning**: why the agent took this action, in plain language
- **Record Hash**: SHA-256 hash of the record's content
- **Previous Hash**: hash of the prior record, forming the chain
- **Timestamp**: when the action occurred
- **Sequence Number**: position in the chain

No business data leaves Salesforce. Everything is stored in two custom objects within your org.

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

## Verification

Click the **Verify** button on any record page to run three integrity checks:

1. **Hash chain integrity**: recomputes every record's hash from its current content. If any field was modified after creation, the computed hash won't match the stored hash.
2. **Merkle root integrity**: recomputes the Merkle root from all record hashes. If any record was added, removed, or modified, the root won't match.
3. **Record count**: confirms the number of records matches the session's recorded count.

If all three pass, the audit trail is intact. If any check fails, the specific tampered record is identified.

## Use cases

The framework is object-agnostic. The same components apply wherever an agent makes consequential decisions.

### Opportunity Qualification

An agent evaluates opportunities by querying account data, calculating win probability from deal size and customer history, advancing the stage when criteria are met, and creating follow-up tasks. AgentLedger records every evaluation factor, the probability calculation, and the stage-advancement decision.

When the sales VP asks why the AI advanced a deal, the audit trail shows exactly what data the agent considered, what probability it calculated, and what criteria triggered the change. The cryptographic chain proves nobody altered that reasoning afterward.

### Case Escalation

An agent monitors incoming cases, checks SLA thresholds, evaluates account tier and case severity, and escalates when criteria are met. AgentLedger records the SLA calculation, the escalation decision, and the priority change.

When a customer disputes an escalation path or an SLA breach occurs, the tamper-evident trail proves what the agent evaluated and when, and proves the records weren't modified after the incident.

### CPQ Pricing

An agent retrieves dealer pricing rules, applies tier-specific discounts, validates floor prices, checks credit limits, and generates quotes. AgentLedger records every pricing calculation, discount application, and validation check.

When a pricing dispute arises or an audit reveals an unusual discount, the trail shows exactly what rules the agent applied and what calculations produced the final price. The hash chain proves the pricing rationale wasn't changed retroactively.

### Contract Review

An agent analyzes contract documents, extracts key terms (renewal dates, liability caps, termination clauses), flags non-standard language, and routes for review. AgentLedger records what was extracted, what was flagged, and why it was routed to a specific reviewer.

When a contract dispute surfaces months later, the trail shows what the agent identified at review time, proving the analysis wasn't altered after execution.

### Compliance Screening

An agent performs KYC/AML checks on new accounts, evaluates risk scores, flags suspicious patterns, and determines required verification levels. AgentLedger records every screening factor, risk calculation, and verification decision.

When regulators audit the screening process, the tamper-evident trail proves what data the agent evaluated, what score it calculated, and that the records are intact since the original assessment.

### Order Approval

An agent reviews purchase orders against inventory, validates shipping constraints, checks payment terms, and routes for approval based on order value and customer tier. AgentLedger records each validation step, the routing decision, and any exceptions granted.

When a fulfillment issue or billing dispute requires investigation, the trail provides a complete, verifiable record of every check the agent performed before approving the order.

## Integration patterns

### No-code (any admin can set up)

Add the four AgentLedger actions to any Agentforce subagent, then instruct the agent to start a session, record each action it takes with its type, inputs, outputs, and reasoning, and seal the session before responding. No Apex required. Works with any agent workflow.

### Apex wrapper (for developers who want deeper control)

Call `AgentAuditRecorder` directly from your own Apex to control the structure of what gets recorded:

```apex
Id sessionId = AgentAuditRecorder.startSession(
    'my-custom-agent', opportunityId, 'salesforce');

AgentAuditRecorder.recordAction(
    sessionId,
    'my-custom-agent',
    'Decision',
    JSON.serialize(inputData),
    JSON.serialize(outputData),
    'Escalated because the SLA breach is within 2 hours and the account is Enterprise tier.'
);

String merkleRoot = AgentAuditRecorder.sealSession(sessionId);
```

### Flow integration

The Invocable Actions are callable from Salesforce Flows. Use them in Screen Flows, Record-Triggered Flows, or Autolaunched Flows to add cryptographic auditing to any automated process, not just Agentforce agents.

## Record page component

The **AgentLedger Audit Trail** Lightning Web Component (`recordAuditTrail`) sits on any record page and displays all audit sessions linked to that record. Add it via Lightning App Builder:

1. Open any record (Opportunity, Case, Account, or any object)
2. Click the gear icon, then Edit Page
3. Drag "AgentLedger Audit Trail" from the Custom components onto the page
4. Save and activate

The component shows the agent name, session identifier, Merkle root, verification status, and every recorded action with its type, reasoning, hash, and chain link. Click **Verify** to re-run integrity verification on demand.

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

The four AgentLedger actions are bundled as GenAiFunction metadata, so they register automatically when you deploy. They appear in the Agentforce Asset Library ready to use, with no manual registration. Wiring AgentLedger into an agent is three configuration steps. No code required.

1. **Assign the actions to your agent's topic or subagent.** In Agentforce Studio, the four AgentLedger actions (Start, Record, Seal, Verify) are already in the Asset Library after deploy. Add them to your subagent, alongside a standard Get Record Details action so the agent can read the record it's working on, and a standard Update Record action if it needs to write.

2. **Add instructions** telling the agent to start a session first, record each meaningful step, and seal before responding. A full example instruction set is in [GUIDE.md](GUIDE.md).

3. **Drop the LWC on the record page** for any object your agents act on.

The same four actions and the same component work on any Salesforce object. Only configuration changes per use case.

## Proven use cases

The framework has been tested end to end, with no code changes between them, on:

- **Opportunity Qualification**: an agent reviews an Opportunity, records its qualification reasoning, and seals the session.
- **Case Escalation**: an agent reviews a Case, updates it (Priority, Status), and records the update as a tamper-evident action in the chain.

The Case example demonstrates that AgentLedger records not just what an agent *read*, but what it *changed*, capturing real data mutations in the audit trail.

## Package contents

| Component | Count | Description |
|---|---|---|
| Custom Objects | 2 | Agent_Audit_Session__c, Agent_Audit_Record__c |
| Core Apex Services | 3 | HashChainService, MerkleTreeService, AgentAuditRecorder |
| Invocable Actions | 4 | Start, Record, Seal, Verify (Apex) |
| Agent Action Registrations | 4 | GenAiFunction metadata, pre-registers the actions in the Asset Library on deploy |
| Lightning Web Component | 1 | Record page audit trail viewer with Verify |
| Permission Set | 1 | AgentLedger_Admin |
| Test Classes | 3 | Core engine, actions, UI controller (50 tests, all classes above 75%) |

## Optional: blockchain anchoring

For maximum assurance, AgentLedger's Merkle root can be anchored to an external ledger (such as Ethereum or Arbitrum) after sealing. Only the 64-character root hash is stored externally. No business data, no customer information, and no agent reasoning touches the external ledger.

External anchoring allows independent verification that a sealed session existed at a specific point in time and that its Merkle root has not changed, moving the guarantee from tamper-evidence to non-repudiation.

This is an optional extension and is not included in this package, to keep the core framework dependency-free. Contact the author for the reference anchoring service.

## Architecture notes

**Canonical hash input (locked).** Each record hash is computed from a fixed, ordered set of fields. This order must never change after deployment, or previously sealed sessions would fail verification.

**Immutable by convention.** Audit records are created once and never updated by the framework. The permission set grants create and read but not delete on the objects.

**Native storage.** Everything lives in standard Salesforce custom objects. No external dependencies, no managed package required. Deploy the source and go.

## Documentation

See [GUIDE.md](GUIDE.md) for the full technical guide: architecture, every class and method, the canonical hash format, agent instruction examples, and test procedures.

## Related

- Core TypeScript library: `@vluthra/agent-ledger` on npm

## Author

Vikas Luthra, architect and open source contributor.
LinkedIn: linkedin.com/in/vikas-luthra-crm
GitHub: github.com/cluthrv

## License

See [LICENSE](../LICENSE).
