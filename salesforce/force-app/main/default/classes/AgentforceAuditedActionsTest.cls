@isTest
private class AgentforceAuditedActionsTest {

    @TestSetup
    static void setup() {
        Account acct = new Account(
            Name = 'Test Manufacturing Inc',
            Industry = 'Manufacturing',
            AnnualRevenue = 75000000,
            NumberOfEmployees = 800,
            BillingCity = 'Milwaukee',
            BillingStateCode = 'WI',
            BillingCountryCode = 'US'
        );
        insert acct;

        Opportunity opp = new Opportunity(
            Name = 'Test Opp - Equipment Upgrade',
            AccountId = acct.Id,
            Amount = 325000,
            StageName = 'Prospecting',
            CloseDate = Date.today().addDays(60),
            LeadSource = 'Partner Referral',
            Type = 'Existing Business',
            Description = 'Test opportunity for AgentLedger demo'
        );
        insert opp;
    }

    @isTest
    static void testFullAgentWorkflow() {
        Opportunity opp = [SELECT Id, AccountId FROM Opportunity LIMIT 1];

        // Step 1: Start session
        AuditedStartSession.Input startInput = new AuditedStartSession.Input();
        startInput.agentName = 'test-agent';
        startInput.initiator = 'unit-test';
        startInput.relatedRecordId = String.valueOf(opp.Id);

        List<AuditedStartSession.Output> startOutputs =
            AuditedStartSession.execute(new List<AuditedStartSession.Input>{ startInput });

        System.assertEquals(1, startOutputs.size());
        Id sessionId = startOutputs[0].sessionId;
        System.assertNotEquals(null, sessionId);

        // Step 2: Lookup opportunity
        AuditedLookupOpportunity.Input lookupInput = new AuditedLookupOpportunity.Input();
        lookupInput.sessionId = sessionId;
        lookupInput.opportunityId = opp.Id;

        List<AuditedLookupOpportunity.Output> lookupOutputs =
            AuditedLookupOpportunity.execute(new List<AuditedLookupOpportunity.Input>{ lookupInput });

        System.assertEquals(1, lookupOutputs.size());
        System.assertEquals('Test Opp - Equipment Upgrade', lookupOutputs[0].opportunityName);
        System.assertEquals(325000, lookupOutputs[0].amount);

        // Step 3: Assess deal
        AuditedAssessDeal.Input assessInput = new AuditedAssessDeal.Input();
        assessInput.sessionId = sessionId;
        assessInput.amount = 325000;
        assessInput.oppType = 'Existing Business';
        assessInput.leadSource = 'Partner Referral';
        assessInput.accountRevenue = 75000000;
        assessInput.daysUntilClose = 60;
        assessInput.description = 'Test opportunity';

        List<AuditedAssessDeal.Output> assessOutputs =
            AuditedAssessDeal.execute(new List<AuditedAssessDeal.Input>{ assessInput });

        System.assertEquals(1, assessOutputs.size());
        System.assertEquals('Enterprise', assessOutputs[0].dealClassification);
        System.assert(assessOutputs[0].winProbability > 50, 'Win probability should be > 50 for this profile');
        System.assert(assessOutputs[0].existingCustomerBonus, 'Should have existing customer bonus');

        // Step 4: Update opportunity
        AuditedUpdateOpportunity.Input updateInput = new AuditedUpdateOpportunity.Input();
        updateInput.sessionId = sessionId;
        updateInput.opportunityId = opp.Id;
        updateInput.newStage = 'Qualification';
        updateInput.newProbability = assessOutputs[0].winProbability;
        updateInput.nextStep = 'Discovery call to confirm budget';
        updateInput.addToDescription = 'AI Agent assessed at ' + assessOutputs[0].winProbability + '% win probability. Classification: ' + assessOutputs[0].dealClassification;

        List<AuditedUpdateOpportunity.Output> updateOutputs =
            AuditedUpdateOpportunity.execute(new List<AuditedUpdateOpportunity.Input>{ updateInput });

        System.assertEquals(1, updateOutputs.size());
        System.assert(updateOutputs[0].success);
        System.assertEquals('Prospecting', updateOutputs[0].previousStage);
        System.assertEquals('Qualification', updateOutputs[0].newStage);

        // Verify the actual opportunity was updated
        Opportunity updatedOpp = [SELECT StageName, Probability FROM Opportunity WHERE Id = :opp.Id];
        System.assertEquals('Qualification', updatedOpp.StageName);

        // Step 5: Create task
        AuditedCreateTask.Input taskInput = new AuditedCreateTask.Input();
        taskInput.sessionId = sessionId;
        taskInput.subject = 'Discovery Call - Confirm Budget';
        taskInput.relatedToId = opp.Id;
        taskInput.dueDate = Date.today().addDays(3);
        taskInput.priority = 'High';
        taskInput.taskDescription = 'Confirm budget allocation and decision timeline.';

        List<AuditedCreateTask.Output> taskOutputs =
            AuditedCreateTask.execute(new List<AuditedCreateTask.Input>{ taskInput });

        System.assertEquals(1, taskOutputs.size());
        System.assertNotEquals(null, taskOutputs[0].taskId);

        // Step 6: Seal session
        AuditedSealSession.Input sealInput = new AuditedSealSession.Input();
        sealInput.sessionId = sessionId;

        List<AuditedSealSession.Output> sealOutputs =
            AuditedSealSession.execute(new List<AuditedSealSession.Input>{ sealInput });

        System.assertEquals(1, sealOutputs.size());
        System.assertNotEquals(null, sealOutputs[0].merkleRoot);
        System.assertEquals(64, sealOutputs[0].merkleRoot.length());
        System.assertEquals(4, sealOutputs[0].recordCount); // lookup + assess + update + task
        System.assert(sealOutputs[0].verified, 'Session should verify after sealing');

        // Verify audit trail
        List<Agent_Audit_Record__c> records = [
            SELECT Action_Type__c, Reasoning__c, Record_Hash__c
            FROM Agent_Audit_Record__c
            WHERE Audit_Session__c = :sessionId
            ORDER BY Sequence_Number__c ASC
        ];

        System.assertEquals(4, records.size());
        System.assertEquals('Query', records[0].Action_Type__c); // lookup
        System.assertEquals('Calculation', records[1].Action_Type__c); // assess
        System.assertEquals('Create', records[2].Action_Type__c); // update
        System.assertEquals('Create', records[3].Action_Type__c); // task
    }

    @isTest
    static void testDealAssessmentVariations() {
        // Test small deal
        AuditedAssessDeal.Input smallDeal = new AuditedAssessDeal.Input();
        smallDeal.sessionId = AgentAuditRecorder.startSession('test', 'test', 'test');
        smallDeal.amount = 25000;
        smallDeal.oppType = 'New Business';
        smallDeal.leadSource = 'Web';
        smallDeal.daysUntilClose = 30;

        List<AuditedAssessDeal.Output> smallOutputs =
            AuditedAssessDeal.execute(new List<AuditedAssessDeal.Input>{ smallDeal });

        System.assertEquals('Standard', smallOutputs[0].dealClassification);
        System.assertEquals('Sales Rep', smallOutputs[0].approvalLevel);
        System.assert(!smallOutputs[0].existingCustomerBonus);

        // Test strategic deal
        AuditedAssessDeal.Input bigDeal = new AuditedAssessDeal.Input();
        bigDeal.sessionId = AgentAuditRecorder.startSession('test', 'test', 'test');
        bigDeal.amount = 750000;
        bigDeal.oppType = 'Existing Business';
        bigDeal.leadSource = 'Partner Referral';
        bigDeal.accountRevenue = 100000000;
        bigDeal.daysUntilClose = 60;
        bigDeal.description = 'Major upgrade project';

        List<AuditedAssessDeal.Output> bigOutputs =
            AuditedAssessDeal.execute(new List<AuditedAssessDeal.Input>{ bigDeal });

        System.assertEquals('Strategic', bigOutputs[0].dealClassification);
        System.assertEquals('C-Suite', bigOutputs[0].approvalLevel);
        System.assert(bigOutputs[0].winProbability > 70, 'Strategic existing customer with referral should have high probability');
    }
}
