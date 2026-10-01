// ---------------------------------------------------------------------------
// THE EXTERNAL ANCHOR (Phase 5)
// Commits the sealed Merkle root to Arbitrum Sepolia, where the operator can't
// rewrite it. Only the 32-byte root goes on chain, never the records. Reading
// back is content-discoverable: given only the root, anyone can ask the chain
// when it was anchored, with no pointer stored off-chain.
// ---------------------------------------------------------------------------
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import fs from "node:fs";

const artifact = JSON.parse(fs.readFileSync(new URL("../contracts/AnchorRegistry.json", import.meta.url)));

function cfg() {
  return {
    rpc:  process.env.ARBITRUM_SEPOLIA_RPC_URL,
    key:  process.env.ANCHOR_PRIVATE_KEY,
    addr: process.env.ANCHOR_CONTRACT_ADDRESS,
  };
}
export function anchoringConfigured() {
  const c = cfg();
  return !!(c.rpc && c.key && c.addr);
}
export const artifactAbi = artifact.abi;
export const artifactBytecode = artifact.bytecode;

// Write the root on chain. Returns the anchor reference we cache in the session.
export async function anchorRoot(rootHex) {
  const c = cfg();
  const provider = new JsonRpcProvider(c.rpc);
  const wallet = new Wallet(c.key, provider);
  const contract = new Contract(c.addr, artifact.abi, wallet);
  const root = "0x" + rootHex;
  const tx = await contract.anchor(root);
  const receipt = await tx.wait();
  const block = await provider.getBlock(receipt.blockNumber);
  return {
    chain: "arbitrum-sepolia",
    contract: c.addr,
    root,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    anchoredAt: Number(block.timestamp),
    explorer: `https://sepolia.arbiscan.io/tx/${receipt.hash}`,
  };
}

// Content-discoverable read: given only the root, when was it anchored?
// Returns a unix timestamp, or 0 if this root was never anchored.
export async function readAnchor(rootHex) {
  const c = cfg();
  const provider = new JsonRpcProvider(c.rpc);
  const contract = new Contract(c.addr, artifact.abi, provider);
  const ts = await contract.anchoredAt("0x" + rootHex);
  return Number(ts);
}
