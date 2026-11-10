import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  async redirects() {
    return [
      { source: "/betting", destination: "/players", permanent: true },
      { source: "/fantasy", destination: "/players", permanent: true },
    ];
  },
};

export default nextConfig;
