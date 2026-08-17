import type { PaymentStatus } from "@/db/schema";
import type { Locale } from "@/lib/i18n/locale-map";

// 見 SPEC.md §7.2：金流抽象層介面，凍結上下游契約。
export type ProviderCode = "mock" | "ecpay" | "newebpay" | "tappay";

export const PROVIDER_CODES = ["mock", "ecpay", "newebpay", "tappay"] as const;

export interface CreateChargeInput {
  orderId: string;
  orderNo: string;
  amount: number; // 最小貨幣單位
  currency: "TWD";
  locale: Locale; // 廠商付款頁語系（能支援才傳）
  idempotencyKey: string;
  items: Array<{ name: string; quantity: number; unitPrice: number }>;
  customer?: { name?: string; phone?: string; email?: string };
  returnUrl: string; // 顧客付款後導回（前台訂單頁）
  notifyUrl: string; // 伺服器對伺服器 webhook
  clientMeta?: { ip?: string; userAgent?: string };
}

/** 三種可能的付款啟動模式，涵蓋台灣主要金流的差異 */
export type CreateChargeResult =
  | { mode: "REDIRECT"; paymentId: string; providerRef?: string; redirectUrl: string }
  | {
      mode: "FORM_POST";
      paymentId: string;
      providerRef?: string;
      action: string;
      fields: Record<string, string>;
    } // 綠界/藍新常見
  | {
      mode: "SDK_TOKEN";
      paymentId: string;
      providerRef?: string;
      clientToken: string;
      sdkParams: Record<string, unknown>;
    }; // TapPay Fields

export interface RawWebhook {
  headers: Record<string, string>;
  rawBody: string; // ★ 必須是未經 parse 的原始字串，供驗簽
  query: Record<string, string>;
}

export interface WebhookEvent {
  providerEventId: string; // 用於冪等去重
  eventType: "charge.succeeded" | "charge.failed" | "charge.cancelled" | "refund.succeeded" | "unknown";
  providerRef: string;
  orderNo: string;
  amount: number;
  currency: string;
  paidAt?: Date;
  method?: string;
  card?: { brand?: string; last4?: string };
  failure?: { code: string; message: string };
  raw: unknown;
}

export interface PaymentProvider {
  readonly code: ProviderCode;
  createCharge(input: CreateChargeInput): Promise<CreateChargeResult>;
  verifySignature(raw: RawWebhook): boolean;
  parseWebhook(raw: RawWebhook): WebhookEvent;
  queryCharge(providerRef: string): Promise<{ status: PaymentStatus; amount: number; paidAt?: Date }>;
  refund(input: { providerRef: string; amount: number; reason?: string }): Promise<{ ok: boolean; refundRef?: string }>;
  /** 廠商回導頁的成功與否判定（部分廠商 returnUrl 帶簽章參數） */
  resolveReturn(query: Record<string, string>): { orderNo?: string; hint: "SUCCESS" | "FAILED" | "UNKNOWN" };
}
