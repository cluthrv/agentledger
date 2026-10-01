// Runs the credit scenario in a FIXED order (no LLM yet). This proves every
// tool works end to end and shows the DECLINE + override storyline. Phase 3
// replaces this fixed order with the real agent choosing tools.
import { connectAll } from "./mcp-client.js";

const CUSTOMER = "MER-100";
const REQUESTED_LINE = 2400000;
const host = await connectAll();
const line = (s) => console.log(s);

line("TASK: extend " + CUSTOMER + "'s credit line to $" + REQUESTED_LINE.toLocaleString() + "\n");

const account = await host.call("get_account", { customerId: CUSTOMER });
line("1 get_account       -> " + account.name + ", " + account.tier + ", balance $" + account.currentBalance.toLocaleString());

const score = await host.call("get_credit_score", { customerId: CUSTOMER });
line("2 get_credit_score  -> " + score.score + " (was " + score.previousQuarter + ")");

const exposure = await host.call("get_exposure", { customerId: CUSTOMER, requestedLine: REQUESTED_LINE });
line("3 get_exposure      -> requested $" + exposure.requestedLine.toLocaleString() + " vs limit $" + exposure.policyLimit.toLocaleString() + " (overLimit=" + exposure.overLimit + ")");

const policy = await host.call("check_credit_policy", { score: score.score, requestedLine: REQUESTED_LINE, policyLimit: exposure.policyLimit });
line("4 check_credit_policy -> " + policy.recommendation.toUpperCase() + "  reasons: " + policy.reasons.join("; "));

line("\n   DECISION: recommend " + policy.recommendation.toUpperCase() + ". Exception needs " + policy.approverRole + " approval.");

const approval = await host.call("request_approval", { customerId: CUSTOMER, requestedLine: REQUESTED_LINE, reason: policy.reasons.join("; ") });
line("5 request_approval  -> " + approval.decision + " by " + approval.approver + " (" + approval.approvalId + ")  <-- HUMAN OVERRIDE");

line("\n   DECISION: approval received, proceeding to create the credit line.");

const cl = await host.call("create_credit_line", { customerId: CUSTOMER, amount: REQUESTED_LINE, approvalId: approval.approvalId });
line("6 create_credit_line -> " + cl.creditLineId + " $" + cl.amount.toLocaleString() + " " + cl.status);

line("\nRun complete. Agent recommended DECLINE; a human overrode and approved; credit line created.");
await host.closeAll();
