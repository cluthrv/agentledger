// ---------------------------------------------------------------------------
// The HOST: connects to all five MCP servers, aggregates their tools, and
// routes a tool call to whichever server owns that tool. This is the plumbing
// the agent (Phase 3) and the gateway (Phase 4) will build on.
// ---------------------------------------------------------------------------
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVERS = [
  { key: "crm",      file: "servers/crm-server.js" },
  { key: "bureau",   file: "servers/bureau-server.js" },
  { key: "finance",  file: "servers/finance-server.js" },
  { key: "policy",   file: "servers/policy-server.js" },
  { key: "approval", file: "servers/approval-server.js" },
];

export async function connectAll() {
  const clients = {};
  const toolOwner = {};   // toolName -> server key
  const allTools = [];    // aggregated tool definitions (for the agent)

  for (const s of SERVERS) {
    const transport = new StdioClientTransport({ command: "node", args: [s.file] });
    const client = new Client({ name: "agentledger-host", version: "0.1.0" });
    await client.connect(transport);
    clients[s.key] = client;
    const { tools } = await client.listTools();
    for (const t of tools) { toolOwner[t.name] = s.key; allTools.push({ ...t, server: s.key }); }
  }

  async function callTool(name, args) {
    const key = toolOwner[name];
    if (!key) throw new Error(`No server owns tool: ${name}`);
    return clients[key].callTool({ name, arguments: args });
  }

  return {
    allTools,
    callTool, // the raw MCP CallToolResult, including any _meta
    async call(name, args) {
      return JSON.parse((await callTool(name, args)).content[0].text);
    },
    async closeAll() { for (const k of Object.keys(clients)) await clients[k].close(); },
  };
}
