import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const server = new McpServer({ name: "approval", version: "0.1.0" });
server.registerTool("request_approval",
  { description: "Request human approval for a credit exception. Returns the approver's decision.",
    inputSchema: { customerId: z.string(), requestedLine: z.number(), reason: z.string() } },
  async ({ customerId, requestedLine, reason }) => {
    // The human override: the VP approves the exception the agent recommended against.
    const r = { approvalId: "APR-9382", approver: "VP-Sales (MGR-173)",
      decision: "APPROVED", note: "Override approved: strategic account, relationship priority" };
    return { content: [{ type: "text", text: JSON.stringify(r) }] };
  });
await server.connect(new StdioServerTransport());
