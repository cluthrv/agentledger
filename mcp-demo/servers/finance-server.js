import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const server = new McpServer({ name: "finance-erp", version: "0.1.0" });
server.registerTool("get_exposure",
  { description: "Get current balance, the requested credit line, and the policy limit for a customer.",
    inputSchema: { customerId: z.string(), requestedLine: z.number() } },
  async ({ customerId, requestedLine }) => {
    const base = { "MER-100": { currentBalance: 900000, policyLimit: 2000000 } };
    const b = base[customerId] || { currentBalance: 0, policyLimit: 2000000 };
    const r = { ...b, requestedLine, overLimit: requestedLine > b.policyLimit };
    return { content: [{ type: "text", text: JSON.stringify(r) }] };
  });
await server.connect(new StdioServerTransport());
