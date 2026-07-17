# AgentLedger for Salesforce

Cryptographic decision provenance for Salesforce AI agents.

AgentLedger records every decision an Agentforce agent makes into a permanent, tamper-evident audit trail. Each decision is hashed with SHA-256 and chained to the one before it. When a session ends, all records are sealed under a Merkle root. If any record is modified after sealing, verification fails and the change becomes cryptographically detectable.

It is an evidentiary layer, not a monitoring tool. It sits above Salesforce's observability, not in place of it.

## What Salesforce gives you, and what it doesn't

Agentforce already lets you see how an agent reasons, through Plan Tracer, event logs, and citations. Those are good for building, debugging, and monitoring agents. But that is observability: operational, transient, and mutable. It tells you whether the agent is working now.

Provenance is different. It answers the question observability does not: months later, can you prove what the agent decided, and that the record has not been altered since?

This matters more for AI than for traditional automation. A Flow is deterministic, so you can re-run it to see what it did. AI agents are not. The same input can produce different reasoning on different runs, so the reasoning captured at the time is the only record you have. If it lives in an editable field, it is a claim, not evidence.

Features like Field Audit Trail and Data Cloud are sometimes called "immutable," but that is trust-based: the record is protected because the platform promises not to let it change. AgentLedger is cryptographically self-verifying instead. Anyone, including an external auditor with no Salesforce access, can recompute the record's fingerprint and prove whether it was altered, without trusting the platform, the admin, or whoever is presenting it. Trust-based immutability says "the system says this wasn't changed." Cryptographic verification says "here is proof it wasn't." When the party asking won't take your word, only the second one settles it.

## How it works

```
Agentforce Agent
  Start Session       -> Agent_Audit_Session__c (Status: Active)
  Record Action x N   -> Agent_Audit_Record__c
      each record hashed (SHA-256) and chained to the previous
  Seal Session        -> Merkle root computed across all record hashes
                         Status: Sealed
  Verify (any time)   -> recompute chain + root, compare to stored values
                         Status: Verified or Tampered
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

If all three pass, the audit trail is intact. If any check fails, the specific tampered record is identified. In the audit trail component, the sealed session's root is shown as the **Verification Fingerprint**.

Verification also updates the session's status to reflect the result: **Verified** if the chain is intact, **Tampered** if it is not. You can verify a session as many times as you like. If a tampered record is restored to its original content, the next verification returns Verified again, because the recomputed hashes match once more. The status always reflects the most recent check.

## Who it's for

Different people ask different questions of an AI agent's decisions. AgentLedger answers all three from the same record.

| Role | Their question | What AgentLedger gives them |
|---|---|---|
| Compliance / audit | Can we prove the agent followed policy? | A sealed, verifiable record of every decision and its reasoning |
| Sales / service manager | Why did the agent do that? | Plain-language reasoning on the record page, per decision |
| Risk / legal | Has anyone altered the record since? | On-demand verification returning Verified or Tampered |

## Use cases

The framework is object-agnostic. The same components apply wherever an agent makes consequential decisions.

### Human overrides of agent recommendations

The riskiest moment in adopting AI agents is not the agent acting on its own. It is the moment a human overrides what the agent recommended. Sometimes overriding the agent is exactly the right call. Sometimes a warning gets quietly ignored. Either way, when consequences follow, someone asks whether it was a considered decision or a disregarded recommendation.

AgentLedger records what the agent recommended and whether a human acted on it or diverged from it, in a verifiable form. It does not judge the override. It records it. That cuts both ways, and that is the point. It protects the person who overrode for a sound, documented reason, and it creates accountability where a recommendation was ignored without one.

This is often the most immediately useful reason to adopt AgentLedger. It speaks directly to teams cautious about giving agents autonomy: humans stay in control, they can override freely, and every recommendation and divergence is on the record. A few situations where this matters:

- **Discount and pricing overrides.** An agent recommends against a discount that breaches margin or policy. A rep grants it anyway. When finance later questions the margin, the record shows the recommendation and who chose to proceed.
- **Escalation declined.** An agent recommends escalating a case based on SLA risk or sentiment. A supervisor decides not to. If the customer churns or complains, the record shows the escalation was recommended and declined.
- **Risk or fraud flag cleared.** An agent flags a transaction, account, or loan as high risk. A human clears or approves it. If it later proves to be a problem, there is a tamper-evident record that the system flagged it and a person overrode.
- **Data or configuration impact ignored.** An agent reviewing a bulk update or configuration change flags a downstream impact, such as breaking an integration or a report. An admin proceeds anyway. When something breaks, the record shows the warning existed.
- **Approval or compliance step skipped.** An agent recommends routing an action for additional approval, or flags a consent or policy issue. A human proceeds without it. The record captures the recommendation to escalate and the decision not to.

In each case AgentLedger provides a verifiable record of the recommendation and the decision to diverge from it. That record protects the organization and the individual, and it is exactly the accountability that lets cautious stakeholders get comfortable letting agents into consequential workflows.

### Other use cases

The same components apply across domains. In each, AgentLedger records the agent's factors and decision, and the chain proves the record wasn't altered afterward.

- **Opportunity Qualification.** An agent checks deal size and momentum against criteria, advances the stage when a deal qualifies, and records why. When the sales VP asks why the AI advanced a deal, the trail shows exactly what it considered.
- **Case Escalation.** An agent checks SLA thresholds, account tier, and severity, and escalates when warranted. When a customer disputes an escalation or an SLA breach occurs, the trail proves what the agent evaluated and when.
- **CPQ Pricing.** An agent applies tier discounts, validates floor prices, and checks credit limits. When a pricing dispute or audit arises, the trail shows exactly what rules were applied and that they weren't changed retroactively.
- **Compliance Screening.** An agent runs KYC/AML checks, scores risk, and flags patterns. When regulators audit the process, the trail proves what was evaluated and that the records are intact since the assessment.

## Scope and limitations

AgentLedger handles decision provenance for a single agent operating within one Salesforce org. The agent starts a session, records each decision with its reasoning, and seals it, and anyone can later verify the record is unaltered. This covers the common cases: qualifying an opportunity, escalating a case, applying pricing, screening an account.

Multi-agent orchestration and cross-boundary calls to external agents are not covered today. Practitioners have rightly noted the need is most acute in exactly those harder cases, and they are the framework's next direction. See the Roadmap below.

## Installation

There are two ways to install AgentLedger. Both give you the full framework. They differ only in how the four Agentforce actions get registered.

### Option A: Install the unlocked package (installs in any org)

Install the released package directly:

https://login.salesforce.com/packaging/installPackage.apexp?p0=04tgK000000EE37QAG

The package includes the objects, all Apex (including the four action classes), the Lightning Web Component, the permission set, and the tabs. It does not include the Agentforce action registrations, because GenAiFunction metadata is not currently packageable on its own. After installing, register the four actions once. Two ways to do that:

- **Register manually** in Agentforce Studio: New Agent Action, type Apex, select each of the four classes (StartAgentLedgerSessionAction, RecordAgentActionAction, SealAgentLedgerSessionAction, VerifyAgentLedgerSessionAction). Takes about five minutes.
- **Or deploy just the registrations from source:** clone the repo and deploy the genAiFunctions folder, which registers all four automatically:

```
sf project deploy start --source-dir salesforce/force-app/main/default/genAiFunctions --target-org your-org
```

### Option B: Deploy everything from source (actions pre-register)

Clone the repo and deploy the whole package. The four actions register automatically because the source includes the GenAiFunction metadata.

```
sf project deploy start --source-dir salesforce/force-app --target-org your-org
```

Requires Agentforce enabled in the target org.

### After installing (either option)

```
sf org assign permset --name AgentLedger_Admin --target-org your-org
```

## Setup in Agentforce

Once the four actions are registered (see Installation above), wiring AgentLedger into an agent is three configuration steps. No code required.

1. **Assign the actions to your agent's topic or subagent.** Add the four AgentLedger actions (Start, Record, Seal, Verify) to your subagent, alongside a standard Get Record Details action so the agent can read the record it's working on, and a standard Update Record action if it needs to write.
2. **Add instructions** telling the agent to start a session first, record each meaningful step, and seal before responding. A full example instruction set is in [GUIDE.md](GUIDE.md).
3. **Drop the LWC on the record page** for any object your agents act on.

The same four actions and the same component work on any Salesforce object. Only configuration changes per use case.

## Proven use cases

The framework has been tested end to end, with no code changes between them, on:

- **Opportunity Qualification**: an agent reviews an Opportunity against qualification criteria, advances it when it qualifies, and records the decision in a sealed, tamper-evident session.
- **Case Escalation**: an agent reviews a Case, updates it (Priority, Status), and records the update as a tamper-evident action in the chain.

The Case example demonstrates that AgentLedger records not just what an agent *read*, but what it *changed*, capturing real data mutations in the audit trail.

## Package contents

| Component | Count | Description |
|---|---|---|
| Custom Objects | 2 | Agent_Audit_Session__c, Agent_Audit_Record__c |
| Core Apex Services | 3 | HashChainService, MerkleTreeService, AgentAuditRecorder |
| Invocable Actions | 4 | Start, Record, Seal, Verify |
| Agent Action Registrations | 4 | GenAiFunction metadata (source only, not in the package) |
| Lightning Web Component | 1 | Record page audit trail viewer with Verify |
| Permission Set | 1 | AgentLedger_Admin |
| Test Classes | 3 | Core engine, actions, UI controller (50 tests, all classes above 75%) |

## Optional: blockchain anchoring

For maximum assurance, a sealed session's Merkle root can be anchored to an external ledger. Only the 64-character root hash is stored externally, never business data or agent reasoning. This lets an independent party confirm a sealed session existed at a point in time and has not changed since, moving the guarantee from tamper-evidence toward non-repudiation. It is an optional extension, not included in the core package, to keep the framework dependency-free.

## Architecture notes

**Canonical hash input (locked).** Each record hash is computed from a fixed, ordered set of fields. This order must never change after deployment, or previously sealed sessions would fail verification.

**Immutable by convention.** Audit records are created once and never updated by the framework. The permission set grants create and read but not delete on the objects.

**Native storage.** Everything lives in standard Salesforce custom objects. No external dependencies, no managed package required. Deploy the source and go.

## Roadmap

Directions the framework is heading. These are areas of active exploration, and good places to contribute.

- **Multi-agent orchestration.** Linking parent and child sessions so that when an orchestrator agent invokes several sub-agents, the entire decision tree can be sealed and verified as a single unit. Practitioners have consistently pointed to this as where provenance matters most, and it is the natural next step for the framework. Exploration in progress.
- **External anchoring.** Optionally anchoring a sealed session's fingerprint to an independent external ledger, so integrity and timing are attested by a party outside your own system. This extends tamper-evidence toward non-repudiation.
- **Cross-boundary recording.** Capturing the request and response side of calls to external agents over MCP or similar protocols, for the cases where part of the decision happens outside your control.
- **Smaller enhancements.** Configurable component labels, audit-trail pagination, and showing which user initiated each run.

Contributions in any of these directions are welcome. Open an issue to discuss before submitting a pull request.

## Contributing

AgentLedger is open source and contributions are welcome. Good first issues are labeled in the repo. The Roadmap above lists the larger areas where help is most valuable. Open an issue to discuss an idea before submitting a pull request.

## Documentation

See [GUIDE.md](GUIDE.md) for the full technical guide: architecture, every class and method, the canonical hash format, agent instruction examples, and test procedures.

## Related

- Core TypeScript library: `@vluthra/agent-ledger` on npm

## License

See [LICENSE](../LICENSE).
