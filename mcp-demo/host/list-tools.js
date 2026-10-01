import { connectAll } from "./mcp-client.js";
const host = await connectAll();
console.log(`Connected to 5 MCP servers. Discovered ${host.allTools.length} tools:\n`);
for (const t of host.allTools) console.log(`  [${t.server.padEnd(8)}] ${t.name.padEnd(20)} ${t.description}`);
await host.closeAll();
