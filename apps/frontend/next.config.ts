import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // Page route /s/[slug] would catch fetch('/s/:slug') and return HTML.
    // Proxy API under /api/s so requests don't hit the page route.
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (apiUrl) return [];
    const backend = process.env.API_URL ?? "http://localhost:3000";
    return [
      { source: "/api/s", destination: `${backend}/s` },
      { source: "/api/s/:path*", destination: `${backend}/s/:path*` },
    ];
  },
};

export default nextConfig;
