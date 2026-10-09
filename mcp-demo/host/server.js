import "dotenv/config";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { connectAll } from "./mcp-client.js";
import { startSession } from "./ledger.js";
import { withLedger } from "./gateway.js";
import { runAgent } from "./agent.js";
import { sealAndAnchor } from "./finalize.js";
import { verifySession } from "./verify.js";
import { getSession, tamperSession, restoreSession, proveRecord } from "./ops.js";
import { makeMockModel } from "./mock-model.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "ui")));

app.get("/api/session", (req, res) => res.json(getSession()));
app.post("/api/verify", async (req, res) => { try { res.json(await verifySession()); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post("/api/tamper", (req, res) => { try { res.json(tamperSession(req.body)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post("/api/restore", (req, res) => { try { restoreSession(); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post("/api/prove", (req, res) => { try { res.json(proveRecord(req.body.seq)); } catch (e) { res.status(400).json({ error: e.message }); } });

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  ws.on("message", async (msg) => {
    let cmd; try { cmd = JSON.parse(msg); } catch { return; }
    if (cmd.cmd !== "run") return;
    const send = (e) => { try { ws.send(JSON.stringify(e)); } catch {} };
    try {
      const raw = await connectAll();
      const session = startSession();
      const host = withLedger(raw, session);
      const mock = process.env.DEMO_MOCK === "1";
      send({ type: "start", mock });
      await runAgent({ host, anthropic: mock ? makeMockModel() : undefined, onEvent: send });
      const { sealed, verify: v, anchor, anchorError } = await sealAndAnchor(host, { onEvent: send });
      if (anchorError) console.error("anchoring failed: " + anchorError);
      await host.closeAll();
      send({ type: "done", sealed, verify: v, anchor, anchorError });
    } catch (e) { send({ type: "error", message: String(e.message || e) }); }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log("AgentLedger UI running at http://localhost:" + PORT));
