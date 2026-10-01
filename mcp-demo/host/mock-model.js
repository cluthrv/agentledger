// A scripted stand-in for the live model, so the UI "Run" button works offline
// for rehearsal. Set DEMO_MOCK=1 to use it. Live runs use the real model.
export function makeMockModel() {
  let step = 0;
  const mk = (n, i, id) => ({ content: [{ type: "tool_use", id, name: n, input: i }], stop_reason: "tool_use" });
  return { messages: { create: async () => {
    step++;
    if (step === 1) return { content: [
      { type: "text", text: "Gathering the account, credit score, and exposure in parallel." },
      { type: "tool_use", id: "a1", name: "get_account", input: { customerId: "MER-100" } },
      { type: "tool_use", id: "a2", name: "get_credit_score", input: { customerId: "MER-100" } },
      { type: "tool_use", id: "a3", name: "get_exposure", input: { customerId: "MER-100", requestedLine: 2400000 } },
    ], stop_reason: "tool_use" };
    if (step === 2) return mk("check_credit_policy", { score: 580, requestedLine: 2400000, policyLimit: 2000000 }, "a4");
    if (step === 3) return { content: [
      { type: "text", text: "Recommendation: DECLINE. Score 580 is below the 650 threshold and $2.4M is over the $2.0M limit. Routing for VP approval per policy." },
      { type: "tool_use", id: "a5", name: "request_approval", input: { customerId: "MER-100", requestedLine: 2400000, reason: "score 580 below 650; $2.4M over $2M limit" } },
    ], stop_reason: "tool_use" };
    if (step === 4) return mk("create_credit_line", { customerId: "MER-100", amount: 2400000, approvalId: "APR-9382" }, "a6");
    return { content: [{ type: "text", text: "Credit line CL-5678 created via VP override, against my DECLINE recommendation." }], stop_reason: "end_turn" };
  } } };
}
