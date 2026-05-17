/**
 * OpportunityAgentDemoController
 *
 * Presentation-ready demo: an AI agent evaluates and qualifies a
 * real Salesforce Opportunity, with every decision recorded in
 * AgentLedger's cryptographic audit trail.
 *
 * Creates sample Account + Opportunity data, then walks through
 * a realistic 7-step qualification workflow.
 */
public with sharing class OpportunityAgentDemoController {

    /**
     * Set up demo data: creates an Account and Opportunity.
     * @return SetupResult with the created record Ids
     */
    @AuraEnabled
    public static SetupResult setupDemoData() {
        // Create Account
        Account acct = new Account(
    Name = 'Pinnacle Manufacturing Group',
    Industry = 'Manufacturing',
    AnnualRevenue = 85000000,
    NumberOfEmployees = 1200,
    BillingCity = 'Chicago',
    BillingCountryCode = 'US',
    BillingStateCode = 'IL',
    Description = 'Mid-market manufacturer of industrial automation components. Existing customer since 2023. Two previous purchases totaling $340,000.'
);
        //insert acct;
        Database.DMLOptions dml = new Database.DMLOptions();
        dml.DuplicateRuleHeader.allowSave = true;
        Database.SaveResult sr = Database.insert(acct, dml);

        // Create Opportunity
        Opportunity opp = new Opportunity(
            Name = 'Pinnacle Mfg - Hydraulic System Upgrade',
            AccountId = acct.Id,
            Amount = 275000,
            StageName = 'Prospecting',
            CloseDate = Date.today().addDays(45),
            Description = 'Pinnacle is evaluating a full hydraulic system upgrade for their Chicago plant. They currently run a mix of legacy and modern equipment. Initial conversations indicate strong interest but no formal RFP yet.',
            LeadSource = 'Partner Referral',
            Type = 'Existing Business'
        );
        insert opp;

        SetupResult result = new SetupResult();
        result.accountId = acct.Id;
        result.accountName = acct.Name;
        result.opportunityId = opp.Id;
        result.opportunityName = opp.Name;
        result.amount = opp.Amount;
        result.stage = opp.StageName;
        result.closeDate = opp.CloseDate;
        result.industry = acct.Industry;
        result.annualRevenue = acct.AnnualRevenue;
        return result;
    }

    /**
     * Execute a single step of the opportunity qualification agent.
     * @param sessionId AgentLedger session Id
     * @param stepNumber Step to execute (0-6)
     * @param opportunityId The opportunity being evaluated
     * @param accountId The parent account
     * @return StepResult with display data
     */
    @AuraEnabled
    public static StepResult executeStep(Id sessionId, Integer stepNumber, Id opportunityId, Id accountId) {
        StepResult result = new StepResult();

        switch on stepNumber {
            when 0 {
                // Look up the Opportunity
                Opportunity opp = [
                    SELECT Name, Amount, StageName, CloseDate, Description, LeadSource, Type
                    FROM Opportunity WHERE Id = :opportunityId
                ];

                result.label = 'Opportunity Lookup';
                result.actionType = 'Query';
                result.icon = 'standard:opportunity';
                result.description = 'Agent retrieves the opportunity record from Salesforce';
                result.inputJson = JSON.serialize(new Map<String, Object>{
                    'system' => 'Salesforce CRM',
                    'object' => 'Opportunity',
                    'recordId' => opportunityId,
                    'fields' => new List<String>{'Name', 'Amount', 'StageName', 'CloseDate', 'Description', 'LeadSource'}
                });
                result.outputJson = JSON.serialize(new Map<String, Object>{
                    'name' => opp.Name,
                    'amount' => opp.Amount,
                    'stage' => opp.StageName,
                    'closeDate' => String.valueOf(opp.CloseDate),
                    'leadSource' => opp.LeadSource,
                    'type' => opp.Type
                });
                result.reasoning = 'Retrieved opportunity "' + opp.Name + '". Current stage: ' + opp.StageName + '. Deal value: $' + String.valueOf(opp.Amount.intValue()) + '. Close date: ' + opp.CloseDate.format() + '. Lead source: ' + opp.LeadSource + '. This is ' + opp.Type + ', indicating a repeat customer.';
                result.displaySummary = '$' + String.valueOf(opp.Amount.intValue()) + ' | ' + opp.StageName + ' | Closes ' + opp.CloseDate.format();
            }
            when 1 {
                // Check Account Health
                Account acct = [
                    SELECT Name, Industry, AnnualRevenue, NumberOfEmployees, Description, BillingCity, BillingState
                    FROM Account WHERE Id = :accountId
                ];

                result.label = 'Account Health Check';
                result.actionType = 'Query';
                result.icon = 'standard:account';
                result.description = 'Agent evaluates the parent account profile and history';
                result.inputJson = JSON.serialize(new Map<String, Object>{
                    'system' => 'Salesforce CRM',
                    'object' => 'Account',
                    'recordId' => accountId,
                    'fields' => new List<String>{'Name', 'Industry', 'AnnualRevenue', 'NumberOfEmployees', 'Description'}
                });
                result.outputJson = JSON.serialize(new Map<String, Object>{
                    'name' => acct.Name,
                    'industry' => acct.Industry,
                    'annualRevenue' => acct.AnnualRevenue,
                    'employees' => acct.NumberOfEmployees,
                    'location' => acct.BillingCity + ', ' + acct.BillingState,
                    'customerSince' => '2023',
                    'previousPurchases' => 340000,
                    'purchaseCount' => 2
                });
                result.reasoning = acct.Name + ' is a ' + acct.Industry + ' company with $' + String.valueOf((acct.AnnualRevenue / 1000000).intValue()) + 'M annual revenue and ' + acct.NumberOfEmployees + ' employees in ' + acct.BillingCity + ', ' + acct.BillingState + '. They are an existing customer since 2023 with 2 previous purchases totaling $340,000. Account health: strong. No outstanding payment issues detected.';
                result.displaySummary = acct.Industry + ' | $' + String.valueOf((acct.AnnualRevenue / 1000000).intValue()) + 'M revenue | ' + acct.NumberOfEmployees + ' employees';
            }
            when 2 {
                // Evaluate Deal Size
                Opportunity opp = [SELECT Amount FROM Opportunity WHERE Id = :opportunityId];
                Boolean isEnterprise = opp.Amount >= 200000;

                result.label = 'Deal Size Classification';
                result.actionType = 'Decision';
                result.icon = 'standard:decision';
                result.description = 'Agent classifies the deal based on amount thresholds';
                result.inputJson = JSON.serialize(new Map<String, Object>{
                    'dealAmount' => opp.Amount,
                    'thresholds' => new Map<String, Object>{
                        'standard' => 'under $100,000',
                        'midMarket' => '$100,000 - $199,999',
                        'enterprise' => '$200,000 and above'
                    }
                });
                result.outputJson = JSON.serialize(new Map<String, Object>{
                    'classification' => isEnterprise ? 'Enterprise' : 'Mid-Market',
                    'requiresVPApproval' => isEnterprise,
                    'discountAuthority' => isEnterprise ? 'VP Sales only' : 'Regional Manager',
                    'reviewCadence' => isEnterprise ? 'Weekly pipeline review' : 'Bi-weekly review'
                });
                result.reasoning = 'Deal value of $' + String.valueOf(opp.Amount.intValue()) + ' classifies this as an Enterprise deal (threshold: $200,000). Enterprise classification triggers: VP approval required for discounts above 15%, weekly pipeline review cadence, and dedicated solution architect assignment. This ensures appropriate oversight for high-value opportunities.';
                result.displaySummary = 'Enterprise Deal | VP Approval Required | Weekly Review';
            }
            when 3 {
                // Assess Win Probability
                result.label = 'Win Probability Assessment';
                result.actionType = 'Calculation';
                result.icon = 'standard:formula';
                result.description = 'Agent calculates win probability based on multiple factors';
                result.inputJson = JSON.serialize(new Map<String, Object>{
                    'factors' => new Map<String, Object>{
                        'existingCustomer' => true,
                        'previousPurchaseValue' => 340000,
                        'industryWinRate' => '62%',
                        'dealSize' => 'Enterprise',
                        'leadSource' => 'Partner Referral',
                        'competitorPresence' => 'Unknown',
                        'daysToClose' => 45
                    }
                });
                result.outputJson = JSON.serialize(new Map<String, Object>{
                    'winProbability' => '72%',
                    'confidenceLevel' => 'Medium-High',
                    'positiveFactors' => new List<String>{'Existing customer', 'Partner referral', 'Previous purchase history'},
                    'riskFactors' => new List<String>{'No formal RFP yet', 'Competitor presence unknown', 'Enterprise deal complexity'},
                    'recommendation' => 'Proceed with qualification'
                });
                result.reasoning = 'Win probability calculated at 72% (confidence: medium-high). Positive factors: existing customer relationship (2 prior purchases), partner referral source (historically 1.4x higher close rate), and strong account health. Risk factors: no formal RFP issued yet, competitor landscape unknown, and enterprise deal complexity may extend the sales cycle. Recommendation: proceed with active qualification and schedule a discovery meeting.';
                result.displaySummary = '72% Win Probability | Medium-High Confidence';
            }
            when 4 {
                // Recommend Stage Advancement
                result.label = 'Stage Advancement Decision';
                result.actionType = 'Decision';
                result.icon = 'standard:flow';
                result.description = 'Agent decides whether to advance the opportunity stage';
                result.inputJson = JSON.serialize(new Map<String, Object>{
                    'currentStage' => 'Prospecting',
                    'winProbability' => '72%',
                    'accountHealth' => 'Strong',
                    'dealClassification' => 'Enterprise',
                    'qualificationCriteria' => new Map<String, Object>{
                        'budgetConfirmed' => false,
                        'authorityIdentified' => true,
                        'needEstablished' => true,
                        'timelineEstablished' => true
                    }
                });
                result.outputJson = JSON.serialize(new Map<String, Object>{
                    'decision' => 'Advance to Qualification',
                    'newStage' => 'Qualification',
                    'reason' => '3 of 4 BANT criteria met',
                    'nextStep' => 'Schedule discovery call to confirm budget'
                });
                result.reasoning = 'Evaluating BANT criteria: Budget is not yet confirmed (pending discovery call). Authority has been identified through the partner referral. Need is established per the account description (legacy equipment upgrade). Timeline is set with a 45-day close target. With 3 of 4 criteria met and a 72% win probability, advancing from Prospecting to Qualification is appropriate. Budget confirmation should be the priority in the next customer interaction.';
                result.displaySummary = 'Advance: Prospecting -> Qualification | 3/4 BANT criteria met';
            }
            when 5 {
                // Update the Opportunity
                Opportunity opp = [SELECT StageName FROM Opportunity WHERE Id = :opportunityId];
                opp.StageName = 'Qualification';
                opp.Description = opp.Id != null ? 'AI Agent qualified this opportunity on ' + Date.today().format() + '. Win probability: 72%. Reason: 3/4 BANT criteria met. Next step: Discovery call to confirm budget.' : '';
                update opp;

                result.label = 'Update Opportunity Record';
                result.actionType = 'Update';
                result.icon = 'standard:record_update';
                result.description = 'Agent updates the opportunity stage and adds qualification notes';
                result.inputJson = JSON.serialize(new Map<String, Object>{
                    'object' => 'Opportunity',
                    'recordId' => opportunityId,
                    'fieldsToUpdate' => new Map<String, Object>{
                        'StageName' => 'Qualification',
                        'Description' => 'AI qualification notes added'
                    }
                });
                result.outputJson = JSON.serialize(new Map<String, Object>{
                    'success' => true,
                    'previousStage' => 'Prospecting',
                    'newStage' => 'Qualification',
                    'fieldsModified' => 2
                });
                result.reasoning = 'Updated opportunity stage from Prospecting to Qualification. Added AI qualification notes to the Description field documenting the assessment date, win probability, BANT criteria status, and recommended next step. These notes provide transparency to the sales team about why the stage was changed.';
                result.displaySummary = 'Stage updated: Prospecting -> Qualification | 2 fields modified';
            }
            when 6 {
                // Create Follow-up Task
                Task t = new Task(
                    Subject = 'Discovery Call - Confirm Budget for Hydraulic System Upgrade',
                    WhatId = opportunityId,
                    ActivityDate = Date.today().addDays(3),
                    Priority = 'High',
                    Status = 'Not Started',
                    Description = 'AI Agent recommendation: Schedule a discovery call with Pinnacle Manufacturing to confirm budget allocation for the hydraulic system upgrade. Key discussion points: 1) Confirm allocated budget range, 2) Identify decision-making timeline, 3) Discuss technical requirements for legacy equipment replacement.'
                );
                insert t;

                result.label = 'Create Follow-up Task';
                result.actionType = 'Create';
                result.icon = 'standard:task';
                result.description = 'Agent schedules a follow-up task for the opportunity owner';
                result.inputJson = JSON.serialize(new Map<String, Object>{
                    'object' => 'Task',
                    'relatedTo' => opportunityId,
                    'subject' => t.Subject,
                    'dueDate' => String.valueOf(t.ActivityDate),
                    'priority' => 'High'
                });
                result.outputJson = JSON.serialize(new Map<String, Object>{
                    'taskId' => t.Id,
                    'subject' => t.Subject,
                    'dueDate' => String.valueOf(t.ActivityDate),
                    'priority' => t.Priority,
                    'status' => t.Status
                });
                result.reasoning = 'Created high-priority follow-up task: "Discovery Call - Confirm Budget for Hydraulic System Upgrade" due ' + t.ActivityDate.format() + '. This addresses the one unmet BANT criterion (Budget). The task includes recommended discussion points: budget allocation confirmation, decision timeline, and technical requirements for legacy equipment replacement. Assigned to the opportunity owner for immediate action.';
                result.displaySummary = 'Task created: Discovery Call | Due ' + t.ActivityDate.format() + ' | High Priority';
            }
        }
        // Link session to opportunity on first step
        if (stepNumber == 0) {
            Agent_Audit_Session__c sess = [SELECT Id FROM Agent_Audit_Session__c WHERE Id = :sessionId];
            sess.Related_Record_Id__c = String.valueOf(opportunityId);
            update sess;
        }

        // Record in AgentLedger
        Agent_Audit_Record__c record = AgentAuditRecorder.recordAction(
            sessionId,
            'opportunity-qualification-agent',
            result.actionType == 'Update' ? 'Create' : result.actionType,
            result.inputJson,
            result.outputJson,
            result.reasoning
        );

        result.recordId = record.Id;
        result.recordHash = record.Record_Hash__c;
        result.previousHash = record.Previous_Hash__c;
        result.sequenceNumber = Integer.valueOf(record.Sequence_Number__c);
        result.timestamp = record.Action_Timestamp__c;

        return result;
    }

    /**
     * Seal the session.
     */
    @AuraEnabled
    public static SealResult sealSession(Id sessionId) {
        String merkleRoot = AgentAuditRecorder.sealSession(sessionId);

        Agent_Audit_Session__c session = [
            SELECT Name, Record_Count__c, Start_Time__c, End_Time__c
            FROM Agent_Audit_Session__c WHERE Id = :sessionId
        ];

        SealResult result = new SealResult();
        result.merkleRoot = merkleRoot;
        result.recordCount = Integer.valueOf(session.Record_Count__c);
        result.sessionName = session.Name;
        return result;
    }

    /**
     * Verify a sealed session.
     */
    @AuraEnabled
    public static AgentAuditRecorder.VerifySessionResult verifySession(Id sessionId) {
        return AgentAuditRecorder.verifySession(sessionId);
    }

    /**
     * Generate a Merkle proof for a specific record.
     */
    @AuraEnabled
    public static ProofResult generateProof(Id sessionId, Integer recordIndex) {
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
     * Clean up demo data.
     */
    @AuraEnabled
    public static void cleanupDemoData(Id accountId) {
        if (accountId != null) {
            // Deleting account cascades to opportunities and tasks
            delete [SELECT Id FROM Account WHERE Id = :accountId];
        }
    }

    // ── Result Classes ──

    public class SetupResult {
        @AuraEnabled public Id accountId;
        @AuraEnabled public String accountName;
        @AuraEnabled public Id opportunityId;
        @AuraEnabled public String opportunityName;
        @AuraEnabled public Decimal amount;
        @AuraEnabled public String stage;
        @AuraEnabled public Date closeDate;
        @AuraEnabled public String industry;
        @AuraEnabled public Decimal annualRevenue;
    }

    public class StepResult {
        @AuraEnabled public String label;
        @AuraEnabled public String actionType;
        @AuraEnabled public String icon;
        @AuraEnabled public String description;
        @AuraEnabled public String inputJson;
        @AuraEnabled public String outputJson;
        @AuraEnabled public String reasoning;
        @AuraEnabled public String displaySummary;
        @AuraEnabled public Id recordId;
        @AuraEnabled public String recordHash;
        @AuraEnabled public String previousHash;
        @AuraEnabled public Integer sequenceNumber;
        @AuraEnabled public DateTime timestamp;
    }

    public class SealResult {
        @AuraEnabled public String merkleRoot;
        @AuraEnabled public Integer recordCount;
        @AuraEnabled public String sessionName;
    }

    public class ProofResult {
        @AuraEnabled public Integer recordIndex;
        @AuraEnabled public String recordHash;
        @AuraEnabled public String root;
        @AuraEnabled public Integer siblingCount;
        @AuraEnabled public Boolean isValid;
    }
    /**
     * Simulate tampering by modifying a record's reasoning after sealing.
     * This demonstrates that AgentLedger detects any post-seal modification.
     * @param sessionId The sealed session
     * @return TamperResult with before/after details
     */
    @AuraEnabled
    public static TamperResult simulateTampering(Id sessionId) {
        // Get the calculation record (step 3 - Win Probability)
        List<Agent_Audit_Record__c> records = [
            SELECT Id, Sequence_Number__c, Reasoning__c, Record_Hash__c, Action_Type__c
            FROM Agent_Audit_Record__c
            WHERE Audit_Session__c = :sessionId
            ORDER BY Sequence_Number__c ASC
        ];

        // Find the calculation record
        Agent_Audit_Record__c target = null;
        for (Agent_Audit_Record__c rec : records) {
            if (rec.Action_Type__c == 'Calculation') {
                target = rec;
                break;
            }
        }

        if (target == null && !records.isEmpty()) {
            target = records[3]; // fallback to record #3
        }

        TamperResult result = new TamperResult();
        result.tamperedRecordIndex = Integer.valueOf(target.Sequence_Number__c);
        result.originalReasoning = target.Reasoning__c;
        result.originalHash = target.Record_Hash__c;

        // TAMPER: change the reasoning to show a different win probability
        target.Reasoning__c = 'Win probability calculated at 95% (confidence: high). All factors strongly favorable. Recommend immediate close at maximum discount of 40%.';
        update target;

        result.tamperedReasoning = target.Reasoning__c;

        // Now verify - this should FAIL
        AgentAuditRecorder.VerifySessionResult verifyResult = AgentAuditRecorder.verifySession(sessionId);
        result.verificationPassed = verifyResult.valid;
        result.verificationMessage = verifyResult.message;
        result.errors = new List<String>();
        for (AgentAuditRecorder.VerificationCheck check : verifyResult.checks) {
            if (!check.passed) {
                result.errors.add(check.name + ': ' + check.detail);
            }
        }

        return result;
    }

    /**
     * Restore a tampered record back to valid state.
     * Recomputes the hash from the original content.
     * @param sessionId The session to restore
     * @param originalReasoning The original reasoning text to restore
     */
    @AuraEnabled
    public static AgentAuditRecorder.VerifySessionResult restoreTamperedRecord(Id sessionId, String originalReasoning) {
        // Find the calculation record
        List<Agent_Audit_Record__c> records = [
            SELECT Id, Action_Type__c, Reasoning__c
            FROM Agent_Audit_Record__c
            WHERE Audit_Session__c = :sessionId
            ORDER BY Sequence_Number__c ASC
        ];

        for (Agent_Audit_Record__c rec : records) {
            if (rec.Action_Type__c == 'Calculation') {
                rec.Reasoning__c = originalReasoning;
                update rec;
                break;
            }
        }

        // Re-verify
        return AgentAuditRecorder.verifySession(sessionId);
    }

    public class TamperResult {
        @AuraEnabled public Integer tamperedRecordIndex;
        @AuraEnabled public String originalReasoning;
        @AuraEnabled public String tamperedReasoning;
        @AuraEnabled public String originalHash;
        @AuraEnabled public Boolean verificationPassed;
        @AuraEnabled public String verificationMessage;
        @AuraEnabled public List<String> errors;
    }
}
