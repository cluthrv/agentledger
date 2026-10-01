import fs from "node:fs";
const S = "data/sessions/session.json", B = "data/sessions/session.backup.json";
if (!fs.existsSync(B)) { console.error("No backup found. Run the agent (npm run record) to create a fresh session."); process.exit(1); }
fs.copyFileSync(B, S);
console.log("Restored session.json from backup. Ready to run the tamper demo again.");
