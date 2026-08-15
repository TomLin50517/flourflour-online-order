# FlourFlour 線上點單系統

四語系（zh-TW / en / ja / ko）線上點單網站 + 管理後台。詳細規格見 [`SPEC.md`](./SPEC.md)，開發規範見 [`CLAUDE.md`](./CLAUDE.md)。

> 目前為 M0（專案骨架）階段，尚無實際頁面與資料模型。

## 開發環境

```bash
docker compose up -d      # 啟動 Postgres 16 + MinIO
cp .env.example .env      # 首次設定，並依需要調整
npm install
npm run dev                # http://localhost:3000
```

## 常用指令

```bash
npm run dev                # 開發伺服器
npm run typecheck          # next typegen && tsc --noEmit
npm run lint                # ESLint
npm run test                # Vitest
npm run db:migrate          # prisma migrate dev
npm run db:studio           # Prisma Studio
```

**每個里程碑結束前必須全綠**：`npm run typecheck && npm run lint && npm run test`
