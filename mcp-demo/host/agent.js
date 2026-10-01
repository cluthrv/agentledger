// ---------------------------------------------------------------------------
// THE AGENT LOOP (Phase 3)
// Gives Claude the MCP tools, lets it choose which to call, routes each choice
// to the right MCP server, feeds results back, and repeats until Claude is done.
// This is where MCP meets the LLM: MCP tools become the model's tools, and the
// model's tool choices become tools/call invocations.
// ---------------------------------------------------------------------------
import Anthropic from "@anthropic-ai/sdk";
import { connectAll } from "./mcp-client.js";

export const MODEL = "claude-sonnet-5";
export const CUSTOMER = "MER-100";
export const REQUESTED_LINE = 2400000;

const SYSTEM = `You are a credit operations agent deciding whether to extend a customer's credit line.
Use the tools to gather the account, the credit score, the exposure and policy limit, and the policy decision.
State a clear recommendation, APPROVE or DECLINE, with your reasons, before acting.
If the policy result says an exception requires approval, call request_approval before creating anything.
Only call create_credit_line if you have an approval decision of APPROVED. Pass the approvalId to it.
Be concise. Do the work with tools; do not ask the user questions.`;

// runAgent can take an injected anthropic client (for testing) and an onEvent
// callback (the UI will use this later to stream the run).
export async function runAgent({ anthropic, onEvent, host } = {}) {
  const ownHost = !host;
  host = host || (await connectAll());
  anthropic = anthropic || new Anthropic(); // reads ANTHROPIC_API_KEY from env
  const emit = (e) => { if (onEvent) onEvent(e); };

  // Map MCP tools -> Anthropic tool schema (names, descriptions, JSON Schema).
  const tools = host.allTools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));

  const messages = [{
    role: "user",
    content: `Task: extend customer ${CUSTOMER}'s credit line to $${REQUESTED_LINE.toLocaleString()}. Use requestedLine=${REQUESTED_LINE} where a tool needs it.`,
  }];

  while (true) {
    const resp = await anthropic.messages.create({
      model: MODEL, max_tokens: 1024, system: SYSTEM, tools, messages,
    });
    messages.push({ role: "assistant", content: resp.content });

    // The agent's text blocks are its declared reasoning / recommendation.
    for (const block of resp.content) {
      if (block.type === "text" && block.text.trim()) {
        emit({ type: "decision", text: block.text.trim() });
        if (host.recordDecision) host.recordDecision(block.text.trim());
        console.log("\n  agent: " + block.text.trim());
      }
    }

    if (resp.stop_reason === "tool_use") {
      const toolResults = [];
      for (const block of resp.content) {
        if (block.type !== "tool_use") continue;
        emit({ type: "tool_call", name: block.name, input: block.input });
        console.log(`  -> ${block.name}(${JSON.stringify(block.input)})`);
        let result;
        try { result = await host.call(block.name, block.input); }
        catch (e) { result = { error: String(e.message || e) }; }
        console.log(`     ${JSON.stringify(result)}`);
        emit({ type: "tool_result", name: block.name, output: result });
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      }
      messages.push({ role: "user", content: toolResults });
      continue; // let the agent see the results and choose the next step
    }
    break; // stop_reason end_turn: the agent is done
  }

  if (ownHost) await host.closeAll();
  return messages;
}
