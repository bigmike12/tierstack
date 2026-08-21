import { loadRootEnv } from "@tierbase/shared";

// Load the monorepo .env before anything reads process.env.
loadRootEnv();

import { buildServer } from "./server";

async function main(): Promise<void> {
  const { app, config } = await buildServer();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(
    { api: config.API_URL, environment: config.BILLING_ENV },
    `${config.APP_NAME} API listening`
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
