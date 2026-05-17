@isTest
private class OpportunityAgentDemoControllerTest {

    @isTest
    static void testFullDemoWorkflow() {
        // Setup demo data
        OpportunityAgentDemoController.SetupResult setup =
            OpportunityAgentDemoController.setupDemoData();

        System.assertNotEquals(null, setup.accountId);
        System.assertNotEquals(null, setup.opportunityId);
        System.assertEquals('Pinnacle Manufacturing Group', setup.accountName);
        System.assertEquals(275000, setup.amount);

        // Start AgentLedger session
        Id sessionId = AgentAuditRecorder.startSession(
            'opportunity-qualification-agent', 'demo', 'salesforce'
        );

        // Execute all 7 steps
        for (Integer i = 0; i <= 6; i++) {
            OpportunityAgentDemoController.StepResult result =
                OpportunityAgentDemoController.executeStep(
                    sessionId, i, setup.opportunityId, setup.accountId
                );

            System.assertNotEquals(null, result.recordId, 'Step ' + i + ' should create a record');
            System.assertNotEquals(null, result.recordHash, 'Step ' + i + ' should have a hash');
            System.assertNotEquals(null, result.label, 'Step ' + i + ' should have a label');
            System.assertNotEquals(null, result.reasoning, 'Step ' + i + ' should have reasoning');
            System.assertNotEquals(null, result.displaySummary, 'Step ' + i + ' should have summary');
        }

        // Verify opportunity was updated
        Opportunity updatedOpp = [SELECT StageName FROM Opportunity WHERE Id = :setup.opportunityId];
        System.assertEquals('Qualification', updatedOpp.StageName);

        // Verify task was created
        List<Task> tasks = [SELECT Subject FROM Task WHERE WhatId = :setup.opportunityId];
        System.assertEquals(1, tasks.size());
        System.assert(tasks[0].Subject.contains('Discovery Call'));

        // Seal session
        OpportunityAgentDemoController.SealResult sealResult =
            OpportunityAgentDemoController.sealSession(sessionId);

        System.assertNotEquals(null, sealResult.merkleRoot);
        System.assertEquals(7, sealResult.recordCount);

        // Verify session
        AgentAuditRecorder.VerifySessionResult verifyResult =
            OpportunityAgentDemoController.verifySession(sessionId);

        System.assert(verifyResult.valid, 'Session should verify: ' + verifyResult.message);

        // Generate proof
        OpportunityAgentDemoController.ProofResult proof =
            OpportunityAgentDemoController.generateProof(sessionId, 3);

        System.assert(proof.isValid, 'Proof should be valid');
        System.assertEquals(3, proof.recordIndex);

        // Cleanup
        OpportunityAgentDemoController.cleanupDemoData(setup.accountId);
        List<Account> remaining = [SELECT Id FROM Account WHERE Id = :setup.accountId];
        System.assertEquals(0, remaining.size());
    }
}
