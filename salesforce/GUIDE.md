# AgentLedger for Salesforce: Complete Technical Guide

## Overview

AgentLedger is a cryptographic audit trail framework deployed in a Salesforce Developer Edition org. It records every decision an AI agent makes using SHA-256 hash chains and Merkle trees, creating tamper-proof, independently verifiable audit records.

The POC integrates with Salesforce Agentforce. When an Agentforce agent qualifies an Opportunity, every action the agent takes is automatically recorded in AgentLedger's audit trail. The agent does not know it is being audited. The auditing is embedded in the Invocable Actions the agent calls.

---

## Architecture

There are three layers:

**Layer 1: Cryptographic Engine** (3 Apex classes)
Handles SHA-256 hashing, hash chain verification, Merkle tree construction, proof generation, and proof verification. This is the core framework, independent of any business logic.

**Layer 2: Session Management** (1 Apex class)
Manages the lifecycle of audit sessions: starting, recording actions, sealing with Merkle roots, and verifying integrity. This is the API that other code calls.

**Layer 3: Agentforce Integration** (6 Invocable Apex classes)
Wraps business logic (opportunity lookup, deal assessment, record updates, task creation) with AgentLedger recording. These are registered as Agentforce Agent Actions and called by the Agentforce AI agent.

---

## Custom Objects

### Agent_Audit_Session__c

Stores the metadata for a complete audit session. One session per agent invocation.

| Field API Name | Type | Description |
|---|---|---|
| Name | Auto Number (AAS-{0000}) | Session identifier |
| Session_Id__c | Text(36), Unique, External ID | UUID for the session |
| Agent_Id__c | Text(255), Required | Name of the AI agent |
| Status__c | Picklist, Required | Active, Sealed, or Verified |
| Merkle_Root__c | Text(64) | SHA-256 Merkle root (set when sealed) |
| Record_Count__c | Number(18,0) | Total actions recorded |
| Start_Time__c | DateTime, Required | When the session started |
| End_Time__c | DateTime | When the session was sealed |
| Initiator__c | Text(255) | Who or what triggered the session |
| Platform__c | Text(100) | Platform identifier (e.g., salesforce-agentforce) |
| Related_Record_Id__c | Text(18) | Salesforce record ID this session relates to |

### Agent_Audit_Record__c

Stores individual agent actions within a session. Each record is cryptographically chained to the previous one.

| Field API Name | Type | Description |
|---|---|---|
| Name | Auto Number (AAR-{00000}) | Record identifier |
| Audit_Session__c | Master-Detail(Agent_Audit_Session__c) | Parent session |
| Sequence_Number__c | Number(18,0), Required | Position in the chain (0-indexed) |
| Action_Type__c | Picklist, Required | Query, Update, Create, Delete, Decision, Escalation, Tool_Call, Calculation, Validation |
| Agent_Id__c | Text(255), Required | Agent that performed this action |
| Action_Timestamp__c | DateTime, Required | When this action occurred |
| Input_Context__c | Long Text Area(131072) | JSON of what the agent received as input |
| Output_Result__c | Long Text Area(131072) | JSON of what the agent produced |
| Reasoning__c | Long Text Area(131072) | Why the agent took this action |
| Record_Hash__c | Text(64), Required | SHA-256 hash of this record's content + previous hash |
| Previous_Hash__c | Text(64) | Hash of the previous record (null for first record) |

---

## Apex Classes: Cryptographic Engine

### HashChainService.cls

The cryptographic foundation. All hashing operations use the Apex `Crypto` class with SHA-256.

**Methods:**

| Method | Signature | Description |
|---|---|---|
| sha256 | `String sha256(String data)` | Computes SHA-256 hash, returns 64-char hex string |
| hashActionRecord | `String hashActionRecord(Agent_Audit_Record__c record)` | Computes hash from a record's content fields in deterministic order |
| combineHashes | `String combineHashes(String left, String right)` | Concatenates two hashes and hashes the result (for Merkle tree) |
| verifyRecord | `Boolean verifyRecord(Agent_Audit_Record__c record)` | Recomputes hash and compares to stored hash. Returns false if content was modified. |
| verifyChain | `VerificationResult verifyChain(List<Agent_Audit_Record__c> records)` | Verifies entire chain: each hash valid, each previousHash matches prior record, sequence numbers contiguous, first record has null previousHash |

**VerificationResult inner class:**
- `Boolean valid` - overall pass/fail
- `List<String> errors` - specific failure details
- `Integer recordsChecked` - number of records examined

### MerkleTreeService.cls

Builds Merkle trees from action record hashes and generates/verifies proofs.

**Methods:**

| Method | Signature | Description |
|---|---|---|
| computeMerkleRoot | `String computeMerkleRoot(List<String> hashes)` | Builds Merkle tree bottom-up, returns root hash. Duplicates last hash if odd count. |
| generateProof | `MerkleProof generateProof(List<String> hashes, Integer recordIndex)` | Generates sibling hashes needed to verify one record against the root |
| verifyProof | `Boolean verifyProof(MerkleProof proof)` | Recomputes root from record hash + siblings, compares to claimed root |
| sealSession | `String sealSession(Id sessionId)` | Queries all records for a session, computes Merkle root, updates session status to Sealed |

**MerkleProof inner class:**
- `Integer recordIndex` - which record this proves
- `String recordHash` - the record's hash
- `List<ProofSibling> siblings` - sibling hashes with position (left/right)
- `String root` - the Merkle root this should resolve to

**How Merkle proofs work:**
To verify that Record #3 belongs to a sealed session, you don't need all records. You need Record #3's hash and the sibling hashes along the path from Record #3's leaf to the root. You recompute upward: hash(record + sibling) at each level. If you arrive at the same root, the record is verified. This takes O(log n) operations instead of O(n).

### AgentAuditRecorder.cls

The primary API. Other code calls this to manage sessions and record actions.

**Methods:**

| Method | Signature | Description |
|---|---|---|
| startSession | `Id startSession(String agentId, String initiator, String platform)` | Creates a new session, returns its record Id |
| recordAction | `Agent_Audit_Record__c recordAction(Id sessionId, String agentId, String actionType, String inputContext, String outputResult, String reasoning)` | Creates a new action record, computes its hash, chains to previous record, updates session record count |
| sealSession | `String sealSession(Id sessionId)` | Delegates to MerkleTreeService.sealSession |
| verifySession | `VerifySessionResult verifySession(Id sessionId)` | Runs all verification checks: hash chain integrity, Merkle root integrity, record count consistency. Updates session status to Verified if all pass. |
| getSessionRecords | `List<Agent_Audit_Record__c> getSessionRecords(Id sessionId)` | Returns all records ordered by sequence number (AuraEnabled, cacheable) |
| getSession | `Agent_Audit_Session__c getSession(Id sessionId)` | Returns session details (AuraEnabled, cacheable) |
| generateProof | `MerkleTreeService.MerkleProof generateProof(Id sessionId, Integer recordIndex)` | Generates a Merkle proof for a specific record |
| runDemo | `Id runDemo()` | Creates a complete demo session with 7 CPQ pricing actions, seals it, returns session Id |

**VerifySessionResult inner class:**
- `Boolean valid`
- `String message`
- `List<VerificationCheck> checks` (each with name, passed, detail)

---

## Apex Classes: Agentforce Integration

These are the 6 Invocable Actions that Agentforce calls. Each one performs real business logic AND records itself in AgentLedger. The agent does not call AgentLedger directly. The auditing is transparent.

### AuditedStartSession.cls

**Invocable Label:** Start Audited Session

**What it does:** Creates a new AgentLedger session and optionally links it to a Salesforce record (e.g., an Opportunity).

**Inputs:**
- agentName (String, optional) - defaults to "agentforce-agent"
- initiator (String, optional) - defaults to "agentforce"
- relatedRecordId (String, optional) - links the session to a specific record

**Outputs:**
- sessionId (Id) - the session record Id, passed to all subsequent actions
- message (String) - confirmation

### AuditedLookupOpportunity.cls

**Invocable Label:** Lookup Opportunity (Audited)

**What it does:** Queries the Opportunity and its parent Account using SOQL. Returns all relevant fields. Records the query and its results in AgentLedger.

**Inputs:**
- sessionId (Id, required)
- opportunityId (Id, required)

**Outputs:**
- opportunityName, amount, stage, closeDate, leadSource, oppType, probability, accountName, accountIndustry, accountRevenue, accountEmployees, accountLocation, daysUntilClose, description, summary

**AgentLedger record created:**
- Action Type: Query
- Input: the SOQL query parameters
- Output: all returned field values as JSON
- Reasoning: natural language summary of what was retrieved

### AuditedAssessDeal.cls

**Invocable Label:** Assess Deal (Audited)

**What it does:** Evaluates the opportunity based on real data. This is our business logic, not Salesforce standard functionality.

**Assessment logic:**
- Deal classification by amount: Standard (<$50K), Mid-Market ($50K-$199K), Enterprise ($200K-$499K), Strategic ($500K+)
- Win probability starts at 50% base, then adjusts:
  - Existing customer: +15%
  - Partner Referral lead source: +10%
  - Customer Event / Employee Referral: +7%
  - Web / Phone Inquiry: +3%
  - Account revenue > $50M: +5%
  - Close date 30-90 days out: +5%
  - Close date < 14 days: -10%
  - Close date > 180 days: -8%
  - Capped at 95%
- Risk factors and positive factors identified from the data
- Recommendation generated based on probability

**Inputs:**
- sessionId (Id, required)
- amount, oppType, leadSource, accountRevenue, daysUntilClose, description (all optional)

**Outputs:**
- dealClassification, winProbability, confidenceLevel, approvalLevel, reviewCadence, existingCustomerBonus, riskFactors, positiveFactors, recommendation, summary

**AgentLedger record created:**
- Action Type: Calculation
- Input: all assessment input factors
- Output: classification, probability, confidence, recommendation
- Reasoning: detailed explanation of how the probability was calculated and why

### AuditedUpdateOpportunity.cls

**Invocable Label:** Update Opportunity (Audited)

**What it does:** Updates real Opportunity fields (stage, probability, next step, description). Captures before/after state.

**Inputs:**
- sessionId (Id, required)
- opportunityId (Id, required)
- newStage, newProbability, nextStep, addToDescription (all optional)

**Outputs:**
- success, previousStage, newStage, previousProbability, newProbability, fieldsChanged, summary

**AgentLedger record created:**
- Action Type: Create
- Input: the fields and values being updated
- Output: success status, before/after values, field count
- Reasoning: summary of all changes made

### AuditedCreateTask.cls

**Invocable Label:** Create Follow-up Task (Audited)

**What it does:** Creates a real Task record linked to the Opportunity.

**Inputs:**
- sessionId (Id, required)
- subject (String, required)
- relatedToId (Id, required)
- dueDate (Date, optional - defaults to 3 days from now)
- priority (String, optional - defaults to "Normal")
- taskDescription (String, optional)

**Outputs:**
- taskId, subject, dueDate, priority, summary

**AgentLedger record created:**
- Action Type: Create
- Input: task parameters
- Output: created task details
- Reasoning: description of the task and why it was created

### AuditedSealSession.cls

**Invocable Label:** Seal Audited Session

**What it does:** Computes the Merkle root from all recorded actions, seals the session (no further recording possible), and auto-verifies.

**Inputs:**
- sessionId (Id, required)

**Outputs:**
- merkleRoot (String) - the 64-character SHA-256 Merkle root
- recordCount (Integer)
- verified (Boolean)
- summary (String)

---

## Apex Test Classes

### AgentLedgerTest.cls (24 tests)
Tests the core cryptographic engine:
- SHA-256 determinism, uniqueness, unicode handling
- Hash combination order dependency
- Merkle root computation, determinism, order sensitivity
- Merkle proof generation, verification, tamper rejection
- Session lifecycle: start, record, chain, seal, verify
- Error handling: empty session seal, post-seal recording
- Full demo workflow

### AgentLedgerDemoControllerTest.cls
Tests the CPQ pricing demo controller (the scripted demo).

### OpportunityAgentDemoControllerTest.cls
Tests the Opportunity qualification demo controller (the scripted demo with tamper detection).

### AgentforceAuditedActionsTest.cls (3 tests)
Tests the Agentforce integration end-to-end:
- Full agent workflow: start session, lookup, assess, update, seal, verify
- Verifies real Opportunity stage change and Task creation
- Tests deal assessment variations (Standard vs Enterprise vs Strategic)

### RecordAuditTrailControllerTest.cls
Tests the record page audit trail viewer.

---

## Lightning Web Components

### agentLedgerDemo
Three-panel CPQ pricing demo. Left panel shows workflow steps, center shows audit trail building in real time, right panel explains the cryptography. Includes Merkle Proof verification buttons.

### opportunityAgentDemo
Presentation-ready Opportunity qualification demo. Creates real Account + Opportunity, runs a 7-step agent workflow, seals and verifies, includes Merkle Proof buttons and a Tamper Detection Demo that modifies a record and shows verification failing.

### recordAuditTrail
Sits on any record page (Opportunity, Account, etc.). Queries all AgentLedger sessions linked to that record via Related_Record_Id__c. Displays the audit trail with action types, reasoning, hashes, and chain links. Includes a Verify button.

---

## Agentforce Configuration

### Agent: Opportunity Qualifier
- Type: AgentforceEmployeeAgent
- Description: Evaluates and qualifies Salesforce Opportunities

### Subagent: Opportunity Qualification
- Classification: Qualifies opportunities by looking up deal data, assessing win probability, updating stages, and creating follow-up tasks with AgentLedger audit trail
- Scope: Qualifies opportunities using AgentLedger audited actions only
- Instruction: When asked to qualify an opportunity, call Start Audited Session first, then Lookup Opportunity, then Assess Deal, then Update Opportunity if win probability is above 50%, then Create Follow-up Task, then Seal Audited Session. Always pass the session ID from the first action to all subsequent actions.
- Actions: All 6 audited actions attached

### Agent Actions (registered in Agentforce Asset Library)
All 6 Invocable Methods registered as Agent Actions:
1. Start Audited Session
2. Lookup Opportunity (Audited)
3. Assess Deal (Audited)
4. Update Opportunity (Audited)
5. Create Follow-up Task (Audited)
6. Seal Audited Session

---

## Other Metadata

### Permission Set: AgentLedger_Admin
Grants read/write access to Agent_Audit_Session__c and Agent_Audit_Record__c objects and their non-required fields.

### Tabs
- Agent_Audit_Session__c tab (Custom73: Handshake icon)
- Agent_Audit_Record__c tab (Custom55: Locks icon)
- AgentLedger Demo tab (LWC component)

---

## How to Test

### Test 1: Run the Agentforce Agent

1. Open the Agentforce Builder: Setup > Agentforce Studio > Agentforce Agents > Opportunity Qualifier
2. In the Conversation Preview panel, type: `Qualify opportunity [paste an Opportunity ID]`
3. Watch the agent execute. It will:
   - Start an audit session
   - Look up the Opportunity and Account data
   - Assess the deal (classification, win probability, risks)
   - Update the Opportunity stage and probability
   - Create a follow-up Task
   - Seal the audit session with a Merkle root
4. Navigate to the Opportunity record. The right sidebar should show the AgentLedger Audit Trail component with all actions, hashes, and chain links.
5. Click Verify to confirm the chain is intact.

### Test 2: Verify with Different Opportunities

Create opportunities with different amounts, stages, lead sources, and account profiles. Run the agent on each one. The deal classification and win probability will differ because the assessment logic uses real data:
- $25,000 New Business from Web lead = Standard deal, lower probability
- $275,000 Existing Business from Partner Referral = Enterprise deal, higher probability
- $750,000 Existing Business from Partner Referral with large account = Strategic deal, high probability

### Test 3: Tamper Detection

1. Run the agent on an Opportunity to create a sealed session
2. Open the Agent_Audit_Record__c records (add Output_Result__c and Reasoning__c to the page layout if not visible)
3. Edit one of the content fields on any audit record (e.g., change "85%" to "95%" in the Reasoning__c field)
4. Go back to the Opportunity record page
5. Click Verify on the AgentLedger Audit Trail component
6. It should show FAILED because the stored hash was computed from the original content. The content changed but the hash didn't, so they no longer match.

This proves: if anyone modifies what the agent said it did after the session was sealed, AgentLedger detects it.

### Test 4: Merkle Proofs (Scripted Demo)

1. Navigate to the Opportunity Agent Demo tab
2. Click Start Demo (or Run Again)
3. After the demo completes, scroll to the Merkle Proof section
4. Click any record button to generate a proof
5. The proof verifies that one specific record belongs to the sealed session without needing access to all other records

### Test 5: Tamper Detection (Scripted Demo)

1. Run the Opportunity Agent Demo
2. Scroll to the Tamper Detection Demo section (red card)
3. Click Simulate Tampering
4. It modifies Record #3's reasoning from 72% to 95% directly in the database
5. Re-runs verification, which fails
6. Click Restore Original Record to fix it

### Test 6: Run All Apex Tests

```bash
sf apex run test --class-names AgentLedgerTest,AgentLedgerDemoControllerTest,OpportunityAgentDemoControllerTest,AgentforceAuditedActionsTest,RecordAuditTrailControllerTest --result-format human --target-org agentledger-dev --wait 10
```

All tests should pass. Total: 24 + demo tests + integration tests.

---

## How the Hash Chain Works (Technical Detail)

When `AgentAuditRecorder.recordAction()` is called:

1. A canonical string is built from the record's content fields in fixed order: sessionId, sequenceNumber, timestamp, agentId, actionType, inputContext, outputResult, reasoning, previousHash
2. This string is JSON-serialized to ensure deterministic ordering
3. SHA-256 is computed via `Crypto.generateDigest('SHA-256', Blob.valueOf(canonical))`
4. The resulting 64-character hex string is stored in Record_Hash__c
5. The previous record's Record_Hash__c is stored in Previous_Hash__c

To verify: recompute the hash from the current field values. If it matches Record_Hash__c, the content is unchanged. If any field was modified after creation, the recomputed hash will differ.

## How the Merkle Tree Works (Technical Detail)

When `MerkleTreeService.sealSession()` is called:

1. All Record_Hash__c values are collected in sequence order
2. Each hash is hashed again to create leaf nodes: `sha256(recordHash)`
3. Leaves are paired. Each pair is combined: `sha256(leftLeaf + rightLeaf)`
4. If odd number of leaves, the last one is duplicated
5. This continues level by level until one root hash remains
6. The root is stored in the session's Merkle_Root__c field
7. Session Status__c is set to "Sealed"

To verify: recompute the Merkle root from the current record hashes. Compare to the stored root. If they match, no records were added, removed, or modified.

---

## File Inventory

### Apex Classes (force-app/main/default/classes/)

| File | Purpose |
|---|---|
| HashChainService.cls | SHA-256 hashing, record hashing, chain verification |
| MerkleTreeService.cls | Merkle tree construction, proof generation/verification, session sealing |
| AgentAuditRecorder.cls | Session lifecycle management, recording API |
| AgentLedgerDemoController.cls | Controller for the CPQ pricing LWC demo |
| OpportunityAgentDemoController.cls | Controller for the Opportunity qualification LWC demo |
| RecordAuditTrailController.cls | Controller for the record page audit trail component |
| AuditedStartSession.cls | Agentforce Invocable: start audit session |
| AuditedLookupOpportunity.cls | Agentforce Invocable: query opportunity + account |
| AuditedAssessDeal.cls | Agentforce Invocable: classify deal + calculate win probability |
| AuditedUpdateOpportunity.cls | Agentforce Invocable: update opportunity fields |
| AuditedCreateTask.cls | Agentforce Invocable: create follow-up task |
| AuditedSealSession.cls | Agentforce Invocable: seal + verify session |
| AgentLedgerTest.cls | Core framework tests (24 tests) |
| AgentLedgerDemoControllerTest.cls | CPQ demo tests |
| OpportunityAgentDemoControllerTest.cls | Opportunity demo tests |
| AgentforceAuditedActionsTest.cls | Agentforce integration tests |
| RecordAuditTrailControllerTest.cls | Record page component tests |

### Lightning Web Components (force-app/main/default/lwc/)

| Component | Purpose |
|---|---|
| agentLedgerDemo/ | CPQ pricing demo with 3-panel layout |
| opportunityAgentDemo/ | Opportunity qualification demo with tamper detection |
| recordAuditTrail/ | Record page component showing audit trail |

### Custom Objects (force-app/main/default/objects/)

| Object | Purpose |
|---|---|
| Agent_Audit_Session__c/ | Audit session metadata + Merkle root |
| Agent_Audit_Record__c/ | Individual agent action records with hash chains |

### Other Metadata

| File | Purpose |
|---|---|
| permissionsets/AgentLedger_Admin.permissionset-meta.xml | Object and field permissions |
| tabs/Agent_Audit_Session__c.tab-meta.xml | Session list tab |
| tabs/Agent_Audit_Record__c.tab-meta.xml | Record list tab |
| tabs/AgentLedger_Demo.tab-meta.xml | CPQ demo tab |

---

## Deployment

To deploy everything to a Salesforce org:

```bash
sf org login web --alias agentledger-dev
sf project deploy start --source-dir force-app --target-org agentledger-dev
```

To run all tests after deployment:

```bash
sf apex run test --class-names AgentLedgerTest,AgentforceAuditedActionsTest --result-format human --target-org agentledger-dev --wait 10
```

To assign the permission set to yourself:

```bash
sf org assign permset --name AgentLedger_Admin --target-org agentledger-dev
```

After deployment, the Agentforce Agent and Agent Actions must be configured through the Salesforce Setup UI (see Agentforce Configuration section above).
