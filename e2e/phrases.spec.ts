import { test, expect } from "@playwright/test";
import { waitForSplash } from "./helpers";

test.describe("Phrases page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/phrases");
    await waitForSplash(page);
  });

  test("Page renders with content", async ({ page }) => {
    const bodyText = await page.textContent("body");
    expect(bodyText?.length).toBeGreaterThan(10);
  });

  test("Has clickable elements (categories or phrases)", async ({ page }) => {
    const clickable = page.locator("button, div[role='button'], a");
    const count = await clickable.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
