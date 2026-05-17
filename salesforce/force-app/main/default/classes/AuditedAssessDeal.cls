/**
 * AuditedAssessDeal
 *
 * Agentforce Invocable Action: Evaluates an opportunity based on
 * real data — amount thresholds, account history, deal type, and
 * time to close. Returns classification, risk assessment, and
 * recommended actions. All recorded in AgentLedger.
 */
public with sharing class AuditedAssessDeal {

    @InvocableMethod(label='Assess Deal (Audited)'
                     description='Evaluates opportunity size, risk, and win factors. Recorded in AgentLedger audit trail.'
                     category='AgentLedger')
    public static List<Output> execute(List<Input> inputs) {
        List<Output> outputs = new List<Output>();

        for (Input inp : inputs) {
            Output out = new Output();

            // Deal size classification
            if (inp.amount >= 500000) {
                out.dealClassification = 'Strategic';
                out.approvalLevel = 'C-Suite';
                out.reviewCadence = 'Weekly executive review';
            } else if (inp.amount >= 200000) {
                out.dealClassification = 'Enterprise';
                out.approvalLevel = 'VP Sales';
                out.reviewCadence = 'Weekly pipeline review';
            } else if (inp.amount >= 50000) {
                out.dealClassification = 'Mid-Market';
                out.approvalLevel = 'Regional Manager';
                out.reviewCadence = 'Bi-weekly review';
            } else {
                out.dealClassification = 'Standard';
                out.approvalLevel = 'Sales Rep';
                out.reviewCadence = 'Monthly review';
            }

            // Win probability calculation based on real factors
            Decimal baseProb = 50;

            // Factor: existing customer vs new
            if (inp.oppType == 'Existing Business' || inp.oppType == 'Existing Customer - Upgrade') {
                baseProb += 15;
                out.existingCustomerBonus = true;
            } else {
                out.existingCustomerBonus = false;
            }

            // Factor: lead source
            if (inp.leadSource == 'Partner Referral') {
                baseProb += 10;
            } else if (inp.leadSource == 'Customer Event' || inp.leadSource == 'Employee Referral') {
                baseProb += 7;
            } else if (inp.leadSource == 'Web' || inp.leadSource == 'Phone Inquiry') {
                baseProb += 3;
            }

            // Factor: account revenue (larger accounts = more likely to close)
            if (inp.accountRevenue != null && inp.accountRevenue > 50000000) {
                baseProb += 5;
            }

            // Factor: days to close (too soon = risky, too far = uncertain)
            if (inp.daysUntilClose != null) {
                if (inp.daysUntilClose < 14) {
                    baseProb -= 10; // Too aggressive
                } else if (inp.daysUntilClose > 180) {
                    baseProb -= 8; // Too far out
                } else if (inp.daysUntilClose >= 30 && inp.daysUntilClose <= 90) {
                    baseProb += 5; // Sweet spot
                }
            }

            // Cap at 95
            out.winProbability = Math.min(baseProb, 95).intValue();

            // Confidence level
            if (out.winProbability >= 75) {
                out.confidenceLevel = 'High';
            } else if (out.winProbability >= 55) {
                out.confidenceLevel = 'Medium';
            } else {
                out.confidenceLevel = 'Low';
            }

            // Risk factors
            List<String> risks = new List<String>();
            List<String> positives = new List<String>();

            if (out.existingCustomerBonus) {
                positives.add('Existing customer relationship');
            } else {
                risks.add('New customer - no established relationship');
            }

            if (inp.leadSource == 'Partner Referral') {
                positives.add('Partner referral (higher historical close rate)');
            }

            if (inp.daysUntilClose != null && inp.daysUntilClose < 14) {
                risks.add('Close date is within 14 days - timeline may be too aggressive');
            }

            if (inp.daysUntilClose != null && inp.daysUntilClose > 180) {
                risks.add('Close date is 6+ months out - deal may stall');
            }

            if (inp.amount >= 500000) {
                risks.add('Strategic deal size requires executive sponsorship');
            }

            if (String.isBlank(inp.description)) {
                risks.add('No opportunity description - discovery may be incomplete');
            }

            out.riskFactors = String.join(risks, '; ');
            out.positiveFactors = String.join(positives, '; ');

            // Recommendation
            if (out.winProbability >= 65) {
                out.recommendation = 'Proceed with active qualification. Schedule discovery call to confirm budget and decision criteria.';
            } else if (out.winProbability >= 45) {
                out.recommendation = 'Proceed with caution. Additional discovery needed to validate opportunity. Consider competitive analysis.';
            } else {
                out.recommendation = 'Flag for review. Win probability is low. Reassess whether this opportunity should remain in active pipeline.';
            }

            out.summary = out.dealClassification + ' deal | ' + out.winProbability + '% win probability ('
                + out.confidenceLevel + ') | ' + out.approvalLevel + ' approval required';

            // Record in AgentLedger
            String inputJson = JSON.serialize(new Map<String, Object>{
                'action' => 'assessDeal',
                'amount' => inp.amount,
                'oppType' => inp.oppType,
                'leadSource' => inp.leadSource,
                'accountRevenue' => inp.accountRevenue,
                'daysUntilClose' => inp.daysUntilClose,
                'hasDescription' => String.isNotBlank(inp.description)
            });

            String outputJson = JSON.serialize(new Map<String, Object>{
                'dealClassification' => out.dealClassification,
                'winProbability' => out.winProbability,
                'confidenceLevel' => out.confidenceLevel,
                'approvalLevel' => out.approvalLevel,
                'recommendation' => out.recommendation,
                'riskCount' => risks.size(),
                'positiveCount' => positives.size()
            });

            String reasoning = 'Assessed deal at $' + (inp.amount != null ? String.valueOf(inp.amount.intValue()) : '0')
                + '. Classification: ' + out.dealClassification
                + '. Win probability: ' + out.winProbability + '% (confidence: ' + out.confidenceLevel + ').'
                + ' Positive factors: ' + (positives.isEmpty() ? 'None identified' : String.join(positives, ', ')) + '.'
                + ' Risk factors: ' + (risks.isEmpty() ? 'None identified' : String.join(risks, ', ')) + '.'
                + ' Recommendation: ' + out.recommendation;

            AgentAuditRecorder.recordAction(
                inp.sessionId, 'agentforce-opp-qualifier', 'Calculation',
                inputJson, outputJson, reasoning
            );

            outputs.add(out);
        }

        return outputs;
    }

    public class Input {
        @InvocableVariable(label='Session ID' required=true) public Id sessionId;
        @InvocableVariable(label='Amount' required=false) public Decimal amount;
        @InvocableVariable(label='Opportunity Type' required=false) public String oppType;
        @InvocableVariable(label='Lead Source' required=false) public String leadSource;
        @InvocableVariable(label='Account Revenue' required=false) public Decimal accountRevenue;
        @InvocableVariable(label='Days Until Close' required=false) public Integer daysUntilClose;
        @InvocableVariable(label='Description' required=false) public String description;
    }

    public class Output {
        @InvocableVariable(label='Deal Classification') public String dealClassification;
        @InvocableVariable(label='Win Probability') public Integer winProbability;
        @InvocableVariable(label='Confidence Level') public String confidenceLevel;
        @InvocableVariable(label='Approval Level') public String approvalLevel;
        @InvocableVariable(label='Review Cadence') public String reviewCadence;
        @InvocableVariable(label='Existing Customer Bonus') public Boolean existingCustomerBonus;
        @InvocableVariable(label='Risk Factors') public String riskFactors;
        @InvocableVariable(label='Positive Factors') public String positiveFactors;
        @InvocableVariable(label='Recommendation') public String recommendation;
        @InvocableVariable(label='Summary') public String summary;
    }
}
