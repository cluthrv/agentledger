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

There is a second, subtler distinction worth being precise about, because features like Field Audit Trail and Data Cloud are sometimes described as making records "immutable." That immutability is trust-based: the record is protected because the platform promises not to let it change, and that promise holds as long as no one with sufficient access ever circumvents it. AgentLedger's guarantee is different in kind. It is cryptographically self-verifying. Anyone, including an external auditor with no Salesforce access at all, can recompute the record's fingerprint and prove whether it was altered, without trusting the platform, the administrator, or the person presenting the record. Trust-based immutability answers "the system says this was not changed." Cryptographic verification answers "here is proof it was not," independent of the system. When the party asking is a regulator, opposing counsel, or an auditor who will not simply take your word, only the second one settles the question.

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

This is often the most immediately useful reason to adopt AgentLedger, and it speaks directly to teams that are cautious about giving agents autonomy. You do not have to let the agent be in charge. Humans stay in control, they can override freely, and every recommendation and every divergence from it is on the record. A few concrete situations where this matters:

- **Discount and pricing overrides.** An agent recommends against a discount that breaches margin or policy. A rep grants it anyway. When finance later questions the margin, the record shows the recommendation and who chose to proceed.
- **Escalation declined.** An agent recommends escalating a case based on SLA risk or sentiment. A supervisor decides not to. If the customer churns or complains, the record shows the escalation was recommended and declined.
- **Risk or fraud flag cleared.** An agent flags a transaction, account, or loan as high risk. A human clears or approves it. If it later proves to be a problem, there is a tamper-evident record that the system flagged it and a person overrode.
- **Data or configuration impact ignored.** An agent reviewing a bulk update or configuration change flags a downstream impact, such as breaking an integration or a report. An admin proceeds anyway. When something breaks, the record shows the warning existed.
- **Approval or compliance step skipped.** An agent recommends routing an action for additional approval, or flags a consent or policy issue. A human proceeds without it. The record captures the recommendation to escalate and the decision not to.

In each case AgentLedger provides a verifiable record of the recommendation and the decision to diverge from it. That record protects the organization and the individual, and it is exactly the accountability that lets cautious stakeholders get comfortable letting agents into consequential workflows.

### Opportunity Qualification

An agent evaluates opportunities by querying account data, checking deal size and momentum against qualification criteria, advancing the stage when the deal qualifies, and recording its decision. AgentLedger records every evaluation factor and the advancement decision.

When the sales VP asks why the AI advanced a deal, the audit trail shows exactly what the agent considered and what criteria it applied. The cryptographic chain proves nobody altered that reasoning afterward.

### Case Escalation

An agent monitors incoming cases, checks SLA thresholds, evaluates account tier and severity, and escalates when criteria are met. AgentLedger records the evaluation, the escalation decision, and the priority change.

When a customer disputes an escalation path or an SLA breach occurs, the tamper-evident trail proves what the agent evaluated and when, and proves the records weren't modified after the incident.

### CPQ Pricing

An agent retrieves pricing rules, applies tier discounts, validates floor prices, checks credit limits, and generates quotes. AgentLedger records every pricing calculation, discount application, and validation.

When a pricing dispute arises or an audit reveals an unusual discount, the trail shows exactly what rules the agent applied. The hash chain proves the pricing rationale wasn't changed retroactively.

### Compliance Screening

An agent performs KYC/AML checks on new accounts, evaluates risk scores, flags suspicious patterns, and determines verification levels. AgentLedger records every screening factor, risk calculation, and decision.

When regulators audit the screening process, the tamper-evident trail proves what data the agent evaluated, what score it calculated, and that the records are intact since the original assessment.

## Scope and limitations

Being clear about what this does and does not cover.

**What AgentLedger handles today.** Decision provenance for a single agent operating within one Salesforce org. The agent starts a session, records each decision and action with its reasoning, and seals the session. Anyone can later verify the record is unaltered. This covers the common case: an agent qualifying an opportunity, escalating a case, applying pricing, or screening an account.

**What it does not handle yet.**

*Multi-agent orchestration.* When an orchestrator agent triggers several downstream agents and processes, the decision path spans multiple agents. AgentLedger currently scopes a session to one agent run. There is no linkage between a parent session and the child sessions it spawned, so you cannot verify an entire orchestration tree as a single unit. This is a natural extension and a good area for contribution.

*Agents outside your control boundary.* When you call an external agent over MCP or another protocol, AgentLedger can record your side of the exchange: what you sent, what came back, and what you did with it. It cannot prove what happened inside the other system. That requires the external party to cryptographically sign their own execution, which is a harder problem that standards work is only beginning to address.

Practitioners have pointed out, correctly, that the need for provenance is most acute precisely in these harder cases. AgentLedger addresses the in-org, per-agent foundation first. The cross-agent and cross-boundary cases build on that foundation, and contributions in that direction are welcome.

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

For maximum assurance, AgentLedger's Merkle root can be anchored to an external ledger (such as Ethereum or Arbitrum) after sealing. Only the 64-character root hash is stored externally. No business data, no customer information, and no agent reasoning touches the external ledger.

External anchoring allows independent verification that a sealed session existed at a specific point in time and that its Merkle root has not changed, moving the guarantee from tamper-evidence to non-repudiation.

This is an optional extension and is not included in this package, to keep the core framework dependency-free.

## Architecture notes

**Canonical hash input (locked).** Each record hash is computed from a fixed, ordered set of fields. This order must never change after deployment, or previously sealed sessions would fail verification.

**Immutable by convention.** Audit records are created once and never updated by the framework. The permission set grants create and read but not delete on the objects.

**Native storage.** Everything lives in standard Salesforce custom objects. No external dependencies, no managed package required. Deploy the source and go.

## Contributing

AgentLedger is open source and contributions are welcome.

Good first issues include making the component labels configurable through App Builder properties, adding pagination to the audit trail for records with many sessions, hyperlinking session numbers to their detail records, and showing which user initiated each agent run.

Larger areas where help would be genuinely valuable: linking parent and child sessions so a multi-agent orchestration can be verified as one tree, and recording the request and response side of calls to external agents over MCP.

Open an issue to discuss an idea before submitting a pull request.

## Documentation

See [GUIDE.md](GUIDE.md) for the full technical guide: architecture, every class and method, the canonical hash format, agent instruction examples, and test procedures.

## Related

- Core TypeScript library: `@vluthra/agent-ledger` on npm

## License

See [LICENSE](../LICENSE).
