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
  // No page may be framed by another site (clickjacking on the exam or staff pages), plus the
  // usual baseline headers. A full script CSP is left for later (Next inline scripts need nonces).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
        ],
      },
    ];
  },
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
