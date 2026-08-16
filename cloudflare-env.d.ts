// 手寫的暫時型別宣告——目前還沒有真正的 Hyperdrive 資源，無法用
// `npm run cf:typegen`（實際上是 `wrangler types --env-interface CloudflareEnv
// cloudflare-env.d.ts`）產生正式型別。等 `wrangler hyperdrive create` 建立好資源、
// `wrangler.jsonc` 的 hyperdrive binding 填上真正的 id 之後，跑一次 `npm run
// cf:typegen` 會直接覆蓋這個檔案、換成跟設定一致的正式型別，屆時這份手寫版本
// 就可以整份被取代掉，不需要手動維護。
// 見 docs/OPEN-QUESTIONS.md、src/lib/db.ts。
declare global {
  interface CloudflareEnv {
    HYPERDRIVE: {
      connectionString: string;
    };
  }
}

export {};
