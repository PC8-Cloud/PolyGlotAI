import { test, expect } from "@playwright/test";
import { waitForSplash } from "./helpers";

test.describe("Stress: network disruption cycles", () => {
  test("Toggle online/offline 20 times while navigating", async ({ page, context }) => {
    await page.goto("/");
    await waitForSplash(page);

    const routes = ["/converter", "/phrases", "/conversation", "/plans"];

    for (let i = 0; i < 20; i++) {
      // Go offline
      await context.setOffline(true);
      await page.waitForTimeout(200);

      // Navigate while offline
      await page.goto(`http://localhost:3000${routes[i % routes.length]}`).catch(() => {});
      await page.waitForTimeout(200);

      // Go online
      await context.setOffline(false);
      await page.waitForTimeout(300);
    }

    // Recover — go online and navigate
    await context.setOffline(false);
    await page.goto("/");
    await waitForSplash(page);
    await expect(page.locator("body")).toBeVisible();
  });

  test("Load page → go offline → wait → go online — no crash", async ({ page, context }) => {
    await page.goto("/converter");
    await waitForSplash(page);

    // Go offline
    await context.setOffline(true);
    await page.waitForTimeout(2000);

    // Page should still be visible while offline
    await expect(page.locator("body")).toBeVisible();

    // Go back online
    await context.setOffline(false);
    await page.waitForTimeout(1000);

    await expect(page.locator("body")).toBeVisible();
    const bodyText = await page.textContent("body");
    expect(bodyText?.length).toBeGreaterThan(10);
  });
});
