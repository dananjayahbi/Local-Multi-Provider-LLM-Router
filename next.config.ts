import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-libsql"],
  experimental: {
    useTypeScriptCli: true,
  },
};

export default nextConfig;
