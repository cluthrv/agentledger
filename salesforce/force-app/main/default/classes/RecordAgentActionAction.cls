/**
 * RecordAgentActionAction
 *
 * Invocable Action exposed to Agentforce and Flow. Records a single
 * agent step within an existing AgentLedger session — a Query, a
 * Decision, a Calculation, a Create, an Update, a Validation, an
 * Escalation, a Tool_Call, or a Delete. Call this once for every
 * meaningful step the agent takes while working through its task.
 *
 * The actionType value drives the colored badge and grouping shown
 * in the AgentLedger Audit Trail component on the record page.
 */
public with sharing class RecordAgentActionAction {

    public class Request {
        @InvocableVariable(label='Session Id' description='The sessionId returned by Start AgentLedger Session.' required=true)
        public Id sessionId;

        @InvocableVariable(label='Agent Id' description='Identifier for the AI agent. Should match the agentId used to start the session.' required=true)
        public String agentId;

        @InvocableVariable(label='Action Type' description='One of: Query, Validation, Decision, Calculation, Create, Update, Escalation, Tool_Call, Delete.' required=true)
        public String actionType;

        @InvocableVariable(label='Input Context' description='What the agent evaluated. Plain text or JSON summary of the inputs considered for this step.' required=false)
        public String inputContext;

        @InvocableVariable(label='Output Result' description='What the agent produced, decided, or returned for this step.' required=false)
        public String outputResult;

        @InvocableVariable(label='Reasoning' description='Why the agent took this step. Human-readable explanation, shown directly in the audit trail timeline.' required=true)
        public String reasoning;
    }

    public class Result {
        @InvocableVariable(label='Audit Record Id')
        public Id auditRecordId;

        @InvocableVariable(label='Record Hash')
        public String recordHash;

        @InvocableVariable(label='Sequence Number')
        public Integer sequenceNumber;

        @InvocableVariable(label='Success')
        public Boolean success;

        @InvocableVariable(label='Error Message')
        public String errorMessage;
    }

    private static final Set<String> VALID_ACTION_TYPES = new Set<String>{
        'Query', 'Validation', 'Decision', 'Calculation',
        'Create', 'Update', 'Escalation', 'Tool_Call', 'Delete'
    };

    @InvocableMethod(
        label='Record Agent Action'
        description='Records a single agent step (Query, Decision, Calculation, Create, Update, Validation, Escalation, Tool_Call, or Delete) in the AgentLedger audit trail.'
        category='AgentLedger'
    )
    public static List<Result> execute(List<Request> requests) {
        List<Result> results = new List<Result>();

        for (Request req : requests) {
            Result res = new Result();
            try {
                if (req.sessionId == null) {
                    res.success = false;
                    res.errorMessage = 'Session Id is required.';
                    results.add(res);
                    continue;
                }
                if (String.isBlank(req.agentId)) {
                    res.success = false;
                    res.errorMessage = 'Agent Id is required.';
                    results.add(res);
                    continue;
                }
                if (String.isBlank(req.actionType) || !VALID_ACTION_TYPES.contains(req.actionType)) {
                    res.success = false;
                    res.errorMessage = 'Action Type must be one of: ' +
                        String.join(new List<String>(VALID_ACTION_TYPES), ', ');
                    results.add(res);
                    continue;
                }
                if (String.isBlank(req.reasoning)) {
                    res.success = false;
                    res.errorMessage = 'Reasoning is required.';
                    results.add(res);
                    continue;
                }

                Agent_Audit_Record__c record = AgentAuditRecorder.recordAction(
                    req.sessionId,
                    req.agentId,
                    req.actionType,
                    req.inputContext,
                    req.outputResult,
                    req.reasoning
                );

                res.auditRecordId  = record.Id;
                res.recordHash     = record.Record_Hash__c;
                res.sequenceNumber = Integer.valueOf(record.Sequence_Number__c);
                res.success        = true;
            } catch (Exception ex) {
                res.success = false;
                res.errorMessage = ex.getMessage();
            }
            results.add(res);
        }

        return results;
    }
}