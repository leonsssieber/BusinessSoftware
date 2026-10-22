import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against the production build (npm run build first), one server per
// product on its own port with a throwaway database. NODE_ENV=test turns off rate limits and
// keeps the plan switch available so paid features can be exercised without Stripe.
const products = [{ app: "quoterunner", port: 9101 }];

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1360, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: products.map(({ app, port }) => ({
    name: app,
    testMatch: new RegExp(`${app}\\.spec\\.ts$`),
    use: { baseURL: `http://localhost:${port}` },
  })),
  webServer: products.map(({ app, port }) => ({
    command: `node --disable-warning=ExperimentalWarning dist/${app}/server.mjs`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV: "test",
      PORT: String(port),
      APP_URL: `http://localhost:${port}`,
      DATA_DIR: mkdtempSync(join(tmpdir(), `${app}-e2e-`)),
      ANTHROPIC_API_KEY: "",
      STRIPE_SECRET_KEY: "",
      RESEND_API_KEY: "",
    },
  })),
});
