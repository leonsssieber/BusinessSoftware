import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Every product in this repository with its development ports (web = Vite, api = server). */
export const APPS = {
  quoterunner: { web: 5101, api: 8101 },
  drydocs: { web: 5102, api: 8102 },
  agentfit: { web: 5103, api: 8103 },
};

/** Scripts run from the repository root, whatever directory npm was started in. */
process.chdir(fileURLToPath(new URL("..", import.meta.url)));

export function availableApps() {
  return Object.keys(APPS).filter((app) => existsSync(`src/apps/${app}/vite.config.ts`));
}

/** The product named on the command line. Exits with usage help when it is missing or unknown. */
export function appFromArgs(script, { optional = false } = {}) {
  const name = process.argv[2];
  if (!name && optional) return null;
  if (!name || !availableApps().includes(name)) {
    console.error(`Usage: npm run ${script} -- <app>\nApps: ${availableApps().join(", ")}`);
    process.exit(1);
  }
  return name;
}
