import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { expect, type Page } from "@playwright/test";

/**
 * Saves a screenshot to docs/screenshots when SCREENSHOTS=1, so the images in the docs can be
 * refreshed with `SCREENSHOTS=1 npm run e2e`. Normal runs leave the committed images alone.
 */
export async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  if (process.env.SCREENSHOTS !== "1") return;
  const path = `docs/screenshots/${name}.png`;
  mkdirSync(dirname(path), { recursive: true });
  // Let fonts and any entering animation settle so the image matches what people see.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path, fullPage: opts.fullPage ?? false, animations: "disabled" });
}

export async function signUp(page: Page, user: { name: string; company: string; email: string; password?: string }) {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill(user.name);
  await page.getByLabel(/company/i).fill(user.company);
  await page.getByLabel("Work email").fill(user.email);
  await page.getByLabel("Password").fill(user.password ?? "correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app\/?$/);
}

/** Fails the test on uncaught page errors and console errors, which tests otherwise miss. */
export function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
  });
  return problems;
}
