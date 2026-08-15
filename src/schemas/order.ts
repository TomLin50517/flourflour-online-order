import { z } from "zod";
import { LOCALES } from "@/lib/i18n/locale-map";

export const createOrderItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(99),
  optionItemIds: z.array(z.string().min(1)).default([]),
});

export const createOrderSchema = z.object({
  locale: z.enum(LOCALES),
  items: z.array(createOrderItemSchema).min(1),
  customer: z
    .object({
      name: z.string().max(100).optional(),
      phone: z.string().max(30).optional(),
    })
    .optional(),
  note: z.string().max(200).optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const idempotencyKeyHeaderSchema = z.string().min(1, "Idempotency-Key is required");

export const orderNoParamsSchema = z.object({
  orderNo: z.string().min(1),
});

export const orderTokenHeaderSchema = z.string().min(1, "X-Order-Token is required");
