import { test, expect } from "@playwright/test";
import { waitForSplash } from "./helpers";

test.describe("Offline resilience", () => {
  test("App loads and shows UI even when going offline", async ({ page, context }) => {
    // First load online
    await page.goto("/");
    await waitForSplash(page);

    // Go offline
    await context.setOffline(true);
    await page.waitForTimeout(500);

    // App should not crash — UI still visible
    await expect(page.locator("body")).toBeVisible();

    // Go back online
    await context.setOffline(false);
  });
});

test.describe("PWA manifest", () => {
  test("Page loads without crash", async ({ page }) => {
    await page.goto("/");
    await waitForSplash(page);
    await expect(page.locator("body")).toBeVisible();
  });
});
