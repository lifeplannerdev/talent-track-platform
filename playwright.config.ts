import { defineConfig, devices } from "@playwright/test";

// The e2e suite runs against the LOCAL Supabase stack (npm run db:start).
try {
  process.loadEnvFile(".env.local");
} catch {
  // Env vars may come from the shell instead.
}

export default defineConfig({
  testDir: "./e2e",
  // Tests share seeded users and single-session rules, so run them one at a time.
  workers: 1,
  fullyParallel: false,
  use: { baseURL: "http://localhost:3000" },
  projects: [
    { name: "mobile-375", use: { ...devices["Pixel 5"], viewport: { width: 375, height: 812 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
  },
});
