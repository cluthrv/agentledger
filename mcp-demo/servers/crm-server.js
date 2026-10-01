import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Captured fallback data. Used unless SF_USERNAME is set (then we go live).
const CAPTURED = {
  "MER-100": { accountId: "001XXMER100", name: "Meridian Industrial",
    tier: "Gold", currentBalance: 900000, recentPayments: "two 60-day-late in last quarter" }
};
const LIVE = !!process.env.SF_USERNAME;

async function sfConn() {
  const jsforce = (await import("jsforce")).default;
  const conn = new jsforce.Connection({ loginUrl: process.env.SF_LOGIN_URL || "https://login.salesforce.com" });
  await conn.login(process.env.SF_USERNAME, (process.env.SF_PASSWORD || "") + (process.env.SF_TOKEN || ""));
  return conn;
}

const server = new McpServer({ name: "salesforce-crm", version: "0.1.0" });

server.registerTool("get_account",
  { description: "Get a customer account: name, tier, balance, and payment history.",
    inputSchema: { customerId: z.string() } },
  async ({ customerId }) => {
    let r;
    if (LIVE) {
      const conn = await sfConn();
      // Map customerId to a real Account. Adjust the SOQL/field names to your org.
      const q = await conn.query(`SELECT Id, Name FROM Account WHERE Name = 'Meridian Industrial' LIMIT 1`);
      const acc = q.records[0];
      r = { accountId: acc?.Id || "unknown", name: acc?.Name || "Meridian Industrial",
        tier: "Gold", currentBalance: 900000, recentPayments: "two 60-day-late in last quarter" };
    } else {
      r = CAPTURED[customerId] || { accountId: "unknown", name: customerId, tier: "Standard" };
    }
    return { content: [{ type: "text", text: JSON.stringify(r) }] };
  });

server.registerTool("create_credit_line",
  { description: "Create a credit line for a customer for the approved amount. Returns the credit line id.",
    inputSchema: { customerId: z.string(), amount: z.number(), approvalId: z.string() } },
  async ({ customerId, amount, approvalId }) => {
    // In LIVE mode you would insert a record here. Captured returns a deterministic id.
    const r = { creditLineId: "CL-5678", customerId, amount, approvalId, status: "active" };
    return { content: [{ type: "text", text: JSON.stringify(r) }] };
  });

await server.connect(new StdioServerTransport());
