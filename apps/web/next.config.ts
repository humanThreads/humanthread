import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const configuredDevOrigins = (process.env.HUMANTHREAD_DEV_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const localDevOrigins = Object.values(networkInterfaces()).flatMap((addresses) => (
  (addresses ?? []).flatMap((address) => address.family === "IPv4" && !address.internal ? [address.address] : [])
));
const allowedDevOrigins = [...new Set([...configuredDevOrigins, ...localDevOrigins])];

export const CLIENT_BUNDLE_PROTECTION_NOTE =
  "客户端代码混淆和移除 sourcemap 只是防御加固，不能替代服务端鉴权、权限校验和敏感逻辑后置。";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: join(currentDirectory, "../../"),
  allowedDevOrigins,
  productionBrowserSourceMaps: false,
  compiler: {
    removeConsole: true,
  },
  async headers() {
    return [
      {
        source: "/uploads/avatars/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
