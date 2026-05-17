/**
 * AuditedCreateTask
 *
 * Agentforce Invocable Action: Creates a follow-up task related to
 * an Opportunity. Records the task creation in AgentLedger.
 */
public with sharing class AuditedCreateTask {

    @InvocableMethod(label='Create Follow-up Task (Audited)'
                     description='Creates a task and records it in AgentLedger audit trail.'
                     category='AgentLedger')
    public static List<Output> execute(List<Input> inputs) {
        List<Output> outputs = new List<Output>();

        for (Input inp : inputs) {
            Task t = new Task(
                Subject = inp.subject,
                WhatId = inp.relatedToId,
                ActivityDate = inp.dueDate != null ? inp.dueDate : Date.today().addDays(3),
                Priority = String.isNotBlank(inp.priority) ? inp.priority : 'Normal',
                Status = 'Not Started',
                Description = inp.taskDescription
            );
            insert t;

            Output out = new Output();
            out.taskId = t.Id;
            out.subject = t.Subject;
            out.dueDate = t.ActivityDate;
            out.priority = t.Priority;
            out.summary = 'Task created: "' + t.Subject + '" | Due: ' + t.ActivityDate.format() + ' | Priority: ' + t.Priority;

            // Record in AgentLedger
            String inputJson = JSON.serialize(new Map<String, Object>{
                'action' => 'createTask',
                'subject' => t.Subject,
                'relatedTo' => inp.relatedToId,
                'dueDate' => String.valueOf(t.ActivityDate),
                'priority' => t.Priority
            });

            String outputJson = JSON.serialize(new Map<String, Object>{
                'taskId' => t.Id,
                'subject' => t.Subject,
                'dueDate' => String.valueOf(t.ActivityDate),
                'priority' => t.Priority,
                'status' => t.Status
            });

            String reasoning = 'Created follow-up task: "' + t.Subject + '". Due: '
                + t.ActivityDate.format() + '. Priority: ' + t.Priority
                + '. ' + (String.isNotBlank(t.Description) ? 'Notes: ' + t.Description : '');

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
        @InvocableVariable(label='Subject' required=true) public String subject;
        @InvocableVariable(label='Related To (Record ID)' required=true) public Id relatedToId;
        @InvocableVariable(label='Due Date' required=false) public Date dueDate;
        @InvocableVariable(label='Priority' required=false) public String priority;
        @InvocableVariable(label='Task Description' required=false) public String taskDescription;
    }

    public class Output {
        @InvocableVariable(label='Task ID') public Id taskId;
        @InvocableVariable(label='Subject') public String subject;
        @InvocableVariable(label='Due Date') public Date dueDate;
        @InvocableVariable(label='Priority') public String priority;
        @InvocableVariable(label='Summary') public String summary;
    }
}
