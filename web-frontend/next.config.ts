import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  output: "standalone",
};

if (process.env.NODE_ENV === "development") {
  nextConfig.allowedDevOrigins = ["127.0.0.1"];
  nextConfig.rewrites = async () => [
    {
      source: "/api/v1/:path*",
      destination: `${process.env.USER_API_ORIGIN ?? "http://localhost:8000"}/api/v1/:path*`,
    },
    {
      source: "/static/:path*",
      destination: `${process.env.USER_API_ORIGIN ?? "http://localhost:8000"}/static/:path*`,
    },
  ];
}

export default nextConfig;
