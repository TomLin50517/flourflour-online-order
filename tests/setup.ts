import { config } from "dotenv";

// 見 docs/OPEN-QUESTIONS.md：DATABASE_URL 改指向遠端 Supabase 後，測試套件（尤其
// pickup-number 的 200 筆併發交易）會因為網路延遲撞到交易逾時，改讓測試
// 固定連本機 docker Postgres——先讀 .env 拿到其餘共用變數，再用 .env.test 覆蓋
// DATABASE_URL。
config();
config({ path: ".env.test", override: true });
