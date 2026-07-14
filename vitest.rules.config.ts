import { defineConfig } from "vitest/config";

// Firestore security-rules tests. These run against the Firestore emulator,
// not jsdom, so they use their own config (no localStorage/DOM setup).
// Run via `npm run test:rules`, which boots the emulator first.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/rules/**/*.test.ts"],
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
