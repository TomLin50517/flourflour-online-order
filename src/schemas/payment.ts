import { z } from "zod";
import { PROVIDER_CODES } from "@/lib/payment/types";

// 見 SPEC.md §8.2 POST /orders/{orderNo}/payment
export const createOrderPaymentSchema = z.object({
  provider: z.enum(PROVIDER_CODES).optional(),
  returnPath: z.string().min(1),
});

export type CreateOrderPaymentInput = z.infer<typeof createOrderPaymentSchema>;

// provider 是否為已知代碼由 server 層驗證（未知代碼視為 404，而非驗證錯誤）
export const webhookProviderParamsSchema = z.object({
  provider: z.string().min(1),
});
