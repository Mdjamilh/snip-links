import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const unique = () => `e2e-${Math.random().toString(36).slice(2, 8)}`;

async function shorten(page: Page, url: string, slug: string) {
  await page.goto("/");
  await page.getByLabel("Long URL").fill(url);
  await page.locator('input[name="slug"]').fill(slug);
  await page.getByRole("button", { name: "Shorten" }).click();
  await expect(page.getByText("Save your private stats link")).toBeVisible();
  return {
    short: (await page.locator(".short a").getAttribute("href")) ?? "",
    manage: (await page.locator(".notice a").getAttribute("href")) ?? "",
  };
}

test("shorten a link, follow it, and see the click in private stats", async ({ page, browser }) => {
  const slug = unique();
  const { short, manage } = await shorten(page, "https://example.com/e2e", slug);
  expect(short).toMatch(new RegExp(`/${slug}$`));
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();

  // A real visitor (not the headless default user agent, which counts as a bot).
  const visitor = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36" });
  const tab = await visitor.newPage();
  await tab.route("https://example.com/**", (route) => route.fulfill({ body: "landed" }));
  await tab.goto(short);
  await expect(tab).toHaveURL("https://example.com/e2e");
  await visitor.close();

  await page.goto(manage);
  await expect(page.locator(".stat b").first()).toHaveText("1");
  await expect(page.getByRole("cell", { name: "Chrome" })).toBeVisible();
});

test("errors keep what was typed", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Long URL").fill("javascript:alert(1)");
  await page.locator('input[name="slug"]').fill("my-name");
  await page.getByRole("button", { name: "Shorten" }).click();
  await expect(page.getByRole("alert")).toHaveText("Only http and https links can be shortened");
  await expect(page.locator('input[name="slug"]')).toHaveValue("my-name");
});

test("owners can turn a link off and delete it", async ({ page }) => {
  const { short, manage } = await shorten(page, "https://example.com/owned", unique());
  await page.goto(manage);
  await page.getByRole("button", { name: "Turn the link off" }).click();
  await expect(page.getByText("Disabled")).toBeVisible();
  expect((await page.request.get(short, { maxRedirects: 0 })).status()).toBe(410);

  page.on("dialog", (dialog) => dialog.accept()); // the confirm() when JS is on
  await page.getByRole("button", { name: "Delete link" }).click();
  await expect(page.getByRole("heading", { name: "Link deleted" })).toBeVisible();
  expect((await page.request.get(short, { maxRedirects: 0 })).status()).toBe(404);
});

test("pages have no detectable accessibility violations", async ({ page, javaScriptEnabled }) => {
  test.skip(!javaScriptEnabled, "axe runs as JavaScript in the page");
  const { manage } = await shorten(page, "https://example.com/a11y", unique());
  for (const path of ["/", manage, "/does-not-exist"]) {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.map((v) => `${path} ${v.id}`)).toEqual([]);
  }
});
