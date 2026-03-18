import { test, expect } from "@playwright/test";

test.describe("Stress: multiple tabs simultaneously", () => {
  test("Open 10 tabs on different routes — all survive", async ({ browser }) => {
    const context = await browser.newContext();

    await context.addInitScript(() => {
      const store = JSON.parse(localStorage.getItem("polyglot-user-storage") || '{"state":{},"version":0}');
      store.state = {
        ...store.state,
        openaiApiKey: "sk-test-stress",
        plan: "pro",
        planExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
      localStorage.setItem("polyglot-user-storage", JSON.stringify(store));
    });

    const routes = ["/", "/conversation", "/converter", "/phrases", "/megaphone",
                    "/plans", "/join", "/room", "/group", "/camera"];

    const pages = await Promise.all(
      routes.map(() => context.newPage())
    );

    // Navigate all tabs in parallel
    await Promise.all(
      pages.map((page, i) => page.goto(`http://localhost:3000${routes[i]}`))
    );

    // Wait for splash on all
    await Promise.all(pages.map(p => p.waitForTimeout(4000)));

    // Verify all are alive
    for (const page of pages) {
      await expect(page.locator("body")).toBeVisible();
    }

    await context.close();
  });

  test("5 room hosts + 5 room clients — all load", async ({ browser }) => {
    const context = await browser.newContext();

    await context.addInitScript(() => {
      const store = JSON.parse(localStorage.getItem("polyglot-user-storage") || '{"state":{},"version":0}');
      store.state = {
        ...store.state,
        openaiApiKey: "sk-test-stress",
        plan: "business",
        planExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
      localStorage.setItem("polyglot-user-storage", JSON.stringify(store));
    });

    const hostPages = await Promise.all(Array.from({ length: 5 }, () => context.newPage()));
    const clientPages = await Promise.all(Array.from({ length: 5 }, () => context.newPage()));

    // Navigate all in parallel
    await Promise.all([
      ...hostPages.map(p => p.goto("http://localhost:3000/room")),
      ...clientPages.map(p => p.goto("http://localhost:3000/join")),
    ]);

    await Promise.all([
      ...hostPages.map(p => p.waitForTimeout(4000)),
      ...clientPages.map(p => p.waitForTimeout(4000)),
    ]);

    // All should be alive
    for (const page of [...hostPages, ...clientPages]) {
      await expect(page.locator("body")).toBeVisible();
    }

    await context.close();
  });
});

test.describe("Stress: rapid page refresh", () => {
  test("Reload same page 20 times rapidly", async ({ page }) => {
    await page.goto("/converter");
    await page.waitForTimeout(3500);

    for (let i = 0; i < 20; i++) {
      await page.reload();
      await page.waitForTimeout(500);
    }

    // Should still work after 20 reloads
    await page.waitForTimeout(3000);
    await expect(page.locator("body")).toBeVisible();
    const bodyText = await page.textContent("body");
    expect(bodyText?.length).toBeGreaterThan(10);
  });
});
