/**
 * AuditedLookupOpportunity
 *
 * Agentforce Invocable Action: Retrieves Opportunity and Account details.
 * Automatically records the query and results in AgentLedger.
 */
public with sharing class AuditedLookupOpportunity {

    @InvocableMethod(label='Lookup Opportunity (Audited)'
                     description='Retrieves opportunity and account details. Automatically recorded in AgentLedger audit trail.'
                     category='AgentLedger')
    public static List<Output> execute(List<Input> inputs) {
        List<Output> outputs = new List<Output>();

        for (Input inp : inputs) {
            Opportunity opp = [
                SELECT Name, Amount, StageName, CloseDate, Description,
                       LeadSource, Type, Probability,
                       Account.Name, Account.Industry, Account.AnnualRevenue,
                       Account.NumberOfEmployees, Account.BillingCity, Account.BillingState, Account.BillingCountryCode
                FROM Opportunity
                WHERE Id = :inp.opportunityId
                LIMIT 1
            ];

            Integer daysToClose = Date.today().daysBetween(opp.CloseDate);

            // Build output
            Output out = new Output();
            out.opportunityName = opp.Name;
            out.amount = opp.Amount;
            out.stage = opp.StageName;
            out.closeDate = opp.CloseDate;
            out.leadSource = opp.LeadSource;
            out.oppType = opp.Type;
            out.probability = opp.Probability;
            out.accountName = opp.Account.Name;
            out.accountIndustry = opp.Account.Industry;
            out.accountRevenue = opp.Account.AnnualRevenue;
            out.accountEmployees = opp.Account.NumberOfEmployees;
            out.accountLocation = opp.Account.BillingCity + ', ' + opp.Account.BillingState;
            out.daysUntilClose = daysToClose;
            out.description = opp.Description;

            out.summary = opp.Name + ' | $' + (opp.Amount != null ? String.valueOf(opp.Amount.intValue()) : '0')
                + ' | ' + opp.StageName + ' | Closes in ' + daysToClose + ' days'
                + ' | Account: ' + opp.Account.Name + ' (' + opp.Account.Industry + ')';

            // Record in AgentLedger
            String inputJson = JSON.serialize(new Map<String, Object>{
                'action' => 'lookupOpportunity',
                'opportunityId' => inp.opportunityId,
                'fields' => 'Name, Amount, StageName, CloseDate, Account details'
            });

            String outputJson = JSON.serialize(new Map<String, Object>{
                'opportunityName' => opp.Name,
                'amount' => opp.Amount,
                'stage' => opp.StageName,
                'closeDate' => String.valueOf(opp.CloseDate),
                'daysToClose' => daysToClose,
                'accountName' => opp.Account.Name,
                'accountIndustry' => opp.Account.Industry,
                'accountRevenue' => opp.Account.AnnualRevenue,
                'leadSource' => opp.LeadSource,
                'type' => opp.Type
            });

            String reasoning = 'Retrieved opportunity "' + opp.Name + '". Amount: $'
                + (opp.Amount != null ? String.valueOf(opp.Amount.intValue()) : '0')
                + '. Current stage: ' + opp.StageName
                + '. Close date: ' + opp.CloseDate.format() + ' (' + daysToClose + ' days out)'
                + '. Lead source: ' + (opp.LeadSource != null ? opp.LeadSource : 'None')
                + '. Account: ' + opp.Account.Name + ' (' + opp.Account.Industry
                + ', $' + (opp.Account.AnnualRevenue != null ? String.valueOf((opp.Account.AnnualRevenue / 1000000).intValue()) + 'M' : 'N/A')
                + ' revenue).';

            AgentAuditRecorder.recordAction(
                inp.sessionId, 'agentforce-opp-qualifier', 'Query',
                inputJson, outputJson, reasoning
            );

            outputs.add(out);
        }

        return outputs;
    }

    public class Input {
        @InvocableVariable(label='Session ID' required=true)
        public Id sessionId;

        @InvocableVariable(label='Opportunity ID' required=true)
        public Id opportunityId;
    }

    public class Output {
        @InvocableVariable(label='Opportunity Name') public String opportunityName;
        @InvocableVariable(label='Amount') public Decimal amount;
        @InvocableVariable(label='Stage') public String stage;
        @InvocableVariable(label='Close Date') public Date closeDate;
        @InvocableVariable(label='Lead Source') public String leadSource;
        @InvocableVariable(label='Type') public String oppType;
        @InvocableVariable(label='Probability') public Decimal probability;
        @InvocableVariable(label='Account Name') public String accountName;
        @InvocableVariable(label='Account Industry') public String accountIndustry;
        @InvocableVariable(label='Account Revenue') public Decimal accountRevenue;
        @InvocableVariable(label='Account Employees') public Integer accountEmployees;
        @InvocableVariable(label='Account Location') public String accountLocation;
        @InvocableVariable(label='Days Until Close') public Integer daysUntilClose;
        @InvocableVariable(label='Description') public String description;
        @InvocableVariable(label='Summary') public String summary;
    }
}
