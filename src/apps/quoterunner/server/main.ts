import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCoreContext, loadDotEnv, startJobs, startServer } from "@core/server/bootstrap";
import { loadEnv } from "@core/server/env";
import { quoteRunnerProduct } from "../shared/product";
import { buildQuoteRunnerApp } from "./app";
import { quoteRunnerMigrations } from "./migrations";
import { sendDueReminders } from "./reminders";

loadDotEnv();
const env = loadEnv(process.env, { port: 8101, dataDir: "data/quoterunner" });
const ctx = createCoreContext({ env, product: quoteRunnerProduct, migrations: quoteRunnerMigrations });

// The production bundle lives next to its built web app (dist/quoterunner/server.mjs + web/).
const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, "web");
const app = buildQuoteRunnerApp(ctx, existsSync(join(webDir, "app.html")) ? webDir : null);

const stopJobs = startJobs(ctx, [{ name: "supplier reminders", everyMs: 10 * 60_000, run: (c) => sendDueReminders(c).then(() => undefined) }]);
startServer(app, ctx, stopJobs);
