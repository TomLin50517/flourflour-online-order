import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { isUniqueConstraintError, orThrow } from "@/db/helpers";
import {
  order as orderTable,
  orderItem as orderItemTable,
  orderItemOption as orderItemOptionTable,
  product as productTable,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { toDbLocale } from "@/lib/i18n/locale-map";
import { toTranslationRecord } from "@/lib/i18n/localize";
import { calcLineTotal, calcSubtotal, calcUnitPrice, sumPriceDeltas } from "@/lib/money";
import { getDb, type Tx } from "@/db/client";
import type { CreateOrderInput } from "@/schemas/order";
import { assignOrderNo } from "./order-no";

const ORDER_EXPIRE_MINUTES = Number(process.env.ORDER_EXPIRE_MINUTES ?? 15);

export class ProductUnavailableError extends AppError {
  constructor(message = "部分商品已售完", details?: unknown) {
    super("PRODUCT_UNAVAILABLE", message, details);
    this.name = "ProductUnavailableError";
  }
}

export class InvalidOptionSelectionError extends AppError {
  constructor(message = "規格選項不正確", details?: unknown) {
    super("INVALID_OPTION_SELECTION", message, details);
    this.name = "InvalidOptionSelectionError";
  }
}

async function loadProductsWithOptions(db: Awaited<ReturnType<typeof getDb>>, storeId: string, productIds: string[]) {
  return db.query.product.findMany({
    where: and(inArray(productTable.id, productIds), eq(productTable.storeId, storeId)),
    with: {
      translations: true,
      images: true,
      optionGroups: {
        with: {
          group: { with: { translations: true, items: { with: { translations: true } } } },
        },
      },
    },
  });
}

type ProductWithOptions = Awaited<ReturnType<typeof loadProductsWithOptions>>[number];

type PreparedOption = {
  optionItemId: string;
  groupNameSnapshot: Record<string, string>;
  itemNameSnapshot: Record<string, string>;
  priceDelta: number;
};

type PreparedItem = {
  productId: string;
  quantity: number;
  nameSnapshot: Record<string, string>;
  imageUrlSnapshot: string | null;
  unitBasePrice: number;
  unitOptionsPrice: number;
  unitPrice: number;
  lineTotal: number;
  options: PreparedOption[];
};

function prepareItem(
  product: ProductWithOptions,
  quantity: number,
  optionItemIds: string[],
): PreparedItem {
  if (!product.isActive || product.deletedAt || product.isSoldOut) {
    throw new ProductUnavailableError(`商品無法購買：${product.slug}`, { productId: product.id });
  }

  // productId -> 所有合法選項（含所屬群組資訊），供驗證與快照使用
  const optionIndex = new Map<
    string,
    {
      groupId: string;
      groupTranslations: Record<string, string>;
      itemTranslations: Record<string, string>;
      priceDelta: number;
    }
  >();
  for (const binding of product.optionGroups) {
    for (const item of binding.group.items) {
      if (!item.isActive) continue;
      optionIndex.set(item.id, {
        groupId: binding.groupId,
        groupTranslations: toTranslationRecord(binding.group.translations),
        itemTranslations: toTranslationRecord(item.translations),
        priceDelta: item.priceDelta,
      });
    }
  }

  for (const optionItemId of optionItemIds) {
    if (!optionIndex.has(optionItemId)) {
      throw new InvalidOptionSelectionError(`規格選項不屬於此商品：${optionItemId}`, {
        productId: product.id,
        optionItemId,
      });
    }
  }

  for (const binding of product.optionGroups) {
    const selectedCount = optionItemIds.filter(
      (id) => optionIndex.get(id)?.groupId === binding.groupId,
    ).length;
    const min = binding.isRequired ? Math.max(binding.group.minSelect, 1) : 0;
    const max = binding.group.maxSelect;
    if (selectedCount < min || selectedCount > max) {
      throw new InvalidOptionSelectionError(
        `規格「${binding.group.code}」選擇數量不符（需要 ${min}–${max} 項，實際 ${selectedCount} 項）`,
        { productId: product.id, groupId: binding.groupId },
      );
    }
  }

  const options: PreparedOption[] = optionItemIds.map((optionItemId) => {
    const resolved = optionIndex.get(optionItemId)!;
    return {
      optionItemId,
      groupNameSnapshot: resolved.groupTranslations,
      itemNameSnapshot: resolved.itemTranslations,
      priceDelta: resolved.priceDelta,
    };
  });

  const unitOptionsPrice = sumPriceDeltas(options.map((o) => o.priceDelta));
  const unitBasePrice = product.basePrice;
  const unitPrice = calcUnitPrice(unitBasePrice, options.map((o) => o.priceDelta));
  const lineTotal = calcLineTotal(unitPrice, quantity);
  const primaryImage = product.images.find((img) => img.isPrimary) ?? product.images[0];

  return {
    productId: product.id,
    quantity,
    nameSnapshot: toTranslationRecord(product.translations),
    imageUrlSnapshot: primaryImage?.url ?? null,
    unitBasePrice,
    unitOptionsPrice,
    unitPrice,
    lineTotal,
    options,
  };
}

async function findByIdempotencyKey(db: Awaited<ReturnType<typeof getDb>> | Tx, idempotencyKey: string) {
  return db.query.order.findFirst({
    where: eq(orderTable.idempotencyKey, idempotencyKey),
    with: { items: { with: { options: true } } },
  });
}

export async function createOrder(input: CreateOrderInput, idempotencyKey: string) {
  const db = await getDb();
  const existing = await findByIdempotencyKey(db, idempotencyKey);
  if (existing) {
    return { order: existing, isNew: false };
  }

  const store = orThrow(await db.query.store.findFirst());
  if (!store.isOpen) {
    throw new ProductUnavailableError("店家目前休息中，暫不接受新訂單");
  }

  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const products = await loadProductsWithOptions(db, store.id, productIds);
  const productById = new Map(products.map((p) => [p.id, p]));

  const preparedItems = input.items.map((item) => {
    const product = productById.get(item.productId);
    if (!product) {
      throw new ProductUnavailableError(`商品不存在：${item.productId}`, {
        productId: item.productId,
      });
    }
    return prepareItem(product, item.quantity, item.optionItemIds);
  });

  const subtotalAmount = calcSubtotal(preparedItems.map((i) => i.lineTotal));
  const dbLocale = toDbLocale(input.locale);

  try {
    const created = await db.transaction(async (tx) => {
      const now = new Date();
      const { orderNo } = await assignOrderNo(tx, store, now);
      const accessToken = randomBytes(32).toString("hex");
      const expiresAt = new Date(now.getTime() + ORDER_EXPIRE_MINUTES * 60 * 1000);

      const [newOrder] = await tx
        .insert(orderTable)
        .values({
          storeId: store.id,
          orderNo,
          accessToken,
          idempotencyKey,
          locale: dbLocale,
          subtotalAmount,
          totalAmount: subtotalAmount,
          customerName: input.customer?.name,
          customerPhone: input.customer?.phone,
          customerNote: input.note,
          expiresAt,
        })
        .returning();

      // 見 docs/DRIZZLE-MIGRATION-SPEC.md §4.2：單一 batch insert 的 RETURNING 順序
      // 跟傳入的 VALUES 順序一致，故用 index 對應回 preparedItems 找出每個品項的選項。
      const insertedItems = preparedItems.length
        ? await tx
            .insert(orderItemTable)
            .values(
              preparedItems.map((item) => ({
                orderId: newOrder.id,
                productId: item.productId,
                quantity: item.quantity,
                nameSnapshot: item.nameSnapshot,
                imageUrlSnapshot: item.imageUrlSnapshot,
                unitBasePrice: item.unitBasePrice,
                unitOptionsPrice: item.unitOptionsPrice,
                unitPrice: item.unitPrice,
                lineTotal: item.lineTotal,
              })),
            )
            .returning()
        : [];

      const allOptions = insertedItems.flatMap((insertedItem, index) =>
        preparedItems[index].options.map((option) => ({
          orderItemId: insertedItem.id,
          optionItemId: option.optionItemId,
          groupNameSnapshot: option.groupNameSnapshot,
          itemNameSnapshot: option.itemNameSnapshot,
          priceDelta: option.priceDelta,
        })),
      );
      const insertedOptions = allOptions.length
        ? await tx.insert(orderItemOptionTable).values(allOptions).returning()
        : [];

      return {
        ...newOrder,
        items: insertedItems.map((insertedItem) => ({
          ...insertedItem,
          options: insertedOptions.filter((o) => o.orderItemId === insertedItem.id),
        })),
      };
    });

    return { order: created, isNew: true };
  } catch (error) {
    // 併發下兩個相同 Idempotency-Key 的請求都通過了第一次查重，
    // 唯一索引會讓後到的那筆在此丟出 unique_violation；直接回原訂單即可。
    if (isUniqueConstraintError(error)) {
      const raceWinner = await findByIdempotencyKey(db, idempotencyKey);
      if (raceWinner) {
        return { order: raceWinner, isNew: false };
      }
    }
    throw error;
  }
}
