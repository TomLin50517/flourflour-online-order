import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { orThrow } from "@/db/helpers";
import {
  optionGroup as optionGroupTable,
  optionGroupTranslation as optionGroupTranslationTable,
  optionItem as optionItemTable,
  optionItemTranslation as optionItemTranslationTable,
  productOptionGroup as productOptionGroupTable,
} from "@/db/schema";
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
  const db = await getDb();
  const store = orThrow(await db.query.store.findFirst());
  return db.query.optionGroup.findMany({
    where: eq(optionGroupTable.storeId, store.id),
    orderBy: [asc(optionGroupTable.code)],
    with: {
      translations: true,
      items: { with: { translations: true }, orderBy: (t, { asc }) => asc(t.sortOrder) },
    },
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
  const db = await getDb();
  const store = orThrow(await db.query.store.findFirst());

  const group = await db.transaction(async (tx) => {
    const [groupRow] = await tx
      .insert(optionGroupTable)
      .values({
        storeId: store.id,
        code: input.code,
        selectType: input.selectType,
        minSelect: input.minSelect,
        maxSelect: input.maxSelect,
      })
      .returning();

    const translations = input.translations.length
      ? await tx
          .insert(optionGroupTranslationTable)
          .values(translationRows(input.translations).map((t) => ({ ...t, groupId: groupRow.id })))
          .returning()
      : [];

    const insertedItems = input.items.length
      ? await tx
          .insert(optionItemTable)
          .values(
            input.items.map((item, index) => ({
              groupId: groupRow.id,
              code: item.code,
              priceDelta: item.priceDelta,
              sortOrder: item.sortOrder ?? index,
              isDefault: item.isDefault ?? false,
              isActive: item.isActive ?? true,
            })),
          )
          .returning()
      : [];

    // 見 docs/DRIZZLE-MIGRATION-SPEC.md §4.2：批次 insert 的 RETURNING 順序跟傳入
    // 順序一致，用 index 對應回 input.items 找出每個規格項目對應的翻譯。
    const allItemTranslations = insertedItems.flatMap((itemRow, index) =>
      translationRows(input.items[index].translations).map((t) => ({ ...t, itemId: itemRow.id })),
    );
    const insertedItemTranslations = allItemTranslations.length
      ? await tx.insert(optionItemTranslationTable).values(allItemTranslations).returning()
      : [];

    return {
      ...groupRow,
      translations,
      items: insertedItems.map((itemRow) => ({
        ...itemRow,
        translations: insertedItemTranslations.filter((t) => t.itemId === itemRow.id),
      })),
    };
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
  const db = await getDb();
  const existing = await db.query.optionGroup.findFirst({ where: eq(optionGroupTable.id, id) });
  if (!existing) throw new NotFoundError("規格群組不存在");

  const selectType = input.selectType ?? existing.selectType;
  const minSelect = input.minSelect ?? existing.minSelect;
  const maxSelect = input.maxSelect ?? existing.maxSelect;
  assertBounds(selectType, minSelect, maxSelect);

  const group = await db.transaction(async (tx) => {
    if (input.translations) {
      await tx.delete(optionGroupTranslationTable).where(eq(optionGroupTranslationTable.groupId, id));
    }
    if (input.items) {
      await tx.delete(optionItemTable).where(eq(optionItemTable.groupId, id));
    }

    // 見 docs/DRIZZLE-MIGRATION-SPEC.md：只更新 translations/items、不帶其他欄位是
    // 合法的呼叫方式，Drizzle 的 `.set({})` 若全部欄位都是 undefined 會直接拋錯，
    // 故只在真的有欄位要更新時才呼叫 `.update()`。
    const patch: Partial<typeof optionGroupTable.$inferInsert> = {};
    if (input.code !== undefined) patch.code = input.code;
    if (input.selectType !== undefined) patch.selectType = input.selectType;
    if (input.minSelect !== undefined) patch.minSelect = input.minSelect;
    if (input.maxSelect !== undefined) patch.maxSelect = input.maxSelect;
    if (input.isActive !== undefined) patch.isActive = input.isActive;

    const [groupRow] =
      Object.keys(patch).length > 0
        ? await tx.update(optionGroupTable).set(patch).where(eq(optionGroupTable.id, id)).returning()
        : await tx.select().from(optionGroupTable).where(eq(optionGroupTable.id, id));

    const translations = input.translations
      ? await tx
          .insert(optionGroupTranslationTable)
          .values(translationRows(input.translations).map((t) => ({ ...t, groupId: id })))
          .returning()
      : await tx.query.optionGroupTranslation.findMany({ where: eq(optionGroupTranslationTable.groupId, id) });

    let items;
    if (input.items) {
      const insertedItems = input.items.length
        ? await tx
            .insert(optionItemTable)
            .values(
              input.items.map((item, index) => ({
                groupId: id,
                code: item.code,
                priceDelta: item.priceDelta,
                sortOrder: item.sortOrder ?? index,
                isDefault: item.isDefault ?? false,
                isActive: item.isActive ?? true,
              })),
            )
            .returning()
        : [];
      const allItemTranslations = insertedItems.flatMap((itemRow, index) =>
        translationRows(input.items![index].translations).map((t) => ({ ...t, itemId: itemRow.id })),
      );
      const insertedItemTranslations = allItemTranslations.length
        ? await tx.insert(optionItemTranslationTable).values(allItemTranslations).returning()
        : [];
      items = insertedItems.map((itemRow) => ({
        ...itemRow,
        translations: insertedItemTranslations.filter((t) => t.itemId === itemRow.id),
      }));
    } else {
      items = await tx.query.optionItem.findMany({
        where: eq(optionItemTable.groupId, id),
        with: { translations: true },
      });
    }

    return { ...groupRow, translations, items };
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
  const db = await getDb();
  const existing = await db.query.optionGroup.findFirst({ where: eq(optionGroupTable.id, id) });
  if (!existing) throw new NotFoundError("規格群組不存在");
  await db.transaction(async (tx) => {
    await tx.delete(productOptionGroupTable).where(eq(productOptionGroupTable.groupId, id));
    await tx.delete(optionGroupTable).where(eq(optionGroupTable.id, id));
  });
  await writeAuditLog({ actorId, action: "optionGroup.delete", targetType: "OptionGroup", targetId: id });
}
