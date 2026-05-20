import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export — NO server needed! Electron loads files directly.
  output: "export",
  
  // Disable image optimization (not available in static export)
  images: {
    unoptimized: true,
  },
  
  // Trailing slashes for static file serving
  trailingSlash: true,
  
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: [
    ".space-z.ai",
    ".z.ai",
    "localhost",
  ],
};

export default nextConfig;
