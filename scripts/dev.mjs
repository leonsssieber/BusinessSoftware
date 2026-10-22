// Runs one product in development: the API server (restarts when server code changes) and the
// Vite dev server with hot reload. Open the web URL; Vite forwards /api to the server.
//
//   npm run dev -- quoterunner
import { spawn } from "node:child_process";
import { createServer } from "vite";
import { APPS, appFromArgs } from "./apps.mjs";

const app = appFromArgs("dev");
const ports = APPS[app];
const webUrl = `http://localhost:${ports.web}`;

const api = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "watch", "--clear-screen=false", `src/apps/${app}/server/main.ts`],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(ports.api),
      // Links in emails (supplier portals, invites) should open the Vite server, which serves the app.
      APP_URL: process.env.APP_URL ?? webUrl,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--disable-warning=ExperimentalWarning"].filter(Boolean).join(" "),
    },
  },
);

const web = await createServer({ configFile: `src/apps/${app}/vite.config.ts` });
await web.listen();
web.printUrls();

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  api.kill("SIGTERM");
  web.close().finally(() => process.exit(code));
}
api.on("exit", (code) => {
  if (!stopping) {
    console.error(`API server exited (${code}).`);
    stop(code ?? 1);
  }
});
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
