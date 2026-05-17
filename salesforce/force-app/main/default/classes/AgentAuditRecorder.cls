/**
 * AgentAuditRecorder
 *
 * The primary Salesforce-native API for AgentLedger. Manages the lifecycle
 * of audit sessions: creation, recording actions, sealing, and verification.
 *
 * Usage:
 *   Id sessionId = AgentAuditRecorder.startSession('pricing-agent', 'dealer-portal', 'salesforce');
 *   AgentAuditRecorder.recordAction(sessionId, 'pricing-agent', 'Query',
 *       '{"query":"get dealer tier"}', '{"tier":"Platinum"}', 'Retrieved dealer profile');
 *   AgentAuditRecorder.sealSession(sessionId);
 *   AgentAuditRecorder.VerifySessionResult result = AgentAuditRecorder.verifySession(sessionId);
 */
public with sharing class AgentAuditRecorder {

    /**
     * Start a new audit session.
     *
     * @param agentId Identifier for the AI agent
     * @param initiator Who or what initiated the session
     * @param platform Platform identifier
     * @return The Salesforce record Id of the new session
     */
    public static Id startSession(String agentId, String initiator, String platform) {
        Agent_Audit_Session__c session = new Agent_Audit_Session__c(
            Session_Id__c = generateUUID(),
            Agent_Id__c = agentId,
            Status__c = 'Active',
            Start_Time__c = DateTime.now(),
            Initiator__c = initiator,
            Platform__c = platform,
            Record_Count__c = 0
        );
        insert session;
        return session.Id;
    }

    /**
     * Record an agent action within an existing session.
     * Automatically computes the SHA-256 hash and chains it to
     * the previous record.
     *
     * @param sessionId The session record Id
     * @param agentId Agent identifier
     * @param actionType Type of action (Query, Update, Create, etc.)
     * @param inputContext JSON string of input context
     * @param outputResult JSON string of output result
     * @param reasoning Agent's reasoning for this action
     * @return The created Agent_Audit_Record__c
     */
    public static Agent_Audit_Record__c recordAction(
        Id sessionId,
        String agentId,
        String actionType,
        String inputContext,
        String outputResult,
        String reasoning
    ) {
        // Verify session is still active
        Agent_Audit_Session__c session = [
            SELECT Id, Status__c, Record_Count__c
            FROM Agent_Audit_Session__c
            WHERE Id = :sessionId
            LIMIT 1
        ];

        if (session.Status__c != 'Active') {
            throw new MerkleTreeService.AgentLedgerException(
                'Cannot record actions in a ' + session.Status__c +
                ' session. Sessions are immutable once sealed.');
        }

        // Get the previous record's hash for chaining
        Integer sequenceNumber = (Integer) session.Record_Count__c;
        String previousHash = null;

        if (sequenceNumber > 0) {
            List<Agent_Audit_Record__c> prevRecords = [
                SELECT Record_Hash__c
                FROM Agent_Audit_Record__c
                WHERE Audit_Session__c = :sessionId
                ORDER BY Sequence_Number__c DESC
                LIMIT 1
            ];
            if (!prevRecords.isEmpty()) {
                previousHash = prevRecords[0].Record_Hash__c;
            }
        }

        // Create the record
        Agent_Audit_Record__c record = new Agent_Audit_Record__c(
            Audit_Session__c = sessionId,
            Sequence_Number__c = sequenceNumber,
            Action_Timestamp__c = DateTime.now(),
            Agent_Id__c = agentId,
            Action_Type__c = actionType,
            Input_Context__c = inputContext,
            Output_Result__c = outputResult,
            Reasoning__c = reasoning,
            Previous_Hash__c = previousHash
        );

        // Compute hash before insert so we can include the record fields
        // We use a temporary hash based on content since we don't have the Id yet
        String tempHash = computePreInsertHash(
            sessionId, sequenceNumber, agentId, actionType,
            inputContext, outputResult, reasoning, previousHash
        );
        record.Record_Hash__c = tempHash;

        insert record;

        // Update session record count
        session.Record_Count__c = sequenceNumber + 1;
        update session;

        return record;
    }

    /**
     * Seal a session. Computes the Merkle root and prevents further recording.
     *
     * @param sessionId The session record Id
     * @return The computed Merkle root hash
     */
    public static String sealSession(Id sessionId) {
        return MerkleTreeService.sealSession(sessionId);
    }

    /**
     * Verify the complete integrity of a session.
     * Checks hash chain integrity and Merkle root.
     *
     * @param sessionId The session record Id
     * @return VerifySessionResult with detailed outcomes
     */
    @AuraEnabled
    public static VerifySessionResult verifySession(Id sessionId) {
        VerifySessionResult result = new VerifySessionResult();
        result.checks = new List<VerificationCheck>();

        // Get session
        Agent_Audit_Session__c session = [
            SELECT Id, Status__c, Merkle_Root__c, Record_Count__c
            FROM Agent_Audit_Session__c
            WHERE Id = :sessionId
            LIMIT 1
        ];

        // Get all records ordered by sequence
        List<Agent_Audit_Record__c> records = [
            SELECT Id, Name, Audit_Session__c, Sequence_Number__c,
                   Action_Timestamp__c, Agent_Id__c, Action_Type__c,
                   Input_Context__c, Output_Result__c, Reasoning__c,
                   Record_Hash__c, Previous_Hash__c
            FROM Agent_Audit_Record__c
            WHERE Audit_Session__c = :sessionId
            ORDER BY Sequence_Number__c ASC
        ];

        // Check 1: Hash chain integrity
        HashChainService.VerificationResult chainResult = HashChainService.verifyChain(records);
        VerificationCheck chainCheck = new VerificationCheck();
        chainCheck.name = 'hash_chain_integrity';
        chainCheck.passed = chainResult.valid;
        chainCheck.detail = chainResult.valid
            ? 'All ' + records.size() + ' records have valid hashes and chain linkage'
            : String.join(chainResult.errors, '; ');
        result.checks.add(chainCheck);

        // Check 2: Merkle root (only if sealed)
        if (session.Status__c == 'Sealed' || session.Status__c == 'Verified') {
            List<String> hashes = new List<String>();
            for (Agent_Audit_Record__c rec : records) {
                hashes.add(rec.Record_Hash__c);
            }
            String recomputedRoot = MerkleTreeService.computeMerkleRoot(hashes);
            Boolean rootValid = recomputedRoot == session.Merkle_Root__c;

            VerificationCheck rootCheck = new VerificationCheck();
            rootCheck.name = 'merkle_root_integrity';
            rootCheck.passed = rootValid;
            rootCheck.detail = rootValid
                ? 'Merkle root verified: ' + session.Merkle_Root__c.substring(0, 16) + '...'
                : 'Merkle root mismatch: stored ' + session.Merkle_Root__c.substring(0, 16) +
                  '... vs computed ' + (recomputedRoot != null ? recomputedRoot.substring(0, 16) : 'null') + '...';
            result.checks.add(rootCheck);
        }

        // Check 3: Record count
        VerificationCheck countCheck = new VerificationCheck();
        countCheck.name = 'record_count';
        countCheck.passed = records.size() == (Integer) session.Record_Count__c;
        countCheck.detail = 'Session contains ' + records.size() + ' record(s), expected ' +
            session.Record_Count__c.intValue();
        result.checks.add(countCheck);

        // Overall result
        result.valid = true;
        for (VerificationCheck check : result.checks) {
            if (!check.passed) {
                result.valid = false;
                break;
            }
        }

        result.message = result.valid
            ? 'Session verified successfully. ' + records.size() + ' records, chain intact.'
            : 'Session verification FAILED. See checks for details.';

        // Update session status if verified
        if (result.valid && session.Status__c == 'Sealed') {
            session.Status__c = 'Verified';
            update session;
        }

        return result;
    }

    /**
     * Get all records for a session, ordered by sequence.
     * Exposed to LWC via AuraEnabled.
     */
    @AuraEnabled(cacheable=true)
    public static List<Agent_Audit_Record__c> getSessionRecords(Id sessionId) {
        return [
            SELECT Id, Name, Sequence_Number__c, Action_Timestamp__c,
                   Agent_Id__c, Action_Type__c, Input_Context__c,
                   Output_Result__c, Reasoning__c, Record_Hash__c,
                   Previous_Hash__c
            FROM Agent_Audit_Record__c
            WHERE Audit_Session__c = :sessionId
            ORDER BY Sequence_Number__c ASC
        ];
    }

    /**
     * Get session details. Exposed to LWC.
     */
    @AuraEnabled(cacheable=true)
    public static Agent_Audit_Session__c getSession(Id sessionId) {
        return [
            SELECT Id, Name, Session_Id__c, Agent_Id__c, Merkle_Root__c,
                   Status__c, Record_Count__c, Initiator__c, Platform__c,
                   Start_Time__c, End_Time__c
            FROM Agent_Audit_Session__c
            WHERE Id = :sessionId
            LIMIT 1
        ];
    }

    /**
     * Generate a Merkle proof for a specific record in a sealed session.
     * Exposed to LWC.
     */
    @AuraEnabled
    public static MerkleTreeService.MerkleProof generateProof(Id sessionId, Integer recordIndex) {
        List<Agent_Audit_Record__c> records = [
            SELECT Record_Hash__c
            FROM Agent_Audit_Record__c
            WHERE Audit_Session__c = :sessionId
            ORDER BY Sequence_Number__c ASC
        ];

        List<String> hashes = new List<String>();
        for (Agent_Audit_Record__c rec : records) {
            hashes.add(rec.Record_Hash__c);
        }

        return MerkleTreeService.generateProof(hashes, recordIndex);
    }

    /**
     * Run a complete demo that creates a session with sample B2B pricing
     * actions, seals it, and verifies it. Useful for testing and demos.
     *
     * @return The session Id of the created demo session
     */
    public static Id runDemo() {
        // Start session
        Id sessionId = startSession('cpq-pricing-agent', 'dealer-portal', 'salesforce');

        // Record actions
        recordAction(sessionId, 'cpq-pricing-agent', 'Query',
            '{"system":"CRM","dealerId":"DEALER-100"}',
            '{"name":"Midwest Heavy Equipment","tier":"Platinum","region":"Midwest"}',
            'Retrieved dealer profile. Midwest Heavy Equipment is a Platinum tier dealer.');

        recordAction(sessionId, 'cpq-pricing-agent', 'Validation',
            '{"creditStatus":"approved","creditLimit":500000}',
            '{"decision":"proceed","approved":true}',
            'Credit status approved. Limit: $500,000. Proceeding with quote.');

        recordAction(sessionId, 'cpq-pricing-agent', 'Query',
            '{"system":"CPQ","skus":["HYD-100","HYD-200","HYD-300","HYD-400"]}',
            '{"available":4,"unavailable":[]}',
            'Queried CPQ catalog. All 4 requested SKUs available.');

        recordAction(sessionId, 'cpq-pricing-agent', 'Query',
            '{"system":"CPQ","tier":"Platinum"}',
            '{"tierDiscount":0.20,"volumeThreshold":50000,"volumeDiscount":0.05}',
            'Platinum tier rules: 20% base discount, 5% volume above $50,000.');

        recordAction(sessionId, 'cpq-pricing-agent', 'Calculation',
            '{"subtotal":200500,"tierDiscount":0.20,"volumeDiscount":0.05}',
            '{"tierAmount":40100,"volumeAmount":10025,"effectiveRate":0.25,"finalTotal":150375}',
            'Subtotal $200,500. Tier 20% + volume 5% = 25%. Final: $150,375.');

        recordAction(sessionId, 'cpq-pricing-agent', 'Validation',
            '{"orderTotal":150375,"creditLimit":500000}',
            '{"withinLimit":true,"headroom":349625}',
            'Order $150,375 within $500,000 limit. Headroom: $349,625.');

        recordAction(sessionId, 'cpq-pricing-agent', 'Create',
            '{"dealerId":"DEALER-100","total":150375,"lineItems":4}',
            '{"quoteId":"Q-2026-4817","status":"pending_review"}',
            'Generated quote Q-2026-4817. 4 line items, $150,375. Valid 30 days.');

        // Seal
        sealSession(sessionId);

        return sessionId;
    }

    /**
     * Compute hash before insert (when we don't have the Salesforce Id yet).
     * Uses content fields only for deterministic hashing.
     */
    private static String computePreInsertHash(
        Id sessionId, Integer sequenceNumber, String agentId,
        String actionType, String inputContext, String outputResult,
        String reasoning, String previousHash
    ) {
        List<String> parts = new List<String>();
        parts.add(String.valueOf(sessionId));
        parts.add(String.valueOf(sequenceNumber));
        parts.add(String.valueOf(DateTime.now()));
        parts.add(safeString(agentId));
        parts.add(safeString(actionType));
        parts.add(safeString(inputContext));
        parts.add(safeString(outputResult));
        parts.add(safeString(reasoning));
        parts.add(safeString(previousHash));

        String canonical = JSON.serialize(parts);
        return HashChainService.sha256(canonical);
    }

    private static String safeString(String value) {
        return value != null ? value : '';
    }

    /**
     * Generate a UUID v4 (pseudo-random).
     */
    private static String generateUUID() {
        String hex = EncodingUtil.convertToHex(Crypto.generateAesKey(128));
        return hex.substring(0, 8) + '-' +
               hex.substring(8, 12) + '-4' +
               hex.substring(13, 16) + '-' +
               hex.substring(16, 20) + '-' +
               hex.substring(20, 32);
    }

    public class VerifySessionResult {
        @AuraEnabled public Boolean valid;
        @AuraEnabled public String message;
        @AuraEnabled public List<VerificationCheck> checks;
    }

    public class VerificationCheck {
        @AuraEnabled public String name;
        @AuraEnabled public Boolean passed;
        @AuraEnabled public String detail;
    }
}
