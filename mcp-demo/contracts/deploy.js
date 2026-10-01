import "dotenv/config";
import { JsonRpcProvider, Wallet, ContractFactory } from "ethers";
import fs from "node:fs";

const artifact = JSON.parse(fs.readFileSync(new URL("./AnchorRegistry.json", import.meta.url)));
const rpc = process.env.ARBITRUM_SEPOLIA_RPC_URL;
const key = process.env.ANCHOR_PRIVATE_KEY;
if (!rpc || !key) {
  console.error("Set ARBITRUM_SEPOLIA_RPC_URL and ANCHOR_PRIVATE_KEY in .env first.");
  process.exit(1);
}
const provider = new JsonRpcProvider(rpc);
const wallet = new Wallet(key, provider);
console.log("Deploying AnchorRegistry from", wallet.address, "...");
const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
const contract = await factory.deploy();
await contract.waitForDeployment();
const addr = await contract.getAddress();
console.log("\nAnchorRegistry deployed at:", addr);
console.log("Add this line to your .env:\n");
console.log("ANCHOR_CONTRACT_ADDRESS=" + addr + "\n");
process.exit(0);
