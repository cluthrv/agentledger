import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const server = new McpServer({ name: "credit-bureau", version: "0.1.0" });
server.registerTool("get_credit_score",
  { description: "Get the current credit score for a customer id.",
    inputSchema: { customerId: z.string() } },
  async ({ customerId }) => {
    const data = { "MER-100": { score: 580, previousQuarter: 690 } };
    const r = data[customerId] || { score: 700, previousQuarter: 700 };
    return { content: [{ type: "text", text: JSON.stringify(r) }] };
  });
await server.connect(new StdioServerTransport());
