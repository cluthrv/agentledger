/**
 * AuditedStartSession
 *
 * Agentforce Invocable Action: Starts a new AgentLedger audit session.
 * Call this at the beginning of any agent workflow to begin
 * cryptographic tracking of all subsequent actions.
 */
public with sharing class AuditedStartSession {

    @InvocableMethod(label='Start Audited Session'
                     description='Starts a new AgentLedger cryptographic audit session. Call this before other audited actions.'
                     category='AgentLedger')
    public static List<Output> execute(List<Input> inputs) {
        List<Output> outputs = new List<Output>();

        for (Input inp : inputs) {
            String agentName = String.isNotBlank(inp.agentName) ? inp.agentName : 'agentforce-agent';
            String initiator = String.isNotBlank(inp.initiator) ? inp.initiator : 'agentforce';

            Id sessionId = AgentAuditRecorder.startSession(agentName, initiator, 'salesforce-agentforce');

            if (String.isNotBlank(inp.relatedRecordId)) {
                Agent_Audit_Session__c session = new Agent_Audit_Session__c(Id = sessionId);
                session.Related_Record_Id__c = inp.relatedRecordId;
                update session;
            }

            Output out = new Output();
            out.sessionId = sessionId;
            out.message = 'Audit session started. Session ID: ' + sessionId;
            outputs.add(out);
        }

        return outputs;
    }

    public class Input {
        @InvocableVariable(label='Agent Name' description='Name of the agent' required=false)
        public String agentName;

        @InvocableVariable(label='Initiator' description='Who triggered the agent' required=false)
        public String initiator;

        @InvocableVariable(label='Related Record ID' description='Record ID this session relates to (e.g., Opportunity ID)' required=false)
        public String relatedRecordId;
    }

    public class Output {
        @InvocableVariable(label='Session ID' description='The AgentLedger session ID for subsequent actions')
        public Id sessionId;

        @InvocableVariable(label='Message')
        public String message;
    }
}
