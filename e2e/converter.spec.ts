import { test, expect } from "@playwright/test";
import { waitForSplash } from "./helpers";

test.describe("Converter page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/converter");
    await waitForSplash(page);
  });

  test("Page renders without crash", async ({ page }) => {
    await expect(page.locator("body")).toBeVisible();
    // Should not still be showing splash
    const bodyText = await page.textContent("body");
    expect(bodyText?.length).toBeGreaterThan(10);
  });

  test("Has interactive input elements", async ({ page }) => {
    const inputs = page.locator("input, select, button");
    const count = await inputs.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
