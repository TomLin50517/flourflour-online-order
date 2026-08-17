import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const storageUrl = process.env.STORAGE_PUBLIC_BASE_URL
  ? new URL(process.env.STORAGE_PUBLIC_BASE_URL)
  : undefined;

// 見 docs/OPEN-QUESTIONS.md：原本在 middleware（src/proxy.ts）統一設定的安全標頭，
// 改到這裡——這幾個標頭都是靜態值（不依請求內容動態決定，`isProduction` 在
// build time 就固定），天生適合宣告式設定，不需要 middleware。
// CSP 對 script-src/style-src 使用 'unsafe-inline'：App Router 的 hydration/RSC
// 內嵌 script、以及本專案手刻圖表元件（TrendChart/TopProductsChart）用到的
// React inline style prop，都需要它；要收緊成 nonce-based CSP 需要另外設計
// nonce 產生與透傳機制，列為未來加強項。
const storageOrigin = (() => {
  try {
    return process.env.STORAGE_PUBLIC_BASE_URL ? new URL(process.env.STORAGE_PUBLIC_BASE_URL).origin : null;
  } catch {
    return null;
  }
})();

// React/Next.js 開發模式的 Fast Refresh 會用到 eval()（正式環境不會，React 官方
// 文件本身也這麼說明），故 'unsafe-eval' 只在非正式環境放行。
const isProduction = process.env.NODE_ENV === "production";

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${storageOrigin ? ` ${storageOrigin}` : ""}`,
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // 見 docs/OPEN-QUESTIONS.md：`pg`（Drizzle 走 Hyperdrive 用的底層驅動，見
  // src/db/client.ts 的 drizzle-orm/node-postgres）內部依賴 `pg-cloudflare`，
  // 這個套件用 conditional exports 依 runtime（`workerd` vs `default`）切換實作。
  // Next.js 打包 server 端程式碼時預設用 Node.js condition 去追蹤依賴檔案，只會
  // 複製到 `default` 分支對應的檔案，導致 `opennextjs-cloudflare build` 階段找不到
  // `workerd` 分支需要的檔案而炸掉（`Could not resolve "pg-cloudflare"`）。這是
  // OpenNext 官方文件記載的已知問題（見 troubleshooting → workerd-specific
  // packages howto），解法是把這些套件標成 external，不讓 Next.js 嘗試打包／
  // 追蹤它們的內部依賴，交給 runtime 自己正確解析 conditional exports。
  serverExternalPackages: ["pg", "pg-cloudflare"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // 瀏覽器只會信任經 HTTPS 送出的 HSTS 標頭，本機 HTTP 開發環境送這個標頭無害。
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
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
