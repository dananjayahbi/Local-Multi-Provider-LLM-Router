import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-libsql"],
  experimental: {
    useTypeScriptCli: true,
  },
};

export default nextConfig;
