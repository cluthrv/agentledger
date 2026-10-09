// ---------------------------------------------------------------------------
// TAMPER (Phase 6, demo attacker tool)
//   node host/tamper.js <sequenceNumber> <path> <value> [--smart | --forge]
// naive (default): change content, leave the stored hash -> breaks record_hash_integrity
// --smart: also recompute hashes, re-chain, and re-seal locally
//          -> chain looks intact, but the gateway signatures and the anchor don't match
// --forge: rewrite everything in the file, including the cached anchor root and
//          every signature (with the attacker's own key)
//          -> the file is fully self-consistent; only the pinned keys and the
//             on-chain root catch it
// A backup is written once so you can restore and re-run the demo.
// ---------------------------------------------------------------------------
import { tamperSession } from "./ops.js";

const args = process.argv.slice(2);
const mode = args.includes("--forge") ? "forge" : args.includes("--smart") ? "smart" : "naive";
const [seq, path, ...valueParts] = args.filter((a) => !a.startsWith("--"));

let t;
try { t = tamperSession({ seq, path, value: valueParts.join(" "), mode }); }
catch (e) { console.error(e.message); process.exit(1); }

console.log(`Tampered record ${t.seq}: ${t.path}`);
console.log(`   ${JSON.stringify(t.before)}  ->  ${JSON.stringify(t.after)}`);
if (mode === "smart") console.log("   --smart: re-hashed, re-chained, and re-sealed locally.");
if (mode === "forge") console.log("   --forge: re-sealed, rewrote the cached anchor root, and re-signed everything with an attacker key.");
console.log("Saved. Now run:  npm run verify");
