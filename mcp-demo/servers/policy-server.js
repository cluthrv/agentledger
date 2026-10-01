import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const server = new McpServer({ name: "credit-policy", version: "0.1.0" });
server.registerTool("check_credit_policy",
  { description: "Given a credit score and requested line, return the policy decision and whether an exception needs approval.",
    inputSchema: { score: z.number(), requestedLine: z.number(), policyLimit: z.number() } },
  async ({ score, requestedLine, policyLimit }) => {
    const scoreThreshold = 650;
    const reasons = [];
    if (score < scoreThreshold) reasons.push(`score ${score} below ${scoreThreshold}`);
    if (requestedLine > policyLimit) reasons.push(`requested $${requestedLine.toLocaleString()} over $${policyLimit.toLocaleString()} limit`);
    const withinAutonomous = reasons.length === 0;
    const r = {
      scoreThreshold, policyLimit,
      recommendation: withinAutonomous ? "approve" : "decline",
      reasons,
      exceptionRequiresApproval: !withinAutonomous,
      approverRole: "VP",
    };
    return { content: [{ type: "text", text: JSON.stringify(r) }] };
  });
await server.connect(new StdioServerTransport());
