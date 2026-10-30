import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadSigningKey, canonicalJson, sha256Hex, messages, SERVER_RECEIPT_META_KEY } from "../host/keys.js";

// The bureau signs what it returned, with its own key. The gateway records this
// receipt inside the ledger record, so the evidence has two independent signers:
// the client side (gateway) and the server side (bureau).
// Receipt format: docs/extensions/receipts (io.github.cluthrv/receipts). The
// signed result is structuredContent; the text block repeats it for clients
// that only read text.
const signer = loadSigningKey("bureau");
const server = new McpServer({ name: "credit-bureau", version: "0.1.0" });
server.registerTool("get_credit_score",
  { description: "Get the current credit score for a customer id.",
    inputSchema: { customerId: z.string() },
    outputSchema: { score: z.number(), previousQuarter: z.number() } },
  async (args) => {
    const data = { "MER-100": { score: 580, previousQuarter: 690 } };
    const r = data[args.customerId] || { score: 700, previousQuarter: 700 };
    const receipt = {
      server: "bureau",
      tool: "get_credit_score",
      argsHash: sha256Hex(canonicalJson(args)),
      resultHash: sha256Hex(canonicalJson(r)),
      issuedAt: new Date().toISOString(),
      keyId: signer.keyId,
    };
    receipt.signature = signer.sign(messages.serverReceipt(receipt));
    return {
      content: [{ type: "text", text: JSON.stringify(r) }],
      structuredContent: r,
      _meta: { [SERVER_RECEIPT_META_KEY]: receipt },
    };
  });
await server.connect(new StdioServerTransport());
