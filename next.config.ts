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
    // 見 SPEC.md §12.2：上傳的圖片已在 /api/v1/admin/uploads 統一轉為最長邊 1200px
    // 的 webp（見 src/lib/image-processing.ts），故拿掉預設 deviceSizes 裡超過
    // 1200 的斷點（1920/2048/3840）——來源本來就沒那麼大，Next 也不會放大圖片，
    // 保留那些斷點只是白白多產生用不到的圖片變體。
    deviceSizes: [640, 750, 828, 1080, 1200],
  },
};

export default withNextIntl(nextConfig);
