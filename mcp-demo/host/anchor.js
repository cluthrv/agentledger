// ---------------------------------------------------------------------------
// THE EXTERNAL ANCHOR (Phase 5)
// Commits the sealed Merkle root to Arbitrum Sepolia, where the operator can't
// rewrite it. Only the session id and the 32-byte root go on chain, never the
// records. The contract keys each root by (anchorer, sessionId), so a verifier
// that pins the gateway's wallet address can look the root up from the chain
// itself instead of trusting whatever root a session file claims.
//
// Backends, chosen by configuration (never by the session file):
//   chain      ARBITRUM_SEPOLIA_RPC_URL + ANCHOR_CONTRACT_ADDRESS (+ ANCHOR_PRIVATE_KEY to write)
//   rehearsal  DEMO_MOCK=1 and no chain configured: a local write-once registry
//              file that stands in for the chain so the demo works offline
// ---------------------------------------------------------------------------
import { JsonRpcProvider, Wallet, Contract, getAddress } from "ethers";
import fs from "node:fs";
import path from "node:path";

const artifact = JSON.parse(fs.readFileSync(new URL("../contracts/AnchorRegistry.json", import.meta.url)));
const REHEARSAL_REGISTRY = path.join("data", "rehearsal-anchors.json");

function cfg() {
  return {
    rpc:  process.env.ARBITRUM_SEPOLIA_RPC_URL,
    key:  process.env.ANCHOR_PRIVATE_KEY,
    addr: process.env.ANCHOR_CONTRACT_ADDRESS,
    chain: process.env.ANCHOR_CHAIN_NAME || "arbitrum-sepolia",
    explorer: process.env.ANCHOR_EXPLORER_TX_URL || "https://sepolia.arbiscan.io/tx/",
  };
}
export function anchoringConfigured() {
  const c = cfg();
  return !!(c.rpc && c.key && c.addr);
}
// Reading needs no private key: an auditor only needs the RPC, contract, and trusted address.
function chainReadable() {
  const c = cfg();
  return !!(c.rpc && c.addr);
}
export function anchorBackend() {
  if (chainReadable()) return "chain";
  if (process.env.DEMO_MOCK === "1") return "rehearsal";
  return null;
}
export const artifactAbi = artifact.abi;
export const artifactBytecode = artifact.bytecode;

// Session ids are UUIDs: 16 bytes, left-padded into a bytes32.
export function sessionIdToBytes32(sessionId) {
  const hex = String(sessionId).replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error("session id is not a UUID: " + sessionId);
  return "0x" + hex.padStart(64, "0");
}

// The anchorer addresses a verifier trusts. Pin them explicitly with
// ANCHOR_TRUSTED_ADDRESSES; otherwise fall back to the operator's own wallet.
export function trustedAnchorers() {
  const pinned = (process.env.ANCHOR_TRUSTED_ADDRESSES || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (pinned.length) return pinned.map((a) => getAddress(a));
  if (process.env.ANCHOR_PRIVATE_KEY) return [new Wallet(process.env.ANCHOR_PRIVATE_KEY).address];
  return [];
}

// Write the root. Returns the anchor reference we cache in the session file
// (a convenience for humans; the verifier re-reads the anchor from its source).
export async function anchorRoot(sessionId, rootHex) {
  if (anchorBackend() === "rehearsal") return anchorRehearsal(sessionId, rootHex);
  const c = cfg();
  const provider = new JsonRpcProvider(c.rpc);
  const wallet = new Wallet(c.key, provider);
  const contract = new Contract(c.addr, artifact.abi, wallet);
  const root = "0x" + rootHex;
  const tx = await contract.anchor(sessionIdToBytes32(sessionId), root);
  const receipt = await tx.wait();
  const block = await provider.getBlock(receipt.blockNumber);
  return {
    chain: c.chain,
    contract: c.addr,
    anchorer: wallet.address,
    sessionId,
    root,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    anchoredAt: Number(block.timestamp),
    explorer: c.explorer + receipt.hash,
  };
}

// Read the root anchored for this session by this anchorer, straight from the
// source. Returns { root (hex, no 0x), anchoredAt (unix s) } or null.
export async function readAnchor(anchorer, sessionId) {
  if (anchorBackend() === "rehearsal") return readRehearsal(sessionId);
  const c = cfg();
  const provider = new JsonRpcProvider(c.rpc);
  const contract = new Contract(c.addr, artifact.abi, provider);
  const [root, anchoredAt] = await contract.anchors(anchorer, sessionIdToBytes32(sessionId));
  if (Number(anchoredAt) === 0) return null;
  return { root: root.replace(/^0x/, ""), anchoredAt: Number(anchoredAt) };
}

// --- rehearsal registry: same write-once semantics as the contract, in a file
// outside the session file. Offline stand-in only; it is not independent of
// someone with access to this machine.
function loadRegistry() {
  try { return JSON.parse(fs.readFileSync(REHEARSAL_REGISTRY, "utf8")); } catch { return {}; }
}
function anchorRehearsal(sessionId, rootHex) {
  const reg = loadRegistry();
  const key = sessionIdToBytes32(sessionId);
  if (reg[key]) throw new Error("session already anchored");
  const anchoredAt = Math.floor(Date.now() / 1000);
  reg[key] = { root: rootHex, anchoredAt };
  fs.mkdirSync(path.dirname(REHEARSAL_REGISTRY), { recursive: true });
  fs.writeFileSync(REHEARSAL_REGISTRY, JSON.stringify(reg, null, 2));
  return { chain: "rehearsal registry (offline stand-in for the chain)", anchorer: "rehearsal", sessionId, root: "0x" + rootHex, anchoredAt, txHash: null, explorer: null };
}
function readRehearsal(sessionId) {
  return loadRegistry()[sessionIdToBytes32(sessionId)] || null;
}
