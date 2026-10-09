// ---------------------------------------------------------------------------
// VERIFY (Phase 6)
// Recomputes everything from the saved session and checks it against sources
// the session file can't rewrite:
//   - the root anchored on chain for this session, by an anchorer we pin
//   - the gateway's pinned signing key (receipts and checkpoints)
//   - each signing server's pinned key (server receipts)
// Nothing in the file is trusted on its own word: not the stored root, not the
// cached anchor block, not the public key it claims was used.
//
// status: verified           every check passed, including an independent anchor
//         intact-unanchored  internally consistent, but nothing independent was checked
//         tampered           a check failed
//         unavailable        the anchor source couldn't be reached
// ---------------------------------------------------------------------------
import "dotenv/config";
import fs from "node:fs";
import { hashActionRecord, computeMerkleRoot } from "@vluthra/agent-ledger";
import { anchorBackend, trustedAnchorers, readAnchor } from "./anchor.js";
import { trustedPublicKey, keyId, verifySignature, canonicalJson, sha256Hex, messages } from "./keys.js";
import { SESSION_PATH } from "./finalize.js";

export async function verifySession(sessionPath = SESSION_PATH) {
  const data = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
  const { records, session, anchor } = data;
  const checks = [];

  // 1. Each record's content must still match its stored hash.
  let contentOk = true, firstBad = -1;
  for (let i = 0; i < records.length; i++) {
    if (hashActionRecord(records[i]) !== records[i].hash) { contentOk = false; if (firstBad < 0) firstBad = i; }
  }
  checks.push({
    name: "record_hash_integrity",
    passed: contentOk,
    detail: contentOk
      ? `all ${records.length} record hashes match their content`
      : `record ${firstBad} (${label(records[firstBad])}) content does NOT match its stored hash`,
  });

  // 2. Chain linkage: each previousHash equals the prior record's hash.
  let chainOk = true, badLink = -1;
  for (let i = 1; i < records.length; i++) {
    if (records[i].previousHash !== records[i - 1].hash) { chainOk = false; badLink = i; break; }
  }
  checks.push({
    name: "hash_chain_linkage",
    passed: chainOk,
    detail: chainOk ? "chain intact" : `chain broken at record ${badLink}`,
  });

  // 3. The root stored in the file. Self-consistency only: whoever edits the
  //    records can rewrite this too.
  const hashes = records.map((r) => r.hash);
  const recomputed = computeMerkleRoot(hashes);
  checks.push({
    name: "sealed_root_match",
    passed: recomputed === session.merkleRoot,
    detail: recomputed === session.merkleRoot
      ? "recomputed root matches the root stored in the file"
      : `recomputed root ${recomputed.slice(0, 12)}... does NOT match the stored root ${String(session.merkleRoot).slice(0, 12)}...`,
  });

  checks.push(checkGatewaySignatures(data, hashes, recomputed));
  checks.push(checkServerReceipts(records));
  const anchorCheck = await checkAnchor(session.sessionId, recomputed, anchor);
  checks.push(anchorCheck);

  const status = checks.some((c) => !c.passed && !c.unavailable) ? "tampered"
    : checks.some((c) => c.unavailable) ? "unavailable"
    : checks.some((c) => c.independent) ? "verified"
    : "intact-unanchored";
  return {
    status,
    valid: status === "verified" || status === "intact-unanchored",
    independent: status === "verified",
    checks,
    anchor,
    onChain: anchorCheck.onChain || null,
    recomputed,
  };
}

const label = (r) => r?.metadata?.tool || r?.actionType;

// 4. Every record hash, every checkpoint, and the seal must carry a valid
//    signature from the PINNED gateway key, and each checkpoint must match the
//    Merkle root of the records it covers.
function checkGatewaySignatures(data, hashes, recomputed) {
  const name = "gateway_signatures";
  const pinned = trustedPublicKey("gateway");
  if (!pinned) return { name, passed: false, detail: "no pinned gateway key (set GATEWAY_PUBLIC_KEY or data/keys/gateway.pub.pem)" };
  const prov = data.provenance;
  if (!prov) return { name, passed: false, detail: "session carries no gateway signatures" };

  const pinnedId = keyId(pinned);
  const claimedId = prov.gateway?.keyId;
  const keyNote = claimedId && claimedId !== pinnedId ? ` (file claims key ${claimedId}; pinned gateway key is ${pinnedId})` : "";
  const sid = data.session.sessionId;
  const sigs = prov.recordSignatures || [];

  if (sigs.length !== data.records.length) {
    return { name, passed: false, detail: `${sigs.length} signatures for ${data.records.length} records` };
  }
  for (let i = 0; i < data.records.length; i++) {
    const r = data.records[i];
    if (!verifySignature(pinned, messages.record(sid, r.sequenceNumber, r.hash), sigs[i])) {
      return { name, passed: false, detail: `record ${i} (${label(r)}) is not signed by the gateway${keyNote}` };
    }
  }
  const cps = prov.checkpoints || [];
  for (const cp of cps) {
    if (!verifySignature(pinned, messages.checkpoint(cp.kind, sid, cp.recordCount, cp.root), cp.signature)) {
      return { name, passed: false, detail: `${cp.kind} at record ${cp.recordCount} is not signed by the gateway${keyNote}` };
    }
    if (cp.recordCount > hashes.length || computeMerkleRoot(hashes.slice(0, cp.recordCount)) !== cp.root) {
      return { name, passed: false, detail: `the first ${cp.recordCount} records no longer match the ${cp.kind} signed at ${cp.signedAt}` };
    }
  }
  const seal = cps[cps.length - 1];
  if (!seal || seal.kind !== "seal" || seal.recordCount !== hashes.length || seal.root !== recomputed) {
    return { name, passed: false, detail: "no signed seal covering every record" };
  }
  return {
    name, passed: true,
    detail: `${sigs.length} receipts and ${cps.length} checkpoints (incl. seal) signed by gateway key ${pinnedId}`,
  };
}

// 5. Any server with a pinned key must have signed every result it returned,
//    and the receipt must match the args and output recorded for that call.
function checkServerReceipts(records) {
  const name = "server_receipts";
  let checked = 0;
  for (const r of records) {
    const system = r.metadata?.system;
    if (r.actionType !== "tool_call" || !system) continue;
    const pinned = trustedPublicKey(system);
    if (!pinned) continue;
    const rc = r.metadata.serverReceipt;
    const at = `record ${r.sequenceNumber} (${label(r)})`;
    if (!rc) return { name, passed: false, detail: `${at}: ${system} signs every result, but this record has no ${system} receipt` };
    if (rc.server !== system || rc.tool !== r.metadata.tool) return { name, passed: false, detail: `${at}: receipt is for ${rc.server}/${rc.tool}` };
    if (!verifySignature(pinned, messages.serverReceipt(rc), rc.signature)) return { name, passed: false, detail: `${at}: receipt is not signed by ${system}'s pinned key` };
    if (rc.argsHash !== sha256Hex(canonicalJson(r.input?.args))) return { name, passed: false, detail: `${at}: recorded args differ from what ${system} signed` };
    if (rc.resultHash !== sha256Hex(canonicalJson(r.output))) return { name, passed: false, detail: `${at}: recorded output differs from what ${system} signed` };
    checked++;
  }
  return { name, passed: true, detail: checked ? `${checked} result(s) carry a valid server signature` : "no signing servers in this session" };
}

// 6. The anchor, read from its source, never from the session file.
async function checkAnchor(sessionId, recomputed, fileAnchor) {
  const backend = anchorBackend();
  if (!backend) {
    if (!fileAnchor?.root) return { name: "anchor", passed: true, detail: "session was not anchored; nothing independent to check against" };
    const cached = fileAnchor.root.replace(/^0x/, "");
    return {
      name: "anchored_root_offline",
      passed: recomputed === cached,
      detail: (recomputed === cached ? "recomputed root matches" : "recomputed root does NOT match")
        + " the anchor copied into the session file. NOT independent: configure ARBITRUM_SEPOLIA_RPC_URL and ANCHOR_CONTRACT_ADDRESS to check the chain.",
    };
  }

  const where = backend === "rehearsal" ? "the rehearsal registry (offline stand-in for the chain)" : "chain";
  const name = backend === "rehearsal" ? "anchored_root_rehearsal" : "anchored_root_onchain";
  const anchorers = backend === "rehearsal" ? ["rehearsal"] : trustedAnchorers();
  if (!anchorers.length) return { name, passed: false, detail: "no trusted anchorer configured (set ANCHOR_TRUSTED_ADDRESSES)" };

  try {
    for (const a of anchorers) {
      const on = await readAnchor(a, sessionId);
      if (!on) continue;
      const ok = on.root === recomputed;
      const when = new Date(on.anchoredAt * 1000).toISOString();
      return {
        name, passed: ok, independent: true,
        onChain: { anchorer: a, root: on.root, anchoredAt: on.anchoredAt, backend },
        detail: ok
          ? `recomputed root matches the root anchored on ${where} by ${a.slice(0, 10)}... at ${when}`
          : `recomputed root ${recomputed.slice(0, 12)}... does NOT match the root on ${where}: ${on.root.slice(0, 12)}... (anchored ${when})`,
      };
    }
    return { name, passed: false, detail: `no anchor for session ${sessionId.slice(0, 8)} from a trusted anchorer on ${where}` };
  } catch (e) {
    return { name, passed: false, unavailable: true, detail: `could not read the anchor from ${where}: ${e.shortMessage || e.message}` };
  }
}

// CLI
if (process.argv[1] && process.argv[1].endsWith("verify.js")) {
  const r = await verifySession();
  console.log("\nVerifying session against its independent sources...\n");
  for (const c of r.checks) console.log(`  [${c.passed ? "ok " : c.unavailable ? "?? " : "XX "}] ${c.name}: ${c.detail}`);
  const result = {
    verified: "VERIFIED - intact, signed by the gateway, and matches the independent anchor.",
    "intact-unanchored": "INTACT - internally consistent, but NOT checked against an independent anchor.",
    tampered: "TAMPER DETECTED - the record no longer matches what was signed and anchored.",
    unavailable: "COULD NOT VERIFY - the anchor source was unreachable. Nothing failed, but nothing independent was checked.",
  }[r.status];
  console.log("\n  RESULT: " + result);
  process.exit(r.valid ? 0 : 1);
}
