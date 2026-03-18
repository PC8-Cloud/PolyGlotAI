import { test, expect } from "@playwright/test";
import { waitForSplash, setupStore } from "./helpers";

test.describe("Room - multi-tab simulation", () => {
  test("Room host page loads", async ({ page }) => {
    await setupStore(page, {
      plan: "pro",
      planExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    await page.goto("/room");
    await waitForSplash(page);
    await expect(page.locator("body")).toBeVisible();
    const bodyText = await page.textContent("body");
    expect(bodyText?.length).toBeGreaterThan(10);
  });

  test("Room join page loads with input", async ({ page }) => {
    await page.goto("/join");
    await waitForSplash(page);
    await expect(page.locator("body")).toBeVisible();
    // Check for any interactive elements (input or buttons)
    const interactive = page.locator("input, button");
    expect(await interactive.count()).toBeGreaterThanOrEqual(1);
  });

  test("Multi-tab: host and client load simultaneously", async ({ browser }) => {
    const context = await browser.newContext();

    await context.addInitScript(() => {
      const store = JSON.parse(localStorage.getItem("polyglot-user-storage") || '{"state":{},"version":0}');
      store.state = {
        ...store.state,
        openaiApiKey: "sk-test-e2e",
        plan: "pro",
        planExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
      localStorage.setItem("polyglot-user-storage", JSON.stringify(store));
    });

    const hostPage = await context.newPage();
    const clientPage = await context.newPage();

    await Promise.all([
      hostPage.goto("http://localhost:3000/room"),
      clientPage.goto("http://localhost:3000/join"),
    ]);

    // Wait for splash on both
    await Promise.all([
      hostPage.waitForTimeout(4000),
      clientPage.waitForTimeout(4000),
    ]);

    await expect(hostPage.locator("body")).toBeVisible();
    await expect(clientPage.locator("body")).toBeVisible();

    await context.close();
  });
});
