import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  // `next build` emits a static site in out/, which the FastAPI backend serves at "/"
  ...(isDev ? {} : { output: "export" as const }),
  images: { unoptimized: true },
  // In dev, forward /api/* to the FastAPI server so the UI uses the same paths as production
  ...(isDev
    ? {
        async rewrites() {
          return [{ source: "/api/:path*", destination: `${backendUrl}/:path*` }];
        },
      }
    : {}),
};

export default nextConfig;
