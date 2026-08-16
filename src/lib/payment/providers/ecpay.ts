import type { PaymentStatus } from "@/generated/prisma/enums";
import { NotImplementedError } from "@/lib/errors";
import type {
  CreateChargeInput,
  CreateChargeResult,
  PaymentProvider,
  RawWebhook,
  WebhookEvent,
} from "../types";

export type ECPayConfig = {
  merchantId: string;
  hashKey: string;
  hashIv: string;
  endpoint: string;
};

// 見 SPEC.md §7.3：廠商 API 文件尚未提供，介面完整、僅將真實呼叫留空並拋出 NotImplementedError。
// TODO(VENDOR-API): 待綠界提供《全方位金流》文件後實作，見 docs/VENDOR-API-CHECKLIST.md。
export class ECPayProvider implements PaymentProvider {
  readonly code = "ecpay" as const;

  constructor(private cfg: ECPayConfig) {}

  async createCharge(_input: CreateChargeInput): Promise<CreateChargeResult> {
    // TODO(VENDOR-API): 依綠界文件組裝參數並計算 CheckMacValue；預期回傳 FORM_POST 模式。
    throw new NotImplementedError("ECPay.createCharge — 待廠商 API 文件");
  }

  verifySignature(_raw: RawWebhook): boolean {
    // TODO(VENDOR-API): 重算 CheckMacValue 與 raw.rawBody 中的值比對。
    throw new NotImplementedError("ECPay.verifySignature — 待廠商 API 文件");
  }

  parseWebhook(_raw: RawWebhook): WebhookEvent {
    throw new NotImplementedError("ECPay.parseWebhook — 待廠商 API 文件");
  }

  async queryCharge(_providerRef: string): Promise<{ status: PaymentStatus; amount: number; paidAt?: Date }> {
    throw new NotImplementedError("ECPay.queryCharge — 待廠商 API 文件");
  }

  async refund(_input: { providerRef: string; amount: number; reason?: string }): Promise<{ ok: boolean; refundRef?: string }> {
    throw new NotImplementedError("ECPay.refund — 待廠商 API 文件");
  }

  resolveReturn(_query: Record<string, string>): { orderNo?: string; hint: "SUCCESS" | "FAILED" | "UNKNOWN" } {
    throw new NotImplementedError("ECPay.resolveReturn — 待廠商 API 文件");
  }
}
