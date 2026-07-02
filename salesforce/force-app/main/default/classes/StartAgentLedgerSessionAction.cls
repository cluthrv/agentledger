/**
 * StartAgentLedgerSessionAction
 *
 * Invocable Action exposed to Agentforce and Flow. Starts a new
 * AgentLedger audit session linked to a Salesforce record. Call this
 * first, before any decisions or actions are recorded. Store the
 * returned sessionId and pass it to every subsequent AgentLedger
 * action in the same agent run .
 */
public with sharing class StartAgentLedgerSessionAction {

    public class Request {
        @InvocableVariable(label='Agent Id' description='Identifier for the AI agent, e.g. opportunity-qualification-agent' required=true)
        public String agentId;

        @InvocableVariable(label='Related Record Id' description='The Salesforce record this session relates to, e.g. the Opportunity Id being qualified. This links the audit trail to the record page.' required=true)
        public String relatedRecordId;

        @InvocableVariable(label='Platform' description='Platform identifier, e.g. salesforce, agentforce' required=false)
        public String platform;
    }

    public class Result {
        @InvocableVariable(label='Session Id' description='Salesforce record Id of the created session. Store this and pass it to every subsequent AgentLedger action.')
        public Id sessionId;

        @InvocableVariable(label='Success')
        public Boolean success;

        @InvocableVariable(label='Error Message')
        public String errorMessage;
    }

    @InvocableMethod(
        label='Start AgentLedger Session'
        description='Creates a new AgentLedger audit session linked to a record. Call this first, before recording any decisions or actions.'
        category='AgentLedger'
    )
    public static List<Result> execute(List<Request> requests) {
        List<Result> results = new List<Result>();

        for (Request req : requests) {
            Result res = new Result();
            try {
                if (String.isBlank(req.agentId)) {
                    res.success = false;
                    res.errorMessage = 'Agent Id is required.';
                    results.add(res);
                    continue;
                }
                if (String.isBlank(req.relatedRecordId)) {
                    res.success = false;
                    res.errorMessage = 'Related Record Id is required.';
                    results.add(res);
                    continue;
                }

                Id sessionId = AgentAuditRecorder.startSession(
                    req.agentId,
                    req.relatedRecordId,
                    String.isNotBlank(req.platform) ? req.platform : 'salesforce'
                );

                res.sessionId = sessionId;
                res.success = true;
            } catch (Exception ex) {
                res.success = false;
                res.errorMessage = ex.getMessage();
            }
            results.add(res);
        }

        return results;
    }
}