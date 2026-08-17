import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { orThrow } from "@/db/helpers";
import { order, orderEvent, type OrderStatus } from "@/db/schema";
import { AppError } from "@/lib/errors";

// 見 SPEC.md §6.2 轉移表
export type ActorType = "SYSTEM" | "STAFF" | "ADMIN" | "PAYMENT_WEBHOOK";

type TransitionRule = {
  from: OrderStatus;
  to: OrderStatus;
  actorTypes: ActorType[];
};

const TRANSITIONS: TransitionRule[] = [
  { from: "PENDING_PAYMENT", to: "PAID", actorTypes: ["PAYMENT_WEBHOOK"] },
  { from: "PENDING_PAYMENT", to: "CANCELLED", actorTypes: ["SYSTEM", "STAFF"] },
  { from: "PAID", to: "PREPARING", actorTypes: ["STAFF"] },
  { from: "PREPARING", to: "READY", actorTypes: ["STAFF"] },
  { from: "READY", to: "COMPLETED", actorTypes: ["STAFF"] },
  { from: "PAID", to: "REFUNDED", actorTypes: ["ADMIN"] },
  { from: "PREPARING", to: "REFUNDED", actorTypes: ["ADMIN"] },
  { from: "READY", to: "REFUNDED", actorTypes: ["ADMIN"] },
  { from: "COMPLETED", to: "REFUNDED", actorTypes: ["ADMIN"] },
];

export class ConflictError extends AppError {
  constructor(message = "訂單已被他人更新") {
    super("CONFLICT", message);
    this.name = "ConflictError";
  }
}

export class InvalidStateTransitionError extends AppError {
  constructor(from: OrderStatus, to: OrderStatus) {
    super("INVALID_STATE_TRANSITION", `訂單狀態不允許此操作：${from} → ${to}`, { from, to });
    this.name = "InvalidStateTransitionError";
  }
}

function findRule(from: OrderStatus, to: OrderStatus, actorType: ActorType): TransitionRule | undefined {
  return TRANSITIONS.find(
    (rule) => rule.from === from && rule.to === to && rule.actorTypes.includes(actorType),
  );
}

export function isValidTransition(from: OrderStatus, to: OrderStatus, actorType: ActorType): boolean {
  return findRule(from, to, actorType) !== undefined;
}

export type TransitionInput = {
  tx: Tx;
  orderId: string;
  expectedVersion: number;
  toStatus: OrderStatus;
  actorType: ActorType;
  actorId?: string;
  note?: string;
  /** 額外要在同一交易內寫入的欄位（例如 paidAt、pickupNumber、readyAt…） */
  extraData?: Partial<typeof order.$inferInsert>;
};

/**
 * 唯一允許變更 Order.status 的入口。見 CLAUDE.md 硬性規則：
 * 禁止在其他地方直接改 order 的 status 欄位。
 *
 * 併發安全的關鍵：合法的「from 狀態集合」只由靜態規則表（toStatus + actorType）決定，
 * 不是由一次獨立的讀取決定——否則兩個併發呼叫中，較晚讀到「已被對方改過的狀態」那個
 * 呼叫會誤判成 InvalidStateTransitionError，而不是 SPEC 要求的 ConflictError。
 * 真正的判斷交給 UPDATE 的 WHERE（version + status IN validFrom）一次搞定，
 * 失敗後才需要分辨「版本不對（Conflict）」還是「狀態本來就不合法（Invalid）」。
 */
export async function transition(input: TransitionInput) {
  const { tx, orderId, expectedVersion, toStatus, actorType, actorId, note, extraData } = input;

  const validFromStatuses = TRANSITIONS.filter(
    (rule) => rule.to === toStatus && rule.actorTypes.includes(actorType),
  ).map((rule) => rule.from);

  const before = await tx.query.order.findFirst({ where: eq(order.id, orderId) });
  if (!before) {
    throw new AppError("NOT_FOUND", "訂單不存在");
  }

  if (validFromStatuses.length === 0) {
    throw new InvalidStateTransitionError(before.status, toStatus);
  }

  const updateResult = await tx
    .update(order)
    .set({ status: toStatus, version: sql`${order.version} + 1`, ...extraData })
    .where(
      and(
        eq(order.id, orderId),
        eq(order.version, expectedVersion),
        inArray(order.status, validFromStatuses),
      ),
    )
    .returning({ id: order.id });

  if (updateResult.length === 0) {
    const after = orThrow(await tx.query.order.findFirst({ where: eq(order.id, orderId) }));
    if (after.version !== expectedVersion) {
      throw new ConflictError();
    }
    throw new InvalidStateTransitionError(after.status, toStatus);
  }

  await tx.insert(orderEvent).values({
    orderId,
    fromStatus: before.status,
    toStatus,
    actorType,
    actorId,
    note,
  });

  return orThrow(await tx.query.order.findFirst({ where: eq(order.id, orderId) }));
}
