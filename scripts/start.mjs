// Starts a built product: npm run start -- quoterunner (after npm run build).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appFromArgs } from "./apps.mjs";

const app = appFromArgs("start");
const entry = `dist/${app}/server.mjs`;
if (!existsSync(entry)) {
  console.error(`${entry} is missing. Build it first: npm run build -- ${app}`);
  process.exit(1);
}

const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--enable-source-maps", entry], { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
