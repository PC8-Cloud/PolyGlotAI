import { test, expect } from "@playwright/test";
import { waitForSplash } from "./helpers";

test.describe("Stress: rapid navigation between all routes", () => {
  test("Visit all 8 routes rapidly — no crash", async ({ page }) => {
    const routes = ["/", "/conversation", "/converter", "/phrases", "/group", "/megaphone", "/room", "/join", "/plans", "/camera"];

    await page.goto("/");
    await waitForSplash(page);

    for (const route of routes) {
      await page.goto(`http://localhost:3000${route}`);
      await page.waitForTimeout(800);
      await expect(page.locator("body")).toBeVisible();
    }
  });

  test("Navigate back and forth 20 times between Home and Conversation", async ({ page }) => {
    await page.goto("/");
    await waitForSplash(page);

    for (let i = 0; i < 20; i++) {
      await page.goto("http://localhost:3000/conversation");
      await page.waitForTimeout(300);
      await page.goto("http://localhost:3000/");
      await page.waitForTimeout(300);
    }

    await expect(page.locator("body")).toBeVisible();
    // Page should still be responsive
    const bodyText = await page.textContent("body");
    expect(bodyText?.length).toBeGreaterThan(0);
  });

  test("Rapid route changes — 30 random routes in 15 seconds", async ({ page }) => {
    const routes = ["/", "/conversation", "/converter", "/phrases", "/megaphone", "/plans", "/join"];

    await page.goto("/");
    await waitForSplash(page);

    for (let i = 0; i < 30; i++) {
      const route = routes[i % routes.length];
      await page.goto(`http://localhost:3000${route}`);
      await page.waitForTimeout(200);
    }

    // App should not have crashed
    await expect(page.locator("body")).toBeVisible();
  });
});
