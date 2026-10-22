// Production build. For each product: the web app with Vite (dist/<app>/web) and the server as one
// ES module with esbuild (dist/<app>/server.mjs). npm packages stay external, so run the build next
// to an installed node_modules (the Dockerfile does this).
//
//   npm run build                  all products
//   npm run build -- quoterunner   one product
import { build as bundle } from "esbuild";
import { build as viteBuild } from "vite";
import { appFromArgs, availableApps } from "./apps.mjs";

const one = appFromArgs("build", { optional: true });
const apps = one ? [one] : availableApps();

for (const app of apps) {
  const started = Date.now();
  await viteBuild({ configFile: `src/apps/${app}/vite.config.ts`, logLevel: "warn" });
  await bundle({
    entryPoints: [`src/apps/${app}/server/main.ts`],
    outfile: `dist/${app}/server.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
    sourcemap: "linked",
    tsconfig: "tsconfig.json",
    // A built server is a production server unless told otherwise. This keeps the plan switch
    // that exists for local testing (POST /api/billing/dev-plan) off when NODE_ENV is forgotten.
    banner: { js: 'process.env.NODE_ENV ||= "production";' },
    logLevel: "warning",
  });
  console.log(`built ${app} in ${((Date.now() - started) / 1000).toFixed(1)}s -> dist/${app}/`);
}
