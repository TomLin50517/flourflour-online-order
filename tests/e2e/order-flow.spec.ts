import path from "node:path";
import { test, expect, type Browser, type Page } from "@playwright/test";
import en from "../../messages/en.json";
import ja from "../../messages/ja.json";
import ko from "../../messages/ko.json";
import zhTW from "../../messages/zh-TW.json";

// 見 SPEC.md §12.5：四語系各跑一次「瀏覽 → 選規格 → 加入購物車 → 結帳 →
// MockProvider 付款 → 取得取貨號 → 後台推進至完成」的完整流程。
const LOCALES = [
  { code: "zh-TW", m: zhTW },
  { code: "en", m: en },
  { code: "ja", m: ja },
  { code: "ko", m: ko },
] as const;

const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL ?? "admin@flourflour.test";
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? "admin1234";
const TEST_NOTE = "PLAYWRIGHT_E2E_TEST";
const PRODUCT_SLUG = "pineapple-cake"; // 有必選的 boxSize 規格群組，用來測試「選規格」

// 見 SPEC.md §12.1：/admin/login 每 IP 5 次/分。本檔會多次進入後台操作看板，
// 若每次都重新登入會撞到這個限流。改成整個測試檔只登入一次、把已登入的
// storageState 存成檔案，後續每個需要後台的步驟都重用同一個已登入 context
// （Playwright 官方推薦的驗證重用模式），不再重複打登入端點。
const authFile = path.join(__dirname, ".admin-auth-state.json");

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("密碼").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登入" }).click();
  await page.waitForURL("**/admin/orders");
  await context.storageState({ path: authFile });
  await context.close();
});

async function browseSelectAndAddToCart(page: Page, locale: string): Promise<void> {
  await page.goto(`/${locale}/product/${PRODUCT_SLUG}`);
  // boxSize 群組的第二個選項（size6，非預設值）：用結構位置而非翻譯文字挑選，
  // 這樣同一段邏輯可以套用在四個語系上，不用為每個語系另外準備對應的規格名稱。
  await page.locator("fieldset").first().locator("label").nth(1).click();
  // 底部 sticky bar 的加入購物車按鈕：用固定定位的容器結構鎖定，避開語系文字差異。
  await page.locator(".fixed.inset-x-0.bottom-0 button").click();
}

async function checkoutAndPay(page: Page, locale: string, messages: (typeof zhTW)): Promise<string> {
  await page.waitForURL(`**/${locale}/cart`);
  await page.goto(`/${locale}/checkout`);

  await page.getByLabel(messages.checkout.note).fill(TEST_NOTE);
  await page.getByRole("button", { name: messages.checkout.submit }).click();

  // 送出後會自動呼叫 POST /orders/{no}/payment，mock provider 回 REDIRECT
  // 到 /dev/mock-pay，瀏覽器會整頁導向過去。
  await page.waitForURL("**/dev/mock-pay?**");
  const url = new URL(page.url());
  const orderNo = url.searchParams.get("orderNo");
  if (!orderNo) throw new Error("未在 /dev/mock-pay 網址上找到 orderNo");

  await page.getByRole("button", { name: "模擬付款成功" }).click();
  await expect(page.getByText("已模擬付款成功")).toBeVisible();

  return orderNo;
}

async function waitForPickupNumber(page: Page, locale: string, orderNo: string): Promise<string> {
  await page.goto(`/${locale}/order/${orderNo}`);
  const pickupNumberLocator = page.locator("p.text-\\[96px\\]");
  await expect(pickupNumberLocator).toBeVisible({ timeout: 15_000 });
  const pickupNumber = await pickupNumberLocator.textContent();
  if (!pickupNumber) throw new Error("找不到取貨單號");
  return pickupNumber.trim();
}

async function advanceOrderToCompleted(browser: Browser, pickupNumber: string): Promise<void> {
  const context = await browser.newContext({ storageState: authFile });
  const page = await context.newPage();
  await page.goto("/admin/orders");

  for (const nextLabel of ["開始製作", "完成，可取餐", "已取餐"]) {
    // 訂單卡片本身用 `rounded-md border p-3` 這組特定 class（外層欄位容器是
    // `rounded-lg border bg-background`），鎖定卡片本身、不鎖到外層欄位容器，
    // 避免 strict mode 因為兩層都「hasText 取號」而判定為多重匹配。
    const card = page.locator(".rounded-md.border.p-3").filter({ hasText: pickupNumber });
    await card.getByRole("button", { name: nextLabel }).click();
    await expect(page.getByText(pickupNumber).first()).toBeVisible();
  }

  await context.close();
}

// 見 docs/OPEN-QUESTIONS.md：Playwright Test 用 CJS 轉譯執行測試檔，Prisma 產生的
// client 是純 ESM，兩者衝突（即使動態 import() 也一樣，Playwright 的 loader 會
// 攔截所有 import 路徑）。故不在測試檔內清理，改由 `scripts/cleanup-e2e-data.ts`
// （用 tsx 執行，已驗證能正常載入 ESM）事後清掉標記為 TEST_NOTE 的訂單。

for (const { code, m } of LOCALES) {
  test(`完整下單流程（${code}）`, async ({ page, browser }) => {
    await browseSelectAndAddToCart(page, code);
    const orderNo = await checkoutAndPay(page, code, m);
    const pickupNumber = await waitForPickupNumber(page, code, orderNo);
    expect(pickupNumber).toMatch(/^[A-Z]\d+$/);
    await advanceOrderToCompleted(browser, pickupNumber);
  });
}

test("銷售統計頁在完成上述流程後可正常載入", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile });
  const page = await context.newPage();
  await page.goto("/admin/stats");
  await expect(page.getByText("總營收", { exact: true })).toBeVisible();
  await expect(page.getByText("訂單數", { exact: true })).toBeVisible();
  await context.close();
});
