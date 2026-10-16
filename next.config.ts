import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets tests build/run in a separate folder without clobbering a running `next dev` (.next).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  /* config options here */
  cacheComponents: true,
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
