import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Integration tests (src/lib/attempts.test.ts) talk to the LOCAL Supabase stack.
try {
  process.loadEnvFile(".env.local");
} catch {
  // Env vars may come from the shell instead.
}

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    // Next.js provides "server-only" itself; under Vitest it resolves to an empty module.
    alias: { "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    passWithNoTests: true,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
