import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse uses pdf.js, which must load from node_modules
  // directly rather than being bundled by Next.js.
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;