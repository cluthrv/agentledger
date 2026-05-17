/**
 * AuditedUpdateOpportunity
 *
 * Agentforce Invocable Action: Updates an Opportunity's stage,
 * probability, and/or description. Records the update with
 * before/after values in AgentLedger.
 */
public with sharing class AuditedUpdateOpportunity {

    @InvocableMethod(label='Update Opportunity (Audited)'
                     description='Updates opportunity fields and records the change in AgentLedger audit trail.'
                     category='AgentLedger')
    public static List<Output> execute(List<Input> inputs) {
        List<Output> outputs = new List<Output>();

        for (Input inp : inputs) {
            Opportunity opp = [
                SELECT Id, Name, StageName, Probability, Description, NextStep
                FROM Opportunity
                WHERE Id = :inp.opportunityId
                LIMIT 1
            ];

            // Capture before state
            String previousStage = opp.StageName;
            Decimal previousProbability = opp.Probability;
            String previousNextStep = opp.NextStep;

            // Apply updates
            List<String> fieldsChanged = new List<String>();

            if (String.isNotBlank(inp.newStage)) {
                opp.StageName = inp.newStage;
                fieldsChanged.add('Stage: ' + previousStage + ' -> ' + inp.newStage);
            }

            if (inp.newProbability != null) {
                opp.Probability = inp.newProbability;
                fieldsChanged.add('Probability: ' + (previousProbability != null ? String.valueOf(previousProbability.intValue()) : '0') + '% -> ' + inp.newProbability.intValue() + '%');
            }

            if (String.isNotBlank(inp.nextStep)) {
                opp.NextStep = inp.nextStep;
                fieldsChanged.add('Next Step updated');
            }

            if (String.isNotBlank(inp.addToDescription)) {
                String existing = opp.Description != null ? opp.Description : '';
                opp.Description = existing + '\n\n[AI Agent - ' + Date.today().format() + '] ' + inp.addToDescription;
                fieldsChanged.add('Description appended with agent notes');
            }

            update opp;

            // Build output
            Output out = new Output();
            out.success = true;
            out.previousStage = previousStage;
            out.newStage = opp.StageName;
            out.previousProbability = previousProbability;
            out.newProbability = opp.Probability;
            out.fieldsChanged = String.join(fieldsChanged, '; ');
            out.summary = 'Updated ' + fieldsChanged.size() + ' field(s): ' + String.join(fieldsChanged, '; ');

            // Record in AgentLedger
            String inputJson = JSON.serialize(new Map<String, Object>{
                'action' => 'updateOpportunity',
                'opportunityId' => inp.opportunityId,
                'newStage' => inp.newStage,
                'newProbability' => inp.newProbability,
                'nextStep' => inp.nextStep,
                'addToDescription' => inp.addToDescription
            });

            String outputJson = JSON.serialize(new Map<String, Object>{
                'success' => true,
                'previousStage' => previousStage,
                'newStage' => opp.StageName,
                'previousProbability' => previousProbability,
                'newProbability' => opp.Probability,
                'fieldsChanged' => fieldsChanged.size()
            });

            String reasoning = 'Updated opportunity "' + opp.Name + '". Changes: ' + String.join(fieldsChanged, '. ') + '.';

            AgentAuditRecorder.recordAction(
                inp.sessionId, 'agentforce-opp-qualifier', 'Create',
                inputJson, outputJson, reasoning
            );

            outputs.add(out);
        }

        return outputs;
    }

    public class Input {
        @InvocableVariable(label='Session ID' required=true) public Id sessionId;
        @InvocableVariable(label='Opportunity ID' required=true) public Id opportunityId;
        @InvocableVariable(label='New Stage' required=false) public String newStage;
        @InvocableVariable(label='New Probability' required=false) public Decimal newProbability;
        @InvocableVariable(label='Next Step' required=false) public String nextStep;
        @InvocableVariable(label='Add to Description' required=false) public String addToDescription;
    }

    public class Output {
        @InvocableVariable(label='Success') public Boolean success;
        @InvocableVariable(label='Previous Stage') public String previousStage;
        @InvocableVariable(label='New Stage') public String newStage;
        @InvocableVariable(label='Previous Probability') public Decimal previousProbability;
        @InvocableVariable(label='New Probability') public Decimal newProbability;
        @InvocableVariable(label='Fields Changed') public String fieldsChanged;
        @InvocableVariable(label='Summary') public String summary;
    }
}
