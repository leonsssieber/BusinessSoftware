import { expect, test, type Browser, type Page } from "@playwright/test";
import { shot, signUp, watchConsole } from "./helpers";

const LIST = `200' 3/4 EMT
50 3/4 EMT set screw connectors
(20) 4x4 boxes w/ mud rings
12/2 Romex - 3 rolls`;

const SUPPLIERS = `Name,Email,Contact,Phone
Northside Electric Supply,quotes@northside.example,Marco Diaz,555-0101
Valley Wholesale,sales@valley.example,Priya Shah,555-0102
Metro Electric,desk@metro.example,Sam Ortiz,555-0103`;

/** Unexpected browser errors. A signed-out visitor's session check answers 401 on purpose. */
function realProblems(problems: string[]) {
  return problems.filter((p) => !/status of 401/.test(p));
}

/** Opens a supplier's quote link on a phone-sized screen, as most suppliers will. */
async function supplierPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  return context.newPage();
}

test("buyer requests quotes, suppliers answer, buyer compares and awards", async ({ page, browser }) => {
  const problems = watchConsole(page);

  // Landing page sells the idea and leads to sign-up.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shot(page, "quoterunner-landing");
  await page.getByRole("link", { name: "Start free" }).first().click();
  await expect(page).toHaveURL(/\/signup/);

  await signUp(page, { name: "Dana Reyes", company: "Reyes Electric", email: "dana@reyes.example" });
  await expect(page.getByText("Get your first quotes in today")).toBeVisible();

  // Suppliers: import three from a spreadsheet paste.
  await page.getByRole("link", { name: "Suppliers" }).first().click();
  await page.getByRole("button", { name: "Import" }).first().click();
  await page.getByLabel("Supplier rows").fill(SUPPLIERS);
  await page.getByRole("dialog").getByRole("button", { name: "Import" }).click();
  await expect(page.getByText("Imported 3 suppliers")).toBeVisible();
  await expect(page.getByRole("cell", { name: /^Valley Wholesale/ })).toBeVisible();

  // New request from a pasted material list.
  await page.goto("/app/requests/new");
  await page.getByLabel("Title").fill("Unit 4 rough-in material");
  await page.getByLabel("Job name").fill("Maple St apartments");
  await page.getByLabel("Paste a material list").fill(LIST);
  await page.getByRole("button", { name: "Read list" }).click();
  await expect(page.getByLabel("Description, line 4")).toHaveValue(/Romex/);
  await expect(page.getByLabel("Quantity, line 1")).toHaveValue("200");
  await shot(page, "quoterunner-new-request", { fullPage: true });
  await page.getByRole("button", { name: "Save and choose suppliers" }).click();
  await expect(page).toHaveURL(/\/app\/requests\/[^/?]+\?tab=suppliers/);
  const rfqId = new URL(page.url()).pathname.split("/").pop()!;

  // Invite all three and send.
  await page.getByRole("button", { name: "Add suppliers" }).first().click();
  const picker = page.getByRole("dialog");
  for (const name of ["Northside Electric Supply", "Valley Wholesale", "Metro Electric"]) await picker.getByLabel(name).check();
  await picker.getByRole("button", { name: "Add 3 suppliers" }).click();
  await page.getByRole("button", { name: "Send to 3" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Emailed 3 suppliers.")).toBeVisible();

  // Each supplier got a personal quote link (and an email with it).
  const detail = await (await page.request.get(`/api/rfqs/${rfqId}`)).json();
  const link = (name: string) => detail.invitations.find((i: { supplierName: string }) => i.supplierName === name).portalUrl as string;
  const outbox = await (await page.request.get("/api/dev/outbox")).json();
  expect(outbox.filter((m: { subject: string }) => /RFQ-0001/.test(m.subject))).toHaveLength(3);

  // Northside: everything from stock, free delivery.
  const northside = await supplierPage(browser);
  await northside.goto(link("Northside Electric Supply"));
  await expect(northside.getByText("Reyes Electric").first()).toBeVisible();
  const prices = { "3/4 EMT": "0.62", "3/4 EMT set screw connectors": "0.48", "4x4 boxes w/ mud rings": "3.10", "12/2 Romex": "89.00" };
  for (const [item, price] of Object.entries(prices)) {
    await northside.getByLabel(`Unit price for ${item}`, { exact: true }).fill(price);
    await northside.getByLabel(`Lead time in days for ${item}`, { exact: true }).fill("0");
  }
  await northside.getByLabel("Your name").fill("Marco Diaz");
  await northside.evaluate(() => window.scrollTo(0, 0));
  await shot(northside, "quoterunner-supplier-portal-phone");
  await northside.getByRole("button", { name: "Send quote" }).click();
  await expect(northside.getByText("Reyes Electric has your prices")).toBeVisible();
  await northside.context().close();

  // Valley: cheaper pipe and boxes, pricier wire, charges freight.
  const valley = await supplierPage(browser);
  await valley.goto(link("Valley Wholesale"));
  const valleyPrices = { "3/4 EMT": "0.49", "3/4 EMT set screw connectors": "0.52", "4x4 boxes w/ mud rings": "2.40", "12/2 Romex": "96.50" };
  for (const [item, price] of Object.entries(valleyPrices)) {
    await valley.getByLabel(`Unit price for ${item}`, { exact: true }).fill(price);
    await valley.getByLabel(`Lead time in days for ${item}`, { exact: true }).fill("2");
  }
  await valley.getByLabel("Freight / delivery charge").fill("15");
  await valley.getByRole("button", { name: "Send quote" }).click();
  await expect(valley.getByText("Reyes Electric has your prices")).toBeVisible();
  await valley.context().close();

  // Metro passes.
  const metro = await supplierPage(browser);
  await metro.goto(link("Metro Electric"));
  await metro.getByRole("button", { name: "Can't quote this one?" }).click();
  await metro.getByLabel(/Can't quote this one/).fill("No 12/2 in stock this month");
  await metro.getByRole("button", { name: "Decline to quote" }).click();
  await expect(metro.getByText("You declined this request")).toBeVisible();
  await metro.context().close();

  // Buyer compares. Best split: Valley for pipe and boxes, Northside for connectors and wire.
  await page.goto(`/app/requests/${rfqId}?tab=compare`);
  await expect(page.getByRole("button", { name: /^Best single supplier/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Cheapest way to buy/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Award and create POs/ })).toBeEnabled();
  await shot(page, "quoterunner-compare");
  await page.getByRole("button", { name: /Award and create POs/ }).click();
  await expect(page.getByText(/Awarded/).first()).toBeVisible();
  await expect(page).toHaveURL(/tab=orders/);

  // Two purchase orders, one per winning supplier.
  const orders = await (await page.request.get("/api/orders")).json();
  expect(orders).toHaveLength(2);
  await page.goto(`/app/orders/${orders[0].id}`);
  await expect(page.getByText(/PO-000\d/).first()).toBeVisible();
  await shot(page, "quoterunner-purchase-order", { fullPage: true });

  // Overview shows the money saved against the average quote.
  await page.goto("/app");
  await expect(page.getByText(/saved/i).first()).toBeVisible();
  await shot(page, "quoterunner-dashboard");

  expect(realProblems(problems)).toEqual([]);
});

test("free material list cleaner works without an account", async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto("/tools/rfq-builder");
  await expect(page.getByRole("heading", { name: "Material list cleaner" })).toBeVisible();
  await page.getByLabel("Your list").fill("40 sheets 3/4 CDX plywood\n25 Square D breaker part # QO120\nsome wire nuts");
  await expect(page.getByText("3 lines")).toBeVisible();
  await expect(page.getByRole("cell", { name: "QO120" })).toBeVisible();
  await expect(page.getByText(/check 1 highlighted/)).toBeVisible();
  await shot(page, "quoterunner-free-tool");
  expect(realProblems(problems)).toEqual([]);
});

test("signed-out visitors are sent to sign in and come back", async ({ page }) => {
  await page.goto("/app/suppliers");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
