import { getDb } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { toDbLocale, type Locale } from "@/lib/i18n/locale-map";
import { writeAuditLog } from "@/server/admin/audit-log";

type TranslationInput = { locale: Locale; name: string };
type OptionItemInput = {
  code: string;
  priceDelta: number;
  sortOrder?: number;
  isDefault?: boolean;
  isActive?: boolean;
  translations: TranslationInput[];
};

function translationRows(translations: TranslationInput[]) {
  return translations.map((t) => ({ locale: toDbLocale(t.locale), name: t.name }));
}

function assertBounds(selectType: "SINGLE" | "MULTIPLE", minSelect: number, maxSelect: number) {
  // 見 SPEC.md §5.2 INV-3
  if (selectType === "SINGLE" && maxSelect !== 1) {
    throw new ValidationError("SINGLE 群組的 maxSelect 必須為 1");
  }
  if (selectType === "SINGLE" && ![0, 1].includes(minSelect)) {
    throw new ValidationError("SINGLE 群組的 minSelect 必須是 0 或 1");
  }
}

export async function listOptionGroupsAdmin() {
  const prisma = await getDb();
  const store = await prisma.store.findFirstOrThrow();
  return prisma.optionGroup.findMany({
    where: { storeId: store.id },
    include: {
      translations: true,
      items: { include: { translations: true }, orderBy: { sortOrder: "asc" } },
    },
    orderBy: { code: "asc" },
  });
}

export async function createOptionGroup(
  input: {
    code: string;
    selectType: "SINGLE" | "MULTIPLE";
    minSelect: number;
    maxSelect: number;
    translations: TranslationInput[];
    items: OptionItemInput[];
  },
  actorId: string,
) {
  assertBounds(input.selectType, input.minSelect, input.maxSelect);
  const prisma = await getDb();
  const store = await prisma.store.findFirstOrThrow();

  const group = await prisma.optionGroup.create({
    data: {
      storeId: store.id,
      code: input.code,
      selectType: input.selectType,
      minSelect: input.minSelect,
      maxSelect: input.maxSelect,
      translations: { create: translationRows(input.translations) },
      items: {
        create: input.items.map((item, index) => ({
          code: item.code,
          priceDelta: item.priceDelta,
          sortOrder: item.sortOrder ?? index,
          isDefault: item.isDefault ?? false,
          isActive: item.isActive ?? true,
          translations: { create: translationRows(item.translations) },
        })),
      },
    },
    include: { translations: true, items: { include: { translations: true } } },
  });
  await writeAuditLog({
    actorId,
    action: "optionGroup.create",
    targetType: "OptionGroup",
    targetId: group.id,
    diff: input,
  });
  return group;
}

export async function updateOptionGroup(
  id: string,
  input: {
    code?: string;
    selectType?: "SINGLE" | "MULTIPLE";
    minSelect?: number;
    maxSelect?: number;
    isActive?: boolean;
    translations?: TranslationInput[];
    items?: OptionItemInput[];
  },
  actorId: string,
) {
  const prisma = await getDb();
  const existing = await prisma.optionGroup.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("規格群組不存在");

  const selectType = input.selectType ?? existing.selectType;
  const minSelect = input.minSelect ?? existing.minSelect;
  const maxSelect = input.maxSelect ?? existing.maxSelect;
  assertBounds(selectType, minSelect, maxSelect);

  const group = await prisma.$transaction(async (tx) => {
    if (input.translations) {
      await tx.optionGroupTranslation.deleteMany({ where: { groupId: id } });
    }
    if (input.items) {
      await tx.optionItem.deleteMany({ where: { groupId: id } });
    }

    return tx.optionGroup.update({
      where: { id },
      data: {
        code: input.code,
        selectType: input.selectType,
        minSelect: input.minSelect,
        maxSelect: input.maxSelect,
        isActive: input.isActive,
        translations: input.translations
          ? { create: translationRows(input.translations) }
          : undefined,
        items: input.items
          ? {
              create: input.items.map((item, index) => ({
                code: item.code,
                priceDelta: item.priceDelta,
                sortOrder: item.sortOrder ?? index,
                isDefault: item.isDefault ?? false,
                isActive: item.isActive ?? true,
                translations: { create: translationRows(item.translations) },
              })),
            }
          : undefined,
      },
      include: { translations: true, items: { include: { translations: true } } },
    });
  });
  await writeAuditLog({
    actorId,
    action: "optionGroup.update",
    targetType: "OptionGroup",
    targetId: id,
    diff: input,
  });
  return group;
}

export async function deleteOptionGroup(id: string, actorId: string) {
  const prisma = await getDb();
  const existing = await prisma.optionGroup.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("規格群組不存在");
  await prisma.$transaction([
    prisma.productOptionGroup.deleteMany({ where: { groupId: id } }),
    prisma.optionGroup.delete({ where: { id } }),
  ]);
  await writeAuditLog({ actorId, action: "optionGroup.delete", targetType: "OptionGroup", targetId: id });
}
