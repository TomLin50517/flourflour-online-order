import { z } from "zod";
import { LOCALES } from "@/lib/i18n/locale-map";

const translationInputSchema = z.object({
  locale: z.enum(LOCALES),
  name: z.string().min(1),
  description: z.string().max(2000).optional(),
});

const productImageInputSchema = z.object({
  url: z.string().min(1),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  altText: z.string().max(200).optional(),
  isPrimary: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const createProductSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, "slug 只能是小寫英數字與連字號"),
  sku: z.string().max(50).optional(),
  categoryId: z.string().min(1).optional(),
  basePrice: z.number().int().min(0),
  sortOrder: z.number().int().optional(),
  translations: z.array(translationInputSchema).length(4),
  optionGroupIds: z.array(z.string().min(1)).optional().default([]),
});

export const updateProductSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  sku: z.string().max(50).nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  basePrice: z.number().int().min(0).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  translations: z.array(translationInputSchema).length(4).optional(),
  optionGroupIds: z.array(z.string().min(1)).optional(),
  images: z.array(productImageInputSchema).optional(),
});

export const productAvailabilitySchema = z.object({
  isActive: z.boolean().optional(),
  isSoldOut: z.boolean().optional(),
});

export const idParamsSchema = z.object({ id: z.string().min(1) });

const categoryTranslationSchema = z.object({
  locale: z.enum(LOCALES),
  name: z.string().min(1),
});

export const createCategorySchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  sortOrder: z.number().int().optional(),
  translations: z.array(categoryTranslationSchema).length(4),
});

export const updateCategorySchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  translations: z.array(categoryTranslationSchema).length(4).optional(),
});

const optionItemInputSchema = z.object({
  id: z.string().min(1).optional(), // 有 id 代表更新既有項目
  code: z.string().min(1),
  priceDelta: z.number().int(),
  sortOrder: z.number().int().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  translations: z.array(categoryTranslationSchema).length(4),
});

export const createOptionGroupSchema = z.object({
  code: z.string().min(1),
  selectType: z.enum(["SINGLE", "MULTIPLE"]),
  minSelect: z.number().int().min(0),
  maxSelect: z.number().int().min(1),
  translations: z.array(categoryTranslationSchema).length(4),
  items: z.array(optionItemInputSchema).min(1),
});

export const updateOptionGroupSchema = z.object({
  code: z.string().min(1).optional(),
  selectType: z.enum(["SINGLE", "MULTIPLE"]).optional(),
  minSelect: z.number().int().min(0).optional(),
  maxSelect: z.number().int().min(1).optional(),
  isActive: z.boolean().optional(),
  translations: z.array(categoryTranslationSchema).length(4).optional(),
  items: z.array(optionItemInputSchema).optional(),
});

export const adminOrdersQuerySchema = z.object({
  status: z.enum(["PENDING_PAYMENT", "PAID", "PREPARING", "READY", "COMPLETED", "CANCELLED", "REFUNDED"]).optional(),
  pickupNumber: z.string().optional(),
});

export const updateOrderStatusSchema = z.object({
  // PAID 只能由付款 webhook 觸發（見 SPEC.md §6.2），後台不得手動設定
  toStatus: z.enum(["PREPARING", "READY", "COMPLETED", "CANCELLED", "REFUNDED"]),
  expectedVersion: z.number().int().min(0),
  note: z.string().max(500).optional(),
});

export const uploadPresignSchema = z.object({
  filename: z.string().min(1),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});
