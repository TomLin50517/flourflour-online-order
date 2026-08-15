import { z } from "zod";
import { LOCALES } from "@/lib/i18n/locale-map";

export const localeQuerySchema = z.object({
  locale: z.enum(LOCALES).optional(),
});

export const productSlugParamsSchema = z.object({
  slug: z.string().min(1),
});
