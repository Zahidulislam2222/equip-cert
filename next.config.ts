import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",  // <--- Crucial for Capacitor
  images: {
    unoptimized: true, // <--- Required for mobile apps
  },
};

export default nextConfig;