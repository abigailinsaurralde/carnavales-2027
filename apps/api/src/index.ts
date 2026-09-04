import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { createApp } from "./server.js";

function main(): void {
  const config = loadConfig();
  const db = createPool(config.databaseUrl);
  const app = createApp(config, db);

  app.server.listen(config.port, () => {
    console.log(`[api] Server listening on port ${config.port} (${config.nodeEnv})`);
  });

  const shutdown = async (): Promise<void> => {
    console.log("[api] Shutting down...");
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main();
