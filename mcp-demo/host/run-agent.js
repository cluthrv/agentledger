import { runAgent } from "./agent.js";
console.log("Running the credit agent (live Claude). It chooses the tools itself.\n");
await runAgent();
console.log("\nAgent run complete.");
process.exit(0);
