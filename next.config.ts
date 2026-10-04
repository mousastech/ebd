import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // fotos, logotipo e materiais da biblioteca são enviados por formulários (server actions)
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
};

export default config;
