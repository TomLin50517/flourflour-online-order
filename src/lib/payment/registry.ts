import { ECPayProvider } from "./providers/ecpay";
import { MockProvider } from "./providers/mock";
import { NewebPayProvider } from "./providers/newebpay";
import { TapPayProvider } from "./providers/tappay";
import { PROVIDER_CODES, type PaymentProvider, type ProviderCode } from "./types";

let mockProvider: MockProvider | undefined;

/** 見 SPEC.md §7.1：核心訂單流程只透過此介面取得 provider，不得直接 new 廠商 SDK。 */
export function getPaymentProvider(code: ProviderCode): PaymentProvider {
  switch (code) {
    case "mock":
      mockProvider ??= new MockProvider();
      return mockProvider;
    case "ecpay":
      return new ECPayProvider({
        merchantId: process.env.ECPAY_MERCHANT_ID ?? "",
        hashKey: process.env.ECPAY_HASH_KEY ?? "",
        hashIv: process.env.ECPAY_HASH_IV ?? "",
        endpoint: process.env.ECPAY_ENDPOINT ?? "",
      });
    case "newebpay":
      return new NewebPayProvider({
        merchantId: process.env.NEWEBPAY_MERCHANT_ID ?? "",
        hashKey: process.env.NEWEBPAY_HASH_KEY ?? "",
        hashIv: process.env.NEWEBPAY_HASH_IV ?? "",
      });
    case "tappay":
      return new TapPayProvider({
        partnerKey: process.env.TAPPAY_PARTNER_KEY ?? "",
        merchantId: process.env.TAPPAY_MERCHANT_ID ?? "",
        appId: process.env.TAPPAY_APP_ID ?? "",
        appKey: process.env.TAPPAY_APP_KEY ?? "",
      });
  }
}

export function isProviderCode(value: string): value is ProviderCode {
  return (PROVIDER_CODES as readonly string[]).includes(value);
}

export function defaultProviderCode(): ProviderCode {
  const configured = process.env.PAYMENT_PROVIDER ?? "mock";
  return isProviderCode(configured) ? configured : "mock";
}
