# AgentLedger for Salesforce

An open-source, Salesforce-native foundation for tamper-evident Agentforce decision provenance.

AgentLedger creates tamper-evident records of the decisions and actions an Agentforce agent submits to it. Each record is hashed with SHA-256, a widely used cryptographic hash function also used in Bitcoin's design, and chained to the one before it. When a session ends, all records are sealed under a Merkle root. If any sealed record is modified afterward, verification fails and the change becomes cryptographically detectable.

It is an evidentiary layer, not a monitoring tool. It complements Salesforce's observability by creating durable, business-record-level decision receipts for later governance, investigation, and audit. It does not replace observability, and it is a foundation rather than a complete enterprise governance platform. See Scope and limitations below for exactly what it does and does not cover.

## What Salesforce gives you, and what it doesn't

Agentforce already lets you inspect how an agent behaves, through Agentforce Builder inspection tools, event logs, Session Tracing, Observability, and citations. These capabilities are primarily designed for development, monitoring, troubleshooting, and operational analysis.

Provenance addresses a different question: months later, can the organization verify that a recorded business decision remains consistent with the fingerprint created when the session was sealed?

This matters more for AI than for traditional automation. Traditional automation is generally governed by predefined logic that can be inspected and tested. Agent decisions may also depend on nondeterministic model output, so the same input can produce a different decision path on different runs, which makes the contemporaneous decision record especially important. If that record lives only in an ordinary editable field, its integrity depends on platform controls and administrative trust rather than on cryptographic verification.

Conventional audit records rely primarily on platform access controls, retention settings, and administrative trust. AgentLedger adds a separate integrity mechanism: the submitted record set is cryptographically self-checking. A reviewer can recompute the hashes and Merkle root to determine whether the records remain internally consistent with the stored fingerprint. Because the records and fingerprint are stored in the same Salesforce org, stronger assurance against privileged rewriting requires external anchoring of the fingerprint. See Scope and limitations.

## How it works

```text
Agentforce Agent
  Start Session       -> Agent_Audit_Session__c (Status: Active)
  Record Action x N   -> Agent_Audit_Record__c
      each record hashed (SHA-256) and chained to the previous
  Seal Session        -> Merkle root computed across all record hashes
                         Status: Sealed
  Verify (any time)   -> recompute chain + root, compare to stored values
                         Status: Verified or Tampered
```

Each agent run is a **session**. Each decision or action within it is a **record**. Records are linked in a hash chain: record 2 references record 1's hash, record 3 references record 2's, and so on. Sealing computes a single Merkle root that fingerprints the entire session. Verification recomputes everything and compares. Any change to a field included in the canonical hash input breaks the chain and is caught.

## What gets recorded

For each agent action, AgentLedger stores:

* **Action Type:** Query, Validation, Decision, Calculation, Create, Update, Escalation, Tool_Call, or Delete
* **Input Context:** what data the agent looked at
* **Output Result:** what the agent produced or decided
* **Decision Rationale:** the agent-provided explanation for the action, in plain language, stored in the `Reasoning__c` field
* **Record Hash:** SHA-256 hash of the record's hashed content fields
* **Previous Hash:** hash of the prior record, forming the chain
* **Timestamp:** when the action occurred
* **Sequence Number:** position in the chain

In the core implementation, decision records remain inside Salesforce, stored in two custom objects within your org. Optional external anchoring publishes only the sealed fingerprint, never the underlying business data or rationale.

## The four Invocable Actions

These are what an Agentforce agent calls. They are object-agnostic, and no custom code is required by the installing admin to wire them into an agent once the package or source is deployed.

**Start AgentLedger Session** begins a session linked to a record.
Inputs: `agentId`, `relatedRecordId`, `platform`. Returns: `sessionId`.

**Record Agent Action** records one decision or action.
Inputs: `sessionId`, `agentId`, `actionType`, `inputContext`, `outputResult`, `reasoning`. Returns: `recordHash`, `sequenceNumber`.

`actionType` is one of: Query, Validation, Decision, Calculation, Create, Update, Escalation, Tool_Call, Delete.

**Seal AgentLedger Session** seals the session and computes the Merkle root.
Inputs: `sessionId`. Returns: `merkleRoot`.

**Verify AgentLedger Session** checks the integrity of a sealed session.
Inputs: `sessionId`. Returns: `valid`, `message`.

## Verification

Click the **Verify** button on any record page to run three integrity checks:

1. **Hash chain integrity:** recomputes every record's hash from its current content. If any hashed content field was modified after creation, the computed hash will not match the stored hash.
2. **Merkle root integrity:** recomputes the Merkle root from all record hashes. If any record was added, removed, or modified, the root will not match.
3. **Record count:** confirms that the number of records matches the session's recorded count.

If all three checks pass, the submitted records are currently consistent with the sealed fingerprint. If a check fails, verification reports the failed integrity check and, where applicable, identifies the affected record or sequence.

In the audit trail component, the sealed session's root is shown as the **Verification Fingerprint**. This checks the integrity of what was recorded. It confirms that the submitted record set has not changed, not that every action was recorded. See Scope and limitations.

Verification also updates the session's status to reflect the result:

* **Verified** if the chain is intact
* **Tampered** if it is not

A session can be verified multiple times. If an altered record is restored to its original content, the next verification returns Verified because the recomputed hashes match again. The status always reflects the most recent verification.

An important consequence is that verification reflects the current state of the records, not their continuous history. A **Verified** status means that the records currently match the sealed fingerprint. It does not prove that no temporary alteration ever occurred. Someone could alter a record, inspect it, and restore it, leaving the current state Verified.

The mechanism proves present consistency, not continuous custody. AgentLedger does not retain a separate history of prior failed verification attempts unless that history is added through another audit mechanism.

## Who it's for

Different stakeholders ask different questions about an AI agent's decisions. AgentLedger helps answer them from the same record.

| Role                    | Their question                                      | What AgentLedger gives them                                      |
| ----------------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| Compliance / audit      | What policy evaluation and decision were recorded?  | A sealed record of the submitted decision evidence and rationale |
| Sales / service manager | What explanation was recorded for the action?       | A plain-language decision rationale on the business record       |
| Risk / legal            | Has the submitted record set changed since sealing? | On-demand integrity verification returning Verified or Tampered  |

## Use cases

The framework is object-agnostic. The same components can be used wherever an agent makes consequential decisions.

### Human overrides of agent recommendations

One of the most consequential moments in adopting AI agents is when a human overrides what an agent recommended. Sometimes overriding the agent is the correct decision. Sometimes a warning is ignored without adequate review. When consequences follow, an organization may need to determine whether the override was a considered decision or a disregarded recommendation.

AgentLedger can be configured to record what the agent recommended and the human decision that followed. It does not judge the override. It preserves the submitted record.

This can protect a person who overrode an agent for a sound, documented reason, while also creating accountability when a recommendation was ignored without adequate justification.

Today, this pattern is supported by recording the recommendation and the human decision through the standard action using the existing input, output, and rationale fields.

Dedicated first-class fields for overrides are not yet part of the current module. Planned fields include:

* Recommendation ID
* Human disposition
* Decision-maker
* Justification
* Policy or approval reference
* Final executed outcome
* A hash binding the override to the original recommendation

The scenario is real and the foundation supports it. A purpose-built override module is the highest-priority planned enhancement.

Teams can configure the workflow so that the recommendation and subsequent human decision are recorded together. Examples include:

* **Discount and pricing overrides:** An agent recommends against a discount that breaches a margin or policy threshold. A representative proceeds anyway. If the workflow captures the override, the record can show the recommendation and who chose to proceed.
* **Escalation declined:** An agent recommends escalating a case because of SLA risk or customer sentiment. A supervisor decides not to escalate. The recorded trail can preserve both decisions.
* **Risk or fraud flag cleared:** An agent flags a transaction, account, or application as high risk. An authorized person clears or approves it. The trail can record the warning and subsequent human disposition.
* **Data or configuration impact ignored:** An agent reviewing a bulk update or configuration change identifies a potential downstream impact. An administrator proceeds. The trail can preserve the warning and decision.
* **Approval or compliance step skipped:** An agent recommends additional approval or identifies a policy concern. A user proceeds without the recommended step. The trail can record the recommendation and subsequent decision.

In each configured case, AgentLedger can provide a verifiable record of the recommendation and the recorded decision to diverge from it. That record can protect both the organization and the individual, and it provides the kind of accountability that helps cautious stakeholders become more comfortable allowing agents into consequential workflows.

### Other use cases

The same components can be applied across different business domains.

* **Opportunity Qualification:** An agent evaluates deal size, engagement, and momentum against qualification criteria, advances the stage when appropriate, and records the submitted basis for the decision.
* **Case Escalation:** An agent evaluates SLA thresholds, account tier, and severity and records its escalation decision and rationale.
* **CPQ Pricing:** When a pricing agent evaluates discounts, floor prices, and credit limits, AgentLedger records the submitted inputs, recommendation, resulting action, and rationale. AgentLedger is the recording layer, not the system applying the pricing rules.
* **Compliance Screening:** When a screening agent performs KYC or AML checks, AgentLedger records what the workflow reports was evaluated, the score reported, and the disposition. It supports the traceability and evidence-integrity layer of a compliance workflow. It does not perform the screening or certify regulatory compliance.

## Scope and limitations

AgentLedger handles decision provenance for a single agent operating within one Salesforce org.

The agent starts a session, submits decision and action records with an agent-provided rationale, and seals the session. A reviewer can later check the sealed record set for cryptographic consistency.

Being precise about what this does and does not cover is central to using it responsibly.

### What it detects

After a session is sealed, AgentLedger can detect whether stored records included in the session were changed, added, removed, or reordered. A post-sealing modification to hashed content breaks the hash chain or Merkle-root verification.

The framework rejects normal additions after sealing. Verification can also detect records introduced outside the normal lifecycle through record-count and Merkle-root mismatches.

### Completeness

AgentLedger verifies the integrity of records submitted to it. It cannot currently prove that the agent submitted every action or decision that occurred.

Recording depends on the agent being instructed to call the AgentLedger actions. Enforced or reconciled capture is a roadmap item.

### Source authenticity

AgentLedger protects submitted values after they are recorded. It does not independently prove that the recorded rationale, input, output, or reported action exactly matches the underlying Salesforce action or transaction.

Binding ledger records directly to actual Salesforce mutations is a roadmap item.

### Privileged access

Because the records and Merkle root are stored in the same Salesforce org, the core implementation does not by itself protect against a sufficiently privileged actor who replaces the records and recomputes the fingerprint.

External anchoring of the sealed fingerprint is the planned stronger-assurance option. It can provide an independent reference for detecting retrospective rewriting and establish that a particular fingerprint existed by a certain point in time.

### Durability, not permanence

Records are durable, but like other Salesforce data, they may still be removed by sufficiently privileged actors, retention processes, org closure, or package removal.

### Current-state verification, not continuous custody

Verification proves that the records currently match the sealed fingerprint.

Because restoring an altered value returns the status to Verified, the mechanism proves present consistency, not that no temporary alteration ever occurred. It does not by itself provide a continuous chain of custody.

### Incomplete sessions

If an agent fails or stops before calling Seal, the session remains unsealed and does not have a final Merkle fingerprint.

Operational monitoring is still needed to detect and manage incomplete sessions.

### Compliance scope

AgentLedger supports traceability and evidence integrity. It does not determine whether a decision is legally or regulatorily compliant.

### Multi-agent and cross-boundary scope

Orchestration across multiple agents and calls to external agents over MCP or similar protocols are not covered today.

The need becomes especially important in these multi-agent and cross-boundary scenarios, and they are planned directions for the framework.

## Installation

There are two ways to install AgentLedger. Both provide the complete current framework. They differ in how the four Agentforce actions are registered.

### Option A: Install the unlocked package

Install the released package directly:

```text
https://login.salesforce.com/packaging/installPackage.apexp?p0=04tgK000000EE37QAG
```

The package includes:

* Custom objects
* Apex classes, including the four action classes
* Lightning Web Component
* Permission set
* Tabs

It does not include the Agentforce action registrations. Depending on packaging type and release, `GenAiFunction` metadata may require separate deployment or manual registration, so this package keeps action registration as an explicit step.

After installing, register the four actions using either of these approaches:

#### Register manually

In Agentforce Studio:

1. Select **New Agent Action**.
2. Choose **Apex**.
3. Register each class:

   * `StartAgentLedgerSessionAction`
   * `RecordAgentActionAction`
   * `SealAgentLedgerSessionAction`
   * `VerifyAgentLedgerSessionAction`

#### Deploy the registrations from source

Clone the repository and deploy the `genAiFunctions` folder:

```bash
sf project deploy start \
  --source-dir salesforce/force-app/main/default/genAiFunctions \
  --target-org your-org
```

### Option B: Deploy everything from source

Clone the repository and deploy the complete package:

```bash
sf project deploy start \
  --source-dir salesforce/force-app \
  --target-org your-org
```

The four actions register automatically because the source contains the `GenAiFunction` metadata.

Agentforce must be enabled in the target org.

### Assign the permission set

After either installation method:

```bash
sf org assign permset \
  --name AgentLedger_Admin \
  --target-org your-org
```

## Setup in Agentforce

Once the actions are registered, connecting AgentLedger to an agent requires three configuration steps.

1. **Assign the actions to the agent's topic or subagent.** Add Start, Record, Seal, and Verify alongside a standard Get Record Details action. Add an Update Record action when the agent needs to modify Salesforce data.
2. **Add agent instructions.** Tell the agent to start a session, record each meaningful submitted step, and seal the session before responding. A complete example is available in [GUIDE.md](GUIDE.md).
3. **Add the Lightning Web Component.** Place the `recordAuditTrail` component on the record page for any object on which the agent operates.

The same actions and component can work with different Salesforce objects. Configuration changes by use case, but the framework code does not.

## Validated sample use cases

The framework has been tested end to end, without code changes between the scenarios, for:

* **Opportunity Qualification:** An agent reviews an Opportunity against qualification criteria, advances it when it qualifies, and records the decision in a sealed, tamper-evident session.
* **Case Escalation:** An agent reviews a Case, updates fields such as Priority and Status, and records the update as an action in the tamper-evident chain.

The Case example demonstrates a workflow in which the agent updates Salesforce data and records that update in the AgentLedger trail.

## Package contents

| Component                  | Count | Description                                                                            |
| -------------------------- | ----: | -------------------------------------------------------------------------------------- |
| Custom Objects             |     2 | `Agent_Audit_Session__c`, `Agent_Audit_Record__c`                                      |
| Core Apex Services         |     3 | `HashChainService`, `MerkleTreeService`, `AgentAuditRecorder`                          |
| Invocable Actions          |     4 | Start, Record, Seal, Verify                                                            |
| Agent Action Registrations |     4 | `GenAiFunction` metadata, included in source but registered separately from this package |
| Lightning Web Component    |     1 | Record-page audit trail viewer with Verify                                             |
| Permission Set             |     1 | `AgentLedger_Admin`                                                                    |
| Test Classes               |     3 | Core engine, actions, and UI controller; 50 tests, with all classes above 75% coverage |

## Optional external anchoring

For stronger independent assurance, a sealed session's Merkle root can be anchored to an external ledger.

Only the 64-character fingerprint is published externally. The underlying business data and decision rationale remain in Salesforce.

External anchoring gives an independent party a timestamped reference for the sealed fingerprint and strengthens the evidence against retrospective rewriting. It does not solve completeness, source-authenticity, or continuous-custody limitations.

This is an optional extension and is not included in the core package, keeping the framework dependency-free.

## Architecture notes

**Canonical hash input is locked.** Each record hash is computed from a fixed, ordered set of fields, with defined serialization rules for field order, null handling, whitespace, datetime format, and text encoding. The exact canonical format is documented in [GUIDE.md](GUIDE.md). This format must not change after deployment, or previously sealed sessions would fail verification.

**Immutable by convention.** Audit records are created once and are not updated by the framework. The permission set grants create and read access but not delete access on the audit objects.

**Native storage.** The core implementation stores its data in Salesforce custom objects and has no external runtime dependency.

## Roadmap

The following are planned areas of evolution and opportunities for contribution.

### Human override module

This is the highest-priority planned enhancement.

It will introduce first-class structured records for human decisions on agent recommendations rather than relying on generic text fields.

Planned data includes:

* Recommendation ID
* Human disposition: accepted, rejected, or modified
* Decision-maker
* Justification
* Policy or approval reference
* Final executed outcome
* A hash binding the human decision to the original recommendation

### Binding to actual record changes

Bind ledger entries to Salesforce mutations, including:

* Object and record ID
* Before and after field values
* Running user
* Transaction identifier
* Execution result

This addresses the source-authenticity gap.

### Enforced or reconciled capture

Capture actions through a mechanism that the agent cannot silently bypass, or reconcile AgentLedger records against Agentforce session traces.

This addresses the completeness gap.

### Multi-agent orchestration

Link parent and child sessions so that an orchestrator invoking multiple subagents can be represented, sealed, and verified as a single decision tree.

Provenance becomes especially important when a decision path spans multiple agents.

### External anchoring

Anchor a sealed fingerprint to an independent external ledger, creating an external timestamped reference and stronger protection against retrospective rewriting.

### Cross-boundary recording

Capture the request and response sides of calls to external agents over MCP or similar protocols.

### Smaller enhancements

* Configurable component labels
* Audit-trail pagination
* Displaying the user who initiated each run
* Monitoring and management of incomplete sessions

Contributions in any of these areas are welcome. Open an issue to discuss an idea before submitting a pull request.

## Contributing

AgentLedger is open source, and contributions are welcome.

Good first issues are labeled in the repository. The roadmap identifies larger areas where feedback and implementation help would be valuable.

Open an issue to discuss significant changes before submitting a pull request.

## Documentation

See [GUIDE.md](GUIDE.md) for:

* Architecture details
* Apex classes and methods
* Canonical hash format
* Agent-instruction examples
* Test procedures
* Deployment guidance

## Related

* Core TypeScript library: `@vluthra/agent-ledger` on npm

## License

See [LICENSE](../LICENSE).
