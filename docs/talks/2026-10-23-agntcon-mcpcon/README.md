# Prove What Your Agent Did: Tamper-evident audit trails for MCP tool calls

Talk by Vikas Luthra at **AGNTCon + MCPCon North America**, Friday, October 23, 2026, 4:35 PM, room LL20 AB.

Slides: [AGNTCon-MCPCon-NA-2026-Prove-What-Your-Agent-Did-Vikas-Luthra.pdf](AGNTCon-MCPCon-NA-2026-Prove-What-Your-Agent-Did-Vikas-Luthra.pdf)

## Anchored with AgentLedger

The SHA-256 of the slides was anchored on Arbitrum Sepolia, a public test network, with this project's AnchorRegistry contract. Only the hash went on chain.

| | |
| --- | --- |
| SHA-256 | `a6b3f64f71441c0c95a67d88a5bbe865f4cc73eea06cdf74cbffcaca87b2de5a` |
| Contract | `0xB07eB96033eE808928aFE66eFbE82c2F90AF9D63` |
| Anchorer | `0x2f5ab2b229c45017fEF9C8e6a136453F32cc546A` |
| Slot id | `a6b3f64f-7144-1c0c-95a6-7d88a5bbe865` (first 16 bytes of the SHA-256) |
| Block | 321864447 |
| Block time | 2026-10-22T22:49:12Z |
| Transaction | [`0x381f1f21…57784aa91`](https://sepolia.arbiscan.io/tx/0x381f1f21ca88186dff70d2475731e625687b021939b2b1e909db83a57784aa91) |

## Check it yourself

1. Hash the PDF: `sha256sum AGNTCon-MCPCon-NA-2026-Prove-What-Your-Agent-Did-Vikas-Luthra.pdf` (or `Get-FileHash` in PowerShell). It must equal the SHA-256 above.
2. Open the transaction on Arbiscan. It calls `anchor(sessionId, root)` from the anchorer address above, with `root` equal to that SHA-256.
3. Or read the contract directly: `anchors(0x2f5ab2b229c45017fEF9C8e6a136453F32cc546A, 0x00000000000000000000000000000000a6b3f64f71441c0c95a67d88a5bbe865)` returns the root and the block time.
4. Or, from `mcp-demo/` with the RPC and contract configured: `node host/anchor-file.js --check <path to the PDF>`.

The anchor shows the file existed no later than the block time above. It says nothing about who wrote it, only that this exact file's hash was committed then.
