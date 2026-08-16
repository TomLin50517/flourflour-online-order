import type { PaymentStatus } from "@/generated/prisma/enums";
import { NotImplementedError } from "@/lib/errors";
import type {
  CreateChargeInput,
  CreateChargeResult,
  PaymentProvider,
  RawWebhook,
  WebhookEvent,
} from "../types";

export type TapPayConfig = {
  partnerKey: string;
  merchantId: string;
  appId: string;
  appKey: string;
};

// 見 SPEC.md §7.3。TODO(VENDOR-API): 待 TapPay 提供 Fields/Pay by Prime 文件後實作，見 docs/VENDOR-API-CHECKLIST.md。
export class TapPayProvider implements PaymentProvider {
  readonly code = "tappay" as const;

  constructor(private cfg: TapPayConfig) {}

  async createCharge(_input: CreateChargeInput): Promise<CreateChargeResult> {
    // TODO(VENDOR-API): 預期回傳 SDK_TOKEN 模式，clientToken 供前端掛載 TapPay Fields。
    throw new NotImplementedError("TapPay.createCharge — 待廠商 API 文件");
  }

  verifySignature(_raw: RawWebhook): boolean {
    // TODO(VENDOR-API): TapPay webhook 驗證方式（是否有簽章欄位）待文件確認。
    throw new NotImplementedError("TapPay.verifySignature — 待廠商 API 文件");
  }

  parseWebhook(_raw: RawWebhook): WebhookEvent {
    throw new NotImplementedError("TapPay.parseWebhook — 待廠商 API 文件");
  }

  async queryCharge(_providerRef: string): Promise<{ status: PaymentStatus; amount: number; paidAt?: Date }> {
    throw new NotImplementedError("TapPay.queryCharge — 待廠商 API 文件");
  }

  async refund(_input: { providerRef: string; amount: number; reason?: string }): Promise<{ ok: boolean; refundRef?: string }> {
    throw new NotImplementedError("TapPay.refund — 待廠商 API 文件");
  }

  resolveReturn(_query: Record<string, string>): { orderNo?: string; hint: "SUCCESS" | "FAILED" | "UNKNOWN" } {
    throw new NotImplementedError("TapPay.resolveReturn — 待廠商 API 文件");
  }
}
