import type { PaymentStatus } from "@/db/schema";
import { NotImplementedError } from "@/lib/errors";
import type {
  CreateChargeInput,
  CreateChargeResult,
  PaymentProvider,
  RawWebhook,
  WebhookEvent,
} from "../types";

export type NewebPayConfig = {
  merchantId: string;
  hashKey: string;
  hashIv: string;
};

// 見 SPEC.md §7.3。TODO(VENDOR-API): 待藍新提供 MPG 串接文件後實作，見 docs/VENDOR-API-CHECKLIST.md。
export class NewebPayProvider implements PaymentProvider {
  readonly code = "newebpay" as const;

  constructor(private cfg: NewebPayConfig) {}

  async createCharge(_input: CreateChargeInput): Promise<CreateChargeResult> {
    // TODO(VENDOR-API): 依藍新 MPG 文件組裝 AES 加密參數；預期回傳 FORM_POST 模式。
    throw new NotImplementedError("NewebPay.createCharge — 待廠商 API 文件");
  }

  verifySignature(_raw: RawWebhook): boolean {
    // TODO(VENDOR-API): 以 HashKey/HashIV 重算 TradeSha 與回傳值比對。
    throw new NotImplementedError("NewebPay.verifySignature — 待廠商 API 文件");
  }

  parseWebhook(_raw: RawWebhook): WebhookEvent {
    throw new NotImplementedError("NewebPay.parseWebhook — 待廠商 API 文件");
  }

  async queryCharge(_providerRef: string): Promise<{ status: PaymentStatus; amount: number; paidAt?: Date }> {
    throw new NotImplementedError("NewebPay.queryCharge — 待廠商 API 文件");
  }

  async refund(_input: { providerRef: string; amount: number; reason?: string }): Promise<{ ok: boolean; refundRef?: string }> {
    throw new NotImplementedError("NewebPay.refund — 待廠商 API 文件");
  }

  resolveReturn(_query: Record<string, string>): { orderNo?: string; hint: "SUCCESS" | "FAILED" | "UNKNOWN" } {
    throw new NotImplementedError("NewebPay.resolveReturn — 待廠商 API 文件");
  }
}
