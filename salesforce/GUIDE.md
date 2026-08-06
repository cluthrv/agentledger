# AgentLedger for Salesforce: Technical Guide

## Overview

AgentLedger is a cryptographic decision-provenance framework for Salesforce AI agents. It records every decision an Agentforce agent makes using SHA-256 hash chains and Merkle trees, producing durable, tamper-evident, independently verifiable audit records stored as native Salesforce data.

The framework is object-agnostic. The same components work on Opportunity, Case, Quote, Contract, or any custom object. Only configuration changes per use case, never code.

## Observability vs provenance

It is worth being precise about what this framework does and does not do, because Salesforce already provides real agent-monitoring capabilities and AgentLedger is not a replacement for them.

Agentforce provides observability: the Plan Tracer, event logs, and response citations let you watch how an agent interprets a prompt, selects tools, applies reasoning, and produces an output. These are the right tools for building, debugging, and monitoring agents, and you should use them. Observability is operational telemetry for the engineer working with the agent now. It answers whether the agent is functioning, why a run failed, how many steps it took, and what it cost. It is also transient: event logs are retention-limited, and the reasoning they capture, once written, is ordinary mutable data with no proof it has not changed.

AgentLedger provides provenance: a permanent, tamper-evident record of what the agent decided, built to be verified later. It answers the one question observability does not, which is whether the record of a decision can be proven authentic and unaltered since the moment it was made. This is what a compliance officer, auditor, or legal team needs when a past decision is questioned, potentially long after the operational logs have aged out.

The two are complementary. Observability tells you what is happening. Provenance lets you prove, later, what happened.

## When to use this

Use AgentLedger when an Agentforce agent makes decisions that someone may later need to question, defend, or audit. Typical triggers: the agent changes records without human review at each step, operates in a regulated or compliance-sensitive context, or makes decisions where "what did it decide, why, and has the record changed since?" is a question you might have to answer months or years later.

The reason this matters more for AI than for traditional automation is determinism. A Flow or trigger is deterministic: the same input produces the same output, so the logic itself is the record and you can reproduce any past result by re-running it. AI agents are not deterministic. The same input can produce different reasoning on different runs, and you cannot reproduce a past decision by re-running the agent. The only record of why an agent decided what it did is the reasoning captured at that moment. AgentLedger preserves that reasoning and makes any later change to it cryptographically detectable.

A note on the storage question: because AgentLedger stores the reasoning in a Salesforce object, that object is editable like any other. AgentLedger does not prevent editing. It makes editing detectable. Every existing way of recording agent output, a field, a note, an event log, is already editable and cannot detect an edit. AgentLedger replaces those editable, undetectable surfaces with one that is editable but tamper-evident: verification returns Tampered if any sealed record was changed.

## Scope and limitations

**What AgentLedger handles today.** Decision provenance for a single agent operating within one Salesforce org. The agent starts a session, records each decision and action with its reasoning, and seals the session. Anyone can later verify the record is unaltered.

**Multi-agent orchestration is not covered yet.** When an orchestrator agent triggers several downstream agents and processes, the decision path spans multiple agents. A session in AgentLedger is scoped to one agent run, and there is no linkage between a parent session and the child sessions it spawned. You cannot currently verify an entire orchestration tree as a single unit. Adding parent-child session linkage is a natural extension and a good area for contribution.

**Agents outside your control boundary are only partially addressable.** When an agent calls an external agent over MCP or another protocol, AgentLedger can record your side of the exchange: what was sent, what came back, and what was done with it. It cannot prove what happened inside the other system. That requires the external party to cryptographically sign their own execution, which is a harder problem that standards work is only beginning to address.

The need for provenance is arguably most acute in exactly these harder cases. AgentLedger addresses the in-org, per-agent foundation first, and the cross-agent and cross-boundary cases build on that foundation.

## Architecture

There are three layers.

**Layer 1: Cryptographic engine** (2 Apex classes)
`HashChainService` and `MerkleTreeService`. SHA-256 hashing, hash-chain verification, Merkle tree construction and sealing. Independent of any business logic.

**Layer 2: Session management** (1 Apex class)
`AgentAuditRecorder`. Manages the audit session lifecycle: start, record, seal, verify. This is the API everything else calls.

**Layer 3: Agentforce integration** (4 Invocable Apex classes)
`StartAgentLedgerSessionAction`, `RecordAgentActionAction`, `SealAgentLedgerSessionAction`, `VerifyAgentLedgerSessionAction`. These are registered as Agent Actions and called by the Agentforce agent. They are generic: they take a record Id and decision content, and work on any object.

The agent reads records using a standard Get Record Details action and takes actions using standard Update Record (or custom) actions. AgentLedger records the decisions and the actions in the tamper-evident chain.

---

## Custom Objects

### Agent_Audit_Session__c

One session per agent run.

| Field API Name | Type | Description |
|---|---|---|
| Name | Auto Number (AAS-{0000}) | Session identifier |
| Session_Id__c | Text(36), Unique | UUID for the session |
| Agent_Id__c | Text(255), Required | Identifier of the AI agent |
| Status__c | Picklist, Required | Active, Sealed, Verified, or Tampered. Unrestricted picklist, so new values propagate cleanly on package upgrade. |
| Merkle_Root__c | Text(64) | SHA-256 Merkle root (set on seal) |
| Record_Count__c | Number(18,0) | Total actions recorded |
| Start_Time__c | DateTime, Required | When the session started |
| End_Time__c | DateTime | When the session was sealed |
| Initiator__c | Text(255) | Optional initiator label |
| Platform__c | Text(100) | Platform identifier |
| Related_Record_Id__c | Text(18) | The Salesforce record this session relates to |

### Agent_Audit_Record__c

One record per decision or action, cryptographically chained to the previous.

| Field API Name | Type | Description |
|---|---|---|
| Name | Auto Number (AAR-{00000}) | Record identifier |
| Audit_Session__c | Master-Detail | Parent session |
| Sequence_Number__c | Number(18,0), Required | Position in the chain (0-indexed) |
| Action_Type__c | Picklist, Required | Query, Validation, Decision, Calculation, Create, Update, Escalation, Tool_Call, Delete |
| Agent_Id__c | Text(255), Required | Agent that performed this action |
| Action_Timestamp__c | DateTime, Required | When this action occurred |
| Input_Context__c | Long Text Area | What the agent evaluated |
| Output_Result__c | Long Text Area | What the agent produced |
| Reasoning__c | Long Text Area | Why the agent took this action |
| Record_Hash__c | Text(64), Required | SHA-256 hash of this record's content plus the previous hash |
| Previous_Hash__c | Text(64) | Hash of the previous record (empty for the first) |

---

## Apex: Cryptographic Engine

### HashChainService.cls

| Method | Signature | Description |
|---|---|---|
| hashString | `String hashString(String data)` | SHA-256, returns 64-char hex |
| hashActionRecord | `String hashActionRecord(Agent_Audit_Record__c record)` | Hashes a record's content fields in deterministic order |
| combineHashes | `String combineHashes(String left, String right)` | Concatenates and hashes two hashes (Merkle pairing) |
| verifyRecord | `Boolean verifyRecord(Agent_Audit_Record__c record)` | Recomputes and compares to the stored hash |
| verifyChain | `VerificationResult verifyChain(List<Agent_Audit_Record__c> records)` | Verifies each hash, each previous-hash link, and sequence contiguity |

`VerificationResult`: `Boolean valid`, `List<String> errors`, `Integer recordsChecked`.

### MerkleTreeService.cls

| Method | Signature | Description |
|---|---|---|
| computeMerkleRoot | `String computeMerkleRoot(List<String> hashes)` | Builds the tree bottom-up, duplicating the last leaf if the count is odd |
| sealSession | `String sealSession(Id sessionId)` | Collects record hashes, computes the root, sets Status to Sealed |

### AgentAuditRecorder.cls

The primary API. Uses positional parameters.

| Method | Signature | Description |
|---|---|---|
| startSession | `Id startSession(String agentId, String relatedRecordId, String platform)` | Creates a session linked to a record, returns its Id |
| recordAction | `Agent_Audit_Record__c recordAction(Id sessionId, String agentId, String actionType, String inputContext, String outputResult, String reasoning)` | Creates a record, computes its hash, chains it, increments the session count |
| sealSession | `String sealSession(Id sessionId)` | Seals via MerkleTreeService, returns the Merkle root |
| verifySession | `VerifySessionResult verifySession(Id sessionId)` | Runs hash-chain, Merkle-root, and record-count checks. Updates Status to Verified if all pass, Tampered if any fail. Sessions can be re-verified any number of times, and the status always reflects the latest check. Never changes the status of a session that has not been sealed. |

`VerifySessionResult`: `Boolean valid`, `String message`, `List<VerificationCheck> checks`.

Note: `startSession`'s middle parameter is `relatedRecordId`, which populates `Related_Record_Id__c`. This is the field the LWC matches on to display the trail on a record page.

---

## Apex: The Four Invocable Actions

These are what Agentforce calls. All are object-agnostic.

### StartAgentLedgerSessionAction
**Label:** Start AgentLedger Session
**Inputs:** `agentId` (required), `relatedRecordId` (required), `platform` (optional, defaults to salesforce)
**Outputs:** `sessionId`, `success`, `errorMessage`
Call first. Store the `sessionId` and pass it to every following action.

### RecordAgentActionAction
**Label:** Record Agent Action
**Inputs:** `sessionId` (required), `agentId` (required), `actionType` (required), `inputContext`, `outputResult`, `reasoning` (required)
**Outputs:** `auditRecordId`, `recordHash`, `sequenceNumber`, `success`, `errorMessage`
`actionType` must be one of the nine valid types. Call once per meaningful step.

### SealAgentLedgerSessionAction
**Label:** Seal AgentLedger Session
**Inputs:** `sessionId` (required)
**Outputs:** `merkleRoot`, `success`, `errorMessage`
Call last, before responding to the user. Once sealed, no further records can be added.

### VerifyAgentLedgerSessionAction
**Label:** Verify AgentLedger Session
**Inputs:** `sessionId` (required)
**Outputs:** `valid`, `message`, `success`, `errorMessage`
Optional in the standard flow. Use to confirm integrity on demand. Verification is repeatable: it sets the session status to Verified or Tampered based on the current state of the records, so a session that was tampered with and then restored will verify successfully again.

---

## Apex Test Classes

### AgentLedgerTest.cls
Tests the core cryptographic engine and the recorder lifecycle: SHA-256 determinism and uniqueness, hash-combination order dependency, Merkle root computation, the full start-record-seal-verify lifecycle, and error handling.

### AgentLedgerActionsTest.cls
Tests the four Invocable Actions end to end: success paths, validation and error paths, the exception path, bulk handling, and a full lifecycle through the action layer. Also covers HashChainService broken-chain detection and MerkleTreeService edge cases.

### RecordAuditTrailControllerTest.cls
Tests the LWC read controller.

All tests pass with every class above 75% coverage.

```bash
sf apex run test --tests AgentLedgerTest --tests AgentLedgerActionsTest --tests RecordAuditTrailControllerTest --result-format human --target-org my-org --wait 10 --code-coverage
```

---

## Lightning Web Component

### recordAuditTrail
Sits on any record page. Queries all AgentLedger sessions linked to the record via `Related_Record_Id__c` through `RecordAuditTrailController.getSessionsForRecord`. Displays each session's status, Merkle root, and the full chain of records with color-coded action-type badges, reasoning, and truncated hashes. Includes a Verify button that recomputes the chain on demand and shows Verified or Tampered.

---

## Agentforce Configuration

The framework ships the Apex and the component. The agent itself is configured through the Setup UI, once per use case.

### 1. Confirm the actions are registered
The four AgentLedger actions ship as GenAiFunction metadata and register automatically on deploy. In Setup > Agentforce Studio > Asset Library, confirm the four actions (Start AgentLedger Session, Record Agent Action, Seal AgentLedger Session, Verify AgentLedger Session) are present. No manual registration is needed.

### 2. Build the agent and subagent
Create an Agentforce (Employee) agent. Add a subagent for your use case (for example, Opportunity Qualification). Assign the four AgentLedger actions plus a standard Get Record Details action, and a standard Update Record action if the agent needs to write.

### 3. Write the subagent instructions

The agent needs instructions telling it to start a session, record each meaningful step, and seal before responding. There are two ways to write these, and both are validated in this repository.

**Approach A: the reusable block.** A generic, task-agnostic set of recording rules you paste into any subagent, followed by your specific task. This is the simplest way to add AgentLedger to a new agent. Recording relies on the agent applying the "record every meaningful step" rule on its own, which is reliable in testing but less prescriptive than spelling out each step.

**Approach B: explicit numbered steps.** You tell the agent exactly what to record at each step of its specific task. This is more verbose and less reusable, but gives tighter control over what gets captured, which helps for complex flows.

Both are shown below. Whichever you use, the sealing instruction must be forceful. In testing, a session left unsealed most often happens on a branch where the agent takes no action or waits for a user confirmation and then ends its turn without sealing. The language below is written to prevent that.

#### Approach A: reusable block

Paste everything above "Your task" into any subagent, then write your own task beneath it.

```
This agent records its work in a tamper-evident AgentLedger session.
Follow these recording rules in addition to your task instructions.

Start: At the very start of the run, before taking any other action,
call "Start AgentLedger Session". Use the record you are working on as
the Related Record Id. Keep the returned Session Id and use it for every
AgentLedger action in this run.

Record: Whenever you query data, validate a condition, make a decision,
perform a calculation, or create or update a record, call "Record Agent
Action" for that step. Provide the Session Id, an Action Type that
matches what you did (Query, Validation, Decision, Calculation, Create,
or Update), what you looked at, what you produced, and your reasoning.
Record every meaningful step, even minor ones. If you have taken an
action and not yet recorded it, record it before continuing.

Seal: Sealing is MANDATORY and must never be skipped. Before you finish
and respond to the user, always call "Seal AgentLedger Session" with the
Session Id. This applies whether or not you updated any record, and
whether or not the user confirmed an action. Never end your turn with a
started but unsealed session. A session that is started and never sealed
is invalid and has no cryptographic protection.

Your task:
[Describe what this agent does. Example, for case escalation:]
Evaluate the Case against escalation criteria. A Case qualifies if its
Priority is High and its Status is not already Escalated. If it
qualifies, set Status to Escalated. If it does not qualify, do not
change the Case. Always confirm with the user before updating the Case.
Whether or not the Case is updated, and whether or not the user
confirms, seal the session before ending your turn.
```

#### Approach B: explicit numbered steps

A fully worked example for opportunity qualification.

```
You are an Opportunity Qualification subagent. When a user asks you to
qualify an Opportunity, follow this exact sequence and do not skip any
step. Steps 1 through 4 must ALL complete before you respond in Step 5.

STEP 1 - Start the audit session.
Call "Start AgentLedger Session" with:
- Agent Id: "opportunity-qualification"
- Related Record Id: the Id of the Opportunity being qualified
- Platform: "salesforce"
Save the returned Session Id. Pass it to every following AgentLedger action.

STEP 1.5 - Retrieve the Opportunity data.
Use "Get Record Details" to fetch Name, Amount, StageName, CloseDate,
and Probability. Then call "Record Agent Action" with Action Type
"Query", passing the same Session Id, with Reasoning describing what
you retrieved.

STEP 2 - Evaluate against the qualification criteria.
Assess three criteria:
1. Deal size: Amount is $10,000 or more.
2. Timeline: CloseDate is within the next 120 days from today.
3. Momentum: Probability is 10% or higher.
For EACH criterion, call "Record Agent Action" with Action Type
"Validation". In Output Result, state whether it passed or failed and
the actual value. In Reasoning, explain the check in plain language.

STEP 3 - Make the qualification decision.
Count how many criteria passed:
- All three passed: decision is "Advance".
- Two passed: decision is "Needs Work".
- One or zero passed: decision is "Human Review Required".
Call "Record Agent Action" with Action Type "Decision". State the
decision and how many criteria passed in Output Result, and summarize
the reasoning.

STEP 3.5 - If the decision is "Advance", update the Opportunity.
Only if the decision was "Advance": use "Update Record" to set
StageName to "Needs Analysis", then call "Record Agent Action" with
Action Type "Update" describing the change. If the decision was "Needs
Work" or "Human Review Required", do NOT update the Opportunity.

STEP 4 - Seal the session. THIS STEP IS MANDATORY AND CANNOT BE SKIPPED.
Call "Seal AgentLedger Session" with the same Session Id. This is always
the LAST AgentLedger action. Do not respond to the user until the seal
has completed and Success is true. If you started a session in Step 1,
you must seal it here, whether or not you updated the Opportunity. Never
end your turn with an unsealed session.

STEP 5 - Respond in plain language.
Only after the seal has completed, give your recommendation in plain
language: how many criteria were met and what the decision was. If you
advanced the stage, say so. Do not mention Session Ids, hashes, or
Merkle roots unless the user asks about the audit trail.
```

Both agents above are validated end to end in this repository, on Opportunity and Case respectively, using the same four Invocable Actions with no code changes between them.

### 4. Add the LWC to the record page
In Lightning App Builder, add the `recordAuditTrail` component to the record page of the object your agent acts on.

---

## Testing

### Test 1: Run the agent
In the Agentforce Builder Conversation Preview, type a request naming a record Id (for example, `Qualify Opportunity 006XXXXXXXXXXXX`). Watch the agent start a session, record its steps, and seal. Then open the record and confirm the audit trail appears in the `recordAuditTrail` component. Click Verify to confirm the chain is intact.

### Test 2: Different records
Run the agent on records with different values. The reasoning and decisions will differ because the agent works from real data.

### Test 3: Tamper detection
1. Run the agent to create a sealed session.
2. Click Verify. The session shows Verified.
3. Edit a content field (for example, Reasoning) on one audit record.
4. Return to the record page and click Verify.
5. It shows Tampered, because the stored hash was computed from the original content. The session status updates to Tampered as well.
6. Restore the field to its original content and click Verify again. The session returns to Verified.

This proves that any modification to a decision record after sealing is detected, and that verification reflects the current state of the records rather than a one-time verdict.

### Test 4: Second object with no code changes
Repeat the configuration steps for a different object (for example, Case). Register the same four actions to a new subagent, point Get Record Details and Update Record at Case, and drop the same LWC on the Case page. The framework works unchanged. This demonstrates the actions and the component are genuinely generic.

---

## How the Hash Chain Works

When `recordAction` is called:

1. A canonical string is built from the record's content fields in a fixed order: sessionId, sequenceNumber, timestamp, agentId, actionType, inputContext, outputResult, reasoning, previousHash.
2. SHA-256 is computed via `Crypto.generateDigest('SHA-256', Blob.valueOf(canonical))`.
3. The 64-character hex result is stored in `Record_Hash__c`.
4. The previous record's `Record_Hash__c` is stored in `Previous_Hash__c`.

To verify: recompute the hash from the current field values. If it matches, the content is unchanged. If any field was modified, the recomputed hash differs.

The canonical field order is locked. It must never change after deployment, or previously sealed sessions would fail verification.

## How the Merkle Tree Works

When `sealSession` is called:

1. All `Record_Hash__c` values are collected in sequence order.
2. Adjacent pairs are combined: `sha256(left + right)`.
3. If the leaf count is odd, the last leaf is duplicated.
4. This continues level by level until one root remains.
5. The root is stored in `Merkle_Root__c` and Status is set to Sealed.

To verify: recompute the root from the current record hashes and compare to the stored root. If they match, no record was added, removed, or modified.

---

## Optional: Blockchain Anchoring

The Merkle root can be anchored to an external ledger to provide independent, off-platform proof that a session existed at a point in time, moving the guarantee from tamper-evidence to non-repudiation. This is an optional extension and is not included in this package, to keep the core dependency-free. It is implemented by adding an async callout after sealing that publishes the Merkle root to an anchoring endpoint, plus fields on the session to hold the transaction hash and network. Contact the author for the reference anchoring service.

---

## File Inventory

### Apex Classes

| File | Purpose |
|---|---|
| HashChainService.cls | SHA-256 hashing, record hashing, chain verification |
| MerkleTreeService.cls | Merkle tree construction and session sealing |
| AgentAuditRecorder.cls | Session lifecycle and recording API |
| RecordAuditTrailController.cls | Read controller for the record-page component |
| StartAgentLedgerSessionAction.cls | Invocable: start session |
| RecordAgentActionAction.cls | Invocable: record a decision or action |
| SealAgentLedgerSessionAction.cls | Invocable: seal session |
| VerifyAgentLedgerSessionAction.cls | Invocable: verify session |
| AgentLedgerTest.cls | Core framework and recorder tests |
| AgentLedgerActionsTest.cls | Invocable action and coverage tests |
| RecordAuditTrailControllerTest.cls | LWC controller tests |

### Lightning Web Component

| Component | Purpose |
|---|---|
| recordAuditTrail/ | Record-page audit trail viewer with Verify |

### Custom Objects

| Object | Purpose |
|---|---|
| Agent_Audit_Session__c/ | Session metadata and Merkle root |
| Agent_Audit_Record__c/ | Individual action records with hash chains |

### Agent Action Registrations

| Folder | Purpose |
|---|---|
| genAiFunctions/Start_AgentLedger_Session/ | Registers the Start action in the Asset Library |
| genAiFunctions/Record_Agent_Action/ | Registers the Record action |
| genAiFunctions/Seal_AgentLedger_Session/ | Registers the Seal action |
| genAiFunctions/Verify_AgentLedger_Session/ | Registers the Verify action |

Each references its Apex class by name and contains no org-specific IDs, so the actions register automatically on deploy.

### Other Metadata

| File | Purpose |
|---|---|
| permissionsets/AgentLedger_Admin.permissionset-meta.xml | Object, field, and Apex class access |
| tabs/Agent_Audit_Session__c.tab-meta.xml | Session list tab |
| tabs/Agent_Audit_Record__c.tab-meta.xml | Record list tab |

---

## Deployment

```bash
sf org login web --alias my-org
sf project deploy start --source-dir salesforce/force-app --target-org my-org
sf org assign permset --name AgentLedger_Admin --target-org my-org
```

After deployment, configure the Agentforce agent and add the LWC to a record page through the Setup UI, as described in Agentforce Configuration above.
