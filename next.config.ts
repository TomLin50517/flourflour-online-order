import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const storageUrl = process.env.STORAGE_PUBLIC_BASE_URL
  ? new URL(process.env.STORAGE_PUBLIC_BASE_URL)
  : undefined;

const nextConfig: NextConfig = {
  images: {
    remotePatterns: storageUrl
      ? [
          {
            protocol: storageUrl.protocol.replace(":", "") as "http" | "https",
            hostname: storageUrl.hostname,
            port: storageUrl.port,
            pathname: `${storageUrl.pathname}/**`,
          },
        ]
      : [],
  },
};

export default withNextIntl(nextConfig);
