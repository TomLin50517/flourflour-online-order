import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

// LoginForm 用 useSearchParams() 讀 callbackUrl，靜態預渲染（next build）要求
// 這類 hook 必須包在 Suspense 邊界內，否則會直接讓建置失敗。
export default function AdminLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
