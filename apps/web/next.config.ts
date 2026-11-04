import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@sched/shared"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The browser only ever talks to this origin; /api/* is proxied to the Fastify API so
  // session cookies stay first-party. In production a reverse proxy does the same job.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
  async redirects() {
    return [{ source: "/", destination: "/calendar", permanent: false }];
  },
};

export default nextConfig;
