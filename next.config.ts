import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

// 見 docs/OPEN-QUESTIONS.md：本機開發資料庫刻意與正式站共用（.env 的 DATABASE_URL
// 直接指向正式 Supabase），所以本機也看得到透過正式站 R2 上傳的圖片網址，不是只有
// 本機 MinIO 的網址。`STORAGE_PUBLIC_BASE_URL` 在本機是 MinIO、在 .env.production
// 是 R2，只允許其中一個會導致「本機看得到 DB 裡的商品，但另一邊上傳的圖顯示不出來」
// （next/image 對未列在 remotePatterns 的網域直接拋錯，整個頁面連帶壞掉）。故非正式
// 環境時，兩個網域都放行；正式環境維持只認 STORAGE_PUBLIC_BASE_URL 一個，不多開放。
// React/Next.js 開發模式的 Fast Refresh 會用到 eval()（正式環境不會，React 官方
// 文件本身也這麼說明），故 'unsafe-eval' 只在非正式環境放行；同一個旗標也用來
// 判斷是否要多開放 R2 網域（見下方 storageUrls 的說明）。
const isProduction = process.env.NODE_ENV === "production";
const KNOWN_R2_PUBLIC_URL = "https://pub-543f4d9f25744e518bf1a30f894b8ad1.r2.dev";

const storageUrls = [
  process.env.STORAGE_PUBLIC_BASE_URL,
  ...(isProduction ? [] : [KNOWN_R2_PUBLIC_URL]),
]
  .filter((value): value is string => Boolean(value))
  .map((value) => {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  })
  .filter((value): value is URL => value !== null)
  .filter((value, index, all) => all.findIndex((v) => v.origin === value.origin) === index);

// 見 docs/OPEN-QUESTIONS.md：原本在 middleware（src/proxy.ts）統一設定的安全標頭，
// 改到這裡——這幾個標頭都是靜態值（不依請求內容動態決定，`isProduction` 在
// build time 就固定），天生適合宣告式設定，不需要 middleware。
// CSP 對 script-src/style-src 使用 'unsafe-inline'：App Router 的 hydration/RSC
// 內嵌 script、以及本專案手刻圖表元件（TrendChart/TopProductsChart）用到的
// React inline style prop，都需要它；要收緊成 nonce-based CSP 需要另外設計
// nonce 產生與透傳機制，列為未來加強項。
const storageOrigins = storageUrls.map((url) => url.origin);

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${storageOrigins.map((origin) => ` ${origin}`).join("")}`,
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
    // 見上方 storageUrls 的說明：純網域（無路徑）的 URL，`url.pathname` 會是 "/"，
    // 若直接接 "/**" 會變成 "//**"（雙斜線），配不到 "/products/xxx.webp" 這種
    // 單斜線開頭的真實路徑，故先把單獨的 "/" 歸零，避免多接一層斜線。
    remotePatterns: storageUrls.map((url) => ({
      protocol: url.protocol.replace(":", "") as "http" | "https",
      hostname: url.hostname,
      port: url.port,
      pathname: `${url.pathname === "/" ? "" : url.pathname}/**`,
    })),
    // 見 SPEC.md §12.2：上傳的圖片已在 /api/v1/admin/uploads 統一轉為最長邊 1200px
    // 的 webp（見 src/lib/image-processing.ts），故拿掉預設 deviceSizes 裡超過
    // 1200 的斷點（1920/2048/3840）——來源本來就沒那麼大，Next 也不會放大圖片，
    // 保留那些斷點只是白白多產生用不到的圖片變體。
    deviceSizes: [640, 750, 828, 1080, 1200],
  },
};

export default withNextIntl(nextConfig);
