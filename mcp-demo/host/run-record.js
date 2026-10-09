import "dotenv/config";
import { connectAll } from "./mcp-client.js";
import { startSession } from "./ledger.js";
import { withLedger } from "./gateway.js";
import { runAgent } from "./agent.js";
import { sealAndAnchor, SESSION_PATH } from "./finalize.js";
import { makeMockModel } from "./mock-model.js";

const raw = await connectAll();
const session = startSession();
const host = withLedger(raw, session);

console.log("Running the agent through the ledger gateway.");
console.log("Every tools/call and every decision is recorded and signed at the boundary.\n");
await runAgent({ host, anthropic: process.env.DEMO_MOCK === "1" ? makeMockModel() : undefined });

const { sealed, verify: v, anchor: anchorInfo, anchorError } = await sealAndAnchor(host, {
  onEvent: (e) => {
    if (e.type === "anchoring") console.log("\nAnchoring the root (only the session id and 32-byte root leave the boundary)...");
  },
});
if (anchorInfo) {
  console.log("  anchored " + (anchorInfo.blockNumber ? "in block " + anchorInfo.blockNumber : "in the " + anchorInfo.chain));
  if (anchorInfo.explorer) console.log("  tx: " + anchorInfo.explorer);
} else if (anchorError) {
  console.log("  anchor failed: " + anchorError);
  console.log("  (the session is still sealed and signed locally; fix .env and re-run to anchor)");
} else {
  console.log("\n(anchoring skipped: set ARBITRUM_SEPOLIA_RPC_URL, ANCHOR_PRIVATE_KEY,");
  console.log(" and ANCHOR_CONTRACT_ADDRESS in .env to enable, or DEMO_MOCK=1 for the offline rehearsal registry)");
}

console.log("\n------------------------------------------------------------");
console.log("  session sealed");
console.log("  records:     " + sealed.recordCount);
console.log("  merkle root: " + sealed.merkleRoot);
console.log("  verify:      " + (v.valid ? "VERIFIED" : "FAILED") + " - " + v.message);
if (anchorInfo) console.log("  anchored:    " + anchorInfo.chain + " @ " + new Date(anchorInfo.anchoredAt * 1000).toISOString());
console.log("  saved:       " + SESSION_PATH);
console.log("------------------------------------------------------------");
await host.closeAll();
process.exit(0);
