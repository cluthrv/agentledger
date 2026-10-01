import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { connectAll } from "./mcp-client.js";
import { startSession } from "./ledger.js";
import { withLedger } from "./gateway.js";
import { runAgent } from "./agent.js";
import { anchoringConfigured, anchorRoot } from "./anchor.js";

const raw = await connectAll();
const session = startSession();
const host = withLedger(raw, session);

console.log("Running the agent through the ledger gateway.");
console.log("Every tools/call and every decision is recorded at the boundary.\n");
await runAgent({ host });

const sealed = session.seal();
const v = session.verify();
const exp = session.export();

let anchorInfo = null;
if (anchoringConfigured()) {
  console.log("\nAnchoring the root to Arbitrum Sepolia (only the 32-byte root leaves the boundary)...");
  try {
    anchorInfo = await anchorRoot(sealed.merkleRoot);
    exp.anchor = anchorInfo;
    console.log("  anchored in block " + anchorInfo.blockNumber);
    console.log("  tx: " + anchorInfo.explorer);
  } catch (e) {
    console.log("  anchor failed: " + e.message);
    console.log("  (the session is still sealed locally; fix .env and re-run to anchor)");
  }
} else {
  console.log("\n(anchoring skipped: set ARBITRUM_SEPOLIA_RPC_URL, ANCHOR_PRIVATE_KEY,");
  console.log(" and ANCHOR_CONTRACT_ADDRESS in .env to enable)");
}

fs.mkdirSync(path.join("data", "sessions"), { recursive: true });
const outPath = path.join("data", "sessions", "session.json");
fs.writeFileSync(outPath, JSON.stringify(exp, null, 2));

console.log("\n------------------------------------------------------------");
console.log("  session sealed");
console.log("  records:     " + sealed.recordCount);
console.log("  merkle root: " + sealed.merkleRoot);
console.log("  verify:      " + (v.valid ? "VERIFIED" : "FAILED") + " - " + v.message);
if (anchorInfo) console.log("  anchored:    " + anchorInfo.chain + " @ " + new Date(anchorInfo.anchoredAt * 1000).toISOString());
console.log("  saved:       " + outPath);
console.log("------------------------------------------------------------");
await host.closeAll();
process.exit(0);
