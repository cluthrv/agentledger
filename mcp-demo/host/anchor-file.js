// ---------------------------------------------------------------------------
// ANCHOR A FILE
//   node host/anchor-file.js <file>            anchor the file's SHA-256
//   node host/anchor-file.js --check <file>    look it up on chain
// Proves a file existed no later than a block's time, using the same
// AnchorRegistry as sessions. The slot id is derived from the file itself
// (the first 16 bytes of its SHA-256, written as a UUID) and the root is the
// full SHA-256, so anyone holding the file can find and check its anchor.
// Only the hash goes on chain, never the file.
// ---------------------------------------------------------------------------
import "dotenv/config";
import fs from "node:fs";
import crypto from "node:crypto";
import { anchorBackend, anchoringConfigured, anchorRoot, readAnchor, trustedAnchorers } from "./anchor.js";

const args = process.argv.slice(2);
const check = args.includes("--check");
const file = args.find((a) => !a.startsWith("--"));
if (!file) { console.error("usage: node host/anchor-file.js [--check] <file>"); process.exit(1); }
if (anchorBackend() !== "chain") { console.error("Configure ARBITRUM_SEPOLIA_RPC_URL and ANCHOR_CONTRACT_ADDRESS in .env first."); process.exit(1); }

const sha = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const h = sha.slice(0, 32);
const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
console.log(`file:    ${file}`);
console.log(`sha256:  ${sha}`);
console.log(`slot id: ${id}  (first 16 bytes of the sha256)`);

if (check) {
  for (const a of trustedAnchorers()) {
    const on = await readAnchor(a, id);
    if (!on) continue;
    const ok = on.root === sha;
    console.log(`\n${ok ? "ANCHORED" : "MISMATCH"}: by ${a} at ${new Date(on.anchoredAt * 1000).toISOString()}`);
    process.exit(ok ? 0 : 1);
  }
  console.log("\nNOT ANCHORED by a trusted anchorer");
  process.exit(1);
}

if (!anchoringConfigured()) { console.error("Set ANCHOR_PRIVATE_KEY in .env to anchor."); process.exit(1); }
const a = await anchorRoot(id, sha);
console.log(`\nanchored on ${a.chain}`);
console.log(`  contract:  ${a.contract}`);
console.log(`  anchorer:  ${a.anchorer}`);
console.log(`  block:     ${a.blockNumber}`);
console.log(`  time:      ${new Date(a.anchoredAt * 1000).toISOString()}`);
console.log(`  tx:        ${a.txHash}`);
console.log(`  explorer:  ${a.explorer}`);
