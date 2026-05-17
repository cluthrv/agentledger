/**
 * AgentLedgerDemoController
 *
 * Apex controller for the AgentLedger Lightning Web Component demo.
 * Provides step-by-step agent execution, session management, and
 * verification endpoints that can be called from LWC.
 */
public with sharing class AgentLedgerDemoController {

    /**
     * Start a new demo session.
     * @return The session record Id
     */
    @AuraEnabled
    public static Id startDemoSession() {
        return AgentAuditRecorder.startSession(
            'cpq-pricing-agent',
            'dealer-portal-demo',
            'salesforce'
        );
    }

    /**
     * Execute a single step in the CPQ pricing workflow.
     * Each call records one action and returns the result for UI display.
     *
     * @param sessionId The session record Id
     * @param stepNumber Which step to execute (0-8)
     * @return StepResult with display data
     */
    @AuraEnabled
    public static StepResult executeStep(Id sessionId, Integer stepNumber) {
        StepResult result = new StepResult();

        switch on stepNumber {
            when 0 {
                result.label = 'Dealer Lookup';
                result.actionType = 'Query';
                result.icon = 'standard:search';
                result.iconName = 'search';
                result.description = 'Agent queries CRM for dealer profile';
                result.inputJson = '{"system":"CRM","query":"dealer_profile","dealerId":"DEALER-100"}';
                result.outputJson = '{"name":"Midwest Heavy Equipment","tier":"Platinum","region":"Midwest","creditLimit":500000}';
                result.reasoning = 'Retrieved dealer profile. Midwest Heavy Equipment is a Platinum tier dealer in the Midwest region with a $500,000 credit limit.';
            }
            when 1 {
                result.label = 'Credit Validation';
                result.actionType = 'Validation';
                result.icon = 'standard:approval';
                result.iconName = 'approval';
                result.description = 'Agent validates dealer credit status';
                result.inputJson = '{"creditStatus":"approved","creditLimit":500000,"outstandingBalance":42000}';
                result.outputJson = '{"decision":"proceed","availableCredit":458000,"riskLevel":"low"}';
                result.reasoning = 'Credit status: approved. Outstanding balance $42,000 against $500,000 limit. Available credit: $458,000. Risk level: low. Proceeding with quote generation.';
            }
            when 2 {
                result.label = 'Product Catalog Query';
                result.actionType = 'Query';
                result.icon = 'standard:product';
                result.iconName = 'product';
                result.description = 'Agent retrieves product information from CPQ catalog';
                result.inputJson = '{"system":"CPQ","catalog":"dealer-2026","skus":["HYD-100","HYD-200","HYD-300","HYD-400","HYD-500"]}';
                result.outputJson = '{"found":5,"available":[{"sku":"HYD-100","name":"Hydraulic Cylinder 100mm","price":5200},{"sku":"HYD-200","name":"Hydraulic Pump Assembly","price":8400},{"sku":"HYD-300","name":"Hydraulic Control Valve","price":3100},{"sku":"HYD-400","name":"Hydraulic Hose Kit","price":890}],"unavailable":["HYD-500"]}';
                result.reasoning = 'Queried CPQ catalog for 5 SKUs. 4 products available. HYD-500 (Hydraulic Filter Set) is currently out of stock.';
            }
            when 3 {
                result.label = 'Handle Unavailable Product';
                result.actionType = 'Decision';
                result.icon = 'standard:decision';
                result.iconName = 'decision';
                result.description = 'Agent decides how to handle out-of-stock item';
                result.inputJson = '{"unavailableSku":"HYD-500","dealerPreference":"notify_and_exclude","substituteAvailable":true}';
                result.outputJson = '{"action":"excluded","substituteOffered":"HYD-550","notificationQueued":true}';
                result.reasoning = 'HYD-500 is out of stock. Excluding from quote per standard policy. Substitute HYD-550 offered. Dealer notification queued with restock estimate of 2 weeks.';
            }
            when 4 {
                result.label = 'Retrieve Pricing Rules';
                result.actionType = 'Query';
                result.icon = 'standard:pricebook';
                result.iconName = 'pricebook';
                result.description = 'Agent retrieves tier-specific discount rules from CPQ';
                result.inputJson = '{"system":"CPQ","query":"pricing_rules","tier":"Platinum","region":"Midwest"}';
                result.outputJson = '{"tierDiscount":0.20,"volumeThreshold":50000,"volumeDiscount":0.05,"maxDiscount":0.30,"regionalAdjustment":0}';
                result.reasoning = 'Platinum tier pricing rules: 20% base discount, additional 5% volume discount on orders exceeding $50,000, maximum discount cap of 30%. No regional adjustment for Midwest.';
            }
            when 5 {
                result.label = 'Calculate Pricing';
                result.actionType = 'Calculation';
                result.icon = 'standard:formula';
                result.iconName = 'formula';
                result.description = 'Agent computes pricing with all applicable discounts';
                result.inputJson = '{"lineItems":[{"sku":"HYD-100","qty":10,"basePrice":5200},{"sku":"HYD-200","qty":5,"basePrice":8400},{"sku":"HYD-300","qty":20,"basePrice":3100},{"sku":"HYD-400","qty":50,"basePrice":890}],"rules":{"tierDiscount":0.20,"volumeDiscount":0.05}}';
                result.outputJson = '{"subtotal":200500,"tierDiscount":40100,"volumeQualified":true,"volumeDiscount":10025,"effectiveRate":"25%","finalTotal":150375}';
                result.reasoning = 'Subtotal: $200,500. Applied Platinum tier discount of 20% ($40,100). Order exceeds $50,000 volume threshold, applied additional 5% volume discount ($10,025). Effective discount rate: 25%. Final total: $150,375.';
            }
            when 6 {
                result.label = 'Floor Price Validation';
                result.actionType = 'Validation';
                result.icon = 'standard:calibration';
                result.iconName = 'calibration';
                result.description = 'Agent validates all prices meet minimum margin thresholds';
                result.inputJson = '{"items":[{"sku":"HYD-100","unitPrice":3900,"floorPrice":3120},{"sku":"HYD-200","unitPrice":6300,"floorPrice":5040},{"sku":"HYD-300","unitPrice":2325,"floorPrice":1860},{"sku":"HYD-400","unitPrice":667.50,"floorPrice":534}]}';
                result.outputJson = '{"allPassed":true,"violations":0,"lowestMargin":{"sku":"HYD-400","margin":"25%"}}';
                result.reasoning = 'All 4 line items pass floor price validation. No items priced below the 60% minimum margin threshold. Lowest margin is HYD-400 at 25% above floor.';
            }
            when 7 {
                result.label = 'Credit Limit Check';
                result.actionType = 'Validation';
                result.icon = 'standard:currency';
                result.iconName = 'currency';
                result.description = 'Agent verifies order total is within dealer credit limit';
                result.inputJson = '{"orderTotal":150375,"availableCredit":458000}';
                result.outputJson = '{"withinLimit":true,"headroom":307625,"approvalRequired":false}';
                result.reasoning = 'Order total $150,375 is within available credit of $458,000. Headroom: $307,625. No additional approval required.';
            }
            when 8 {
                result.label = 'Generate Quote';
                result.actionType = 'Create';
                result.icon = 'standard:quote';
                result.iconName = 'quote';
                result.description = 'Agent creates the final dealer quote in CPQ';
                result.inputJson = '{"dealerId":"DEALER-100","dealerName":"Midwest Heavy Equipment","lineItems":4,"total":150375}';
                result.outputJson = '{"quoteId":"Q-2026-4817","status":"pending_review","expiresAt":"2026-05-13","pdfGenerated":true}';
                result.reasoning = 'Generated quote Q-2026-4817 for Midwest Heavy Equipment. 4 line items totaling $150,375. Quote valid for 30 days (expires 2026-05-13). Status: pending_review. PDF generated and attached.';
            }
        }

        // Record the action in AgentLedger
        Agent_Audit_Record__c record = AgentAuditRecorder.recordAction(
            sessionId,
            'cpq-pricing-agent',
            result.actionType,
            result.inputJson,
            result.outputJson,
            result.reasoning
        );

        result.recordId = record.Id;
        result.recordHash = record.Record_Hash__c;
        result.previousHash = record.Previous_Hash__c;
        result.sequenceNumber = Integer.valueOf(record.Sequence_Number__c);
        result.timestamp = record.Action_Timestamp__c;
        result.chainValid = (stepNumber == 0)
            ? record.Previous_Hash__c == null
            : true;

        return result;
    }

    /**
     * Seal the demo session.
     * @param sessionId The session to seal
     * @return SealResult with merkle root and session details
     */
    @AuraEnabled
    public static SealResult sealDemoSession(Id sessionId) {
        String merkleRoot = AgentAuditRecorder.sealSession(sessionId);

        Agent_Audit_Session__c session = [
            SELECT Name, Record_Count__c, Start_Time__c, End_Time__c
            FROM Agent_Audit_Session__c
            WHERE Id = :sessionId
        ];

        SealResult result = new SealResult();
        result.merkleRoot = merkleRoot;
        result.recordCount = Integer.valueOf(session.Record_Count__c);
        result.sessionName = session.Name;
        result.startTime = session.Start_Time__c;
        result.endTime = session.End_Time__c;
        return result;
    }

    /**
     * Verify a sealed session.
     * @param sessionId The session to verify
     * @return AgentAuditRecorder.VerifySessionResult
     */
    @AuraEnabled
    public static AgentAuditRecorder.VerifySessionResult verifyDemoSession(Id sessionId) {
        return AgentAuditRecorder.verifySession(sessionId);
    }

    /**
     * Generate a Merkle proof for a specific record.
     * @param sessionId The sealed session
     * @param recordIndex The record index to prove
     * @return ProofResult with proof details
     */
    @AuraEnabled
    public static ProofResult generateRecordProof(Id sessionId, Integer recordIndex) {
        MerkleTreeService.MerkleProof proof = AgentAuditRecorder.generateProof(sessionId, recordIndex);

        ProofResult result = new ProofResult();
        result.recordIndex = proof.recordIndex;
        result.recordHash = proof.recordHash;
        result.root = proof.root;
        result.siblingCount = proof.siblings.size();
        result.isValid = MerkleTreeService.verifyProof(proof);
        return result;
    }

    /**
     * Get all records for a session (for the audit trail viewer).
     */
    @AuraEnabled
    public static List<Agent_Audit_Record__c> getRecords(Id sessionId) {
        return AgentAuditRecorder.getSessionRecords(sessionId);
    }

    // ── Result Classes ──

    public class StepResult {
        @AuraEnabled public String label;
        @AuraEnabled public String actionType;
        @AuraEnabled public String icon;
        @AuraEnabled public String iconName;
        @AuraEnabled public String description;
        @AuraEnabled public String inputJson;
        @AuraEnabled public String outputJson;
        @AuraEnabled public String reasoning;
        @AuraEnabled public Id recordId;
        @AuraEnabled public String recordHash;
        @AuraEnabled public String previousHash;
        @AuraEnabled public Integer sequenceNumber;
        @AuraEnabled public DateTime timestamp;
        @AuraEnabled public Boolean chainValid;
    }

    public class SealResult {
        @AuraEnabled public String merkleRoot;
        @AuraEnabled public Integer recordCount;
        @AuraEnabled public String sessionName;
        @AuraEnabled public DateTime startTime;
        @AuraEnabled public DateTime endTime;
    }

    public class ProofResult {
        @AuraEnabled public Integer recordIndex;
        @AuraEnabled public String recordHash;
        @AuraEnabled public String root;
        @AuraEnabled public Integer siblingCount;
        @AuraEnabled public Boolean isValid;
    }
}
