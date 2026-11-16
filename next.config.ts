import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The dev-mode badge would cover content in the design-review screenshots.
  devIndicators: false,
  experimental: {
    // CSV imports go through Server Actions as JSON (escaping can double a file); the caps are
    // 2 MB (questions) and 1 MB (students), see src/lib/csv/limits.ts.
    serverActions: { bodySizeLimit: "5mb" },
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
