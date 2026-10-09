import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { HttpError } from "./http";
import { redis } from "./limits";
import { refundRequest, settleOrder } from "./billing";
import { stripeClient } from "./stripe";
import { characterImageUrl } from "./character-images";
import { readCharacterImage } from "./character-image-store";
const reason = z.string().trim().min(2).max(200);
const characterFields = {
  name: z.string().trim().min(1).max(30),
  title: z.string().trim().min(1).max(80),
  greeting: z.string().trim().min(1).max(500),
  systemPrompt: z.string().trim().min(10).max(4000),
  tags: z.array(z.string().trim().min(1).max(15)).max(5),
  pricePerMessage: z.number().int().min(1).max(100),
  avatarUrl: characterImageUrl.nullable(),
};
export const adminActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("user-status"),
    id: z.string(),
    status: z.enum(["ACTIVE", "FROZEN"]),
    reason,
  }),
  z.object({
    action: z.literal("wallet-adjust"),
    id: z.string(),
    requestId: z.uuid(),
    amount: z
      .number()
      .int()
      .min(-100000)
      .max(100000)
      .refine((v) => v !== 0),
    reason,
  }),
  z.object({
    action: z.literal("character-save"),
    id: z.string().optional(),
    expectedUpdatedAt: z.iso.datetime().optional(),
    ...characterFields,
    reason,
  }),
  z.object({
    action: z.literal("character-status"),
    id: z.string(),
    expectedStatus: z.enum(["REVIEWING", "PUBLISHED", "REJECTED", "ARCHIVED"]),
    status: z.enum(["PUBLISHED", "REJECTED", "ARCHIVED", "REVIEWING"]),
    reason,
  }),
  z.object({ action: z.literal("order-sync"), id: z.string(), reason }),
  z.object({ action: z.literal("reconcile"), id: z.string(), reason }),
]);
export type AdminAction = z.infer<typeof adminActionSchema>;
export async function performAdminAction(actorId: string, input: AdminAction) {
  // Re-check privileges in the transaction for local state mutations.
  const assertActor = async (tx: Prisma.TransactionClient) => {
    const actor = await tx.user.findFirst({
      where: { id: actorId, role: "ADMIN", status: "ACTIVE" },
    });
    if (!actor) throw new HttpError(403, "管理员权限已失效");
  };
  if (input.action === "user-status") {
    if (input.id === actorId) throw new HttpError(409, "不能冻结当前管理员");
    await prisma.$transaction(async (tx) => {
      await assertActor(tx);
      const user = await tx.user.findUnique({ where: { id: input.id } });
      if (!user || user.role === "ADMIN" || user.status === "DELETED")
        throw new HttpError(409, "该账号不能通过后台修改状态");
      await tx.user.update({
        where: { id: input.id },
        data: { status: input.status },
      });
      if (input.status === "FROZEN")
        await tx.authSession.deleteMany({ where: { userId: input.id } });
      await tx.adminAudit.create({
        data: {
          actorId,
          action: input.action,
          entityId: input.id,
          detail: {
            before: user.status,
            after: input.status,
            reason: input.reason,
          },
        },
      });
    });
  } else if (input.action === "wallet-adjust") {
    await prisma.$transaction(async (tx) => {
      await assertActor(tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestId}))`;
      const previous = await tx.adminAudit.findUnique({
        where: { id: input.requestId },
      });
      if (previous) {
        const detail = previous.detail as { amount: number; reason: string };
        if (
          previous.actorId !== actorId ||
          previous.entityId !== input.id ||
          previous.action !== input.action ||
          detail.amount !== input.amount ||
          detail.reason !== input.reason
        )
          throw new HttpError(409, "操作标识已使用");
        return;
      }
      const wallet = await tx.wallet.findUnique({
        where: { userId: input.id },
      });
      if (!wallet) throw new HttpError(404, "钱包不存在");
      const result = await tx.wallet.updateMany({
        where: {
          id: wallet.id,
          ...(input.amount < 0 ? { balance: { gte: -input.amount } } : {}),
        },
        data: { balance: { increment: input.amount } },
      });
      if (!result.count) throw new HttpError(409, "调整后余额不足");
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: input.amount,
          reason: "运营调整：" + input.reason,
          refType: "ADMIN",
          refId: input.requestId,
        },
      });
      await tx.adminAudit.create({
        data: {
          id: input.requestId,
          actorId,
          action: input.action,
          entityId: input.id,
          detail: { amount: input.amount, reason: input.reason },
        },
      });
    });
  } else if (input.action === "character-save") {
    if (input.avatarUrl?.startsWith("/api/character-images/"))
      await readCharacterImage(input.avatarUrl.slice("/api/character-images/".length));
    await prisma.$transaction(async (tx) => {
      await assertActor(tx);
      const { action, id, expectedUpdatedAt, reason: note, ...data } = input;
      if (id) {
        const current = await tx.character.findUnique({ where: { id } });
        if (!current || (current.ownerId && current.status === "DRAFT"))
          throw new HttpError(404, "角色未提交审核");
        if (
          !expectedUpdatedAt ||
          current.updatedAt.toISOString() !== expectedUpdatedAt
        )
          throw new HttpError(409, "角色已被更新，请刷新后重试");
        const changed = await tx.character.updateMany({
          where: { id, updatedAt: current.updatedAt },
          data,
        });
        if (!changed.count)
          throw new HttpError(409, "角色已被更新，请刷新后重试");
        await tx.adminAudit.create({
          data: {
            actorId,
            action,
            entityId: id,
            detail: { reason: note, fields: Object.keys(data) },
          },
        });
      } else {
        const created = await tx.character.create({
          data: { ...data, status: "REVIEWING" },
        });
        await tx.adminAudit.create({
          data: {
            actorId,
            action,
            entityId: created.id,
            detail: { reason: note },
          },
        });
      }
    });
    await redis.del("catalog:").catch(() => {});
  } else if (input.action === "character-status") {
    const transitions: Record<string, string[]> = {
      REVIEWING: ["PUBLISHED", "REJECTED"],
      PUBLISHED: ["ARCHIVED"],
      ARCHIVED: ["REVIEWING"],
      REJECTED: ["REVIEWING"],
    };
    if (!transitions[input.expectedStatus]?.includes(input.status))
      throw new HttpError(409, "状态转换不允许");
    await prisma.$transaction(async (tx) => {
      await assertActor(tx);
      const changed = await tx.character.updateMany({
        where: { id: input.id, status: input.expectedStatus },
        data: { status: input.status },
      });
      if (!changed.count) throw new HttpError(409, "状态已改变，请刷新");
      await tx.adminAudit.create({
        data: {
          actorId,
          action: input.action,
          entityId: input.id,
          detail: {
            before: input.expectedStatus,
            after: input.status,
            reason: input.reason,
          },
        },
      });
    });
    await redis.del("catalog:").catch(() => {});
  } else if (input.action === "order-sync") {
    const order = await prisma.order.findUnique({ where: { id: input.id } });
    if (
      !order ||
      order.provider !== "stripe" ||
      !order.providerRef ||
      order.status !== "PENDING"
    )
      throw new HttpError(409, "仅可同步待支付的 Stripe 订单");
    const session = await stripeClient().checkout.sessions.retrieve(
      order.providerRef,
    );
    if (
      session.payment_status !== "paid" ||
      session.currency !== "cny" ||
      session.metadata?.orderId !== order.id ||
      session.amount_total !== order.amountCents
    )
      throw new HttpError(409, "支付平台尚未确认匹配的到账记录");
    // Write intent before external reconciliation so every initiated sync is traceable.
    await prisma.adminAudit.create({
      data: {
        actorId,
        action: input.action,
        entityId: input.id,
        detail: { reason: input.reason, providerRef: session.id },
      },
    });
    await settleOrder(order.id, session.id, session.amount_total);
  } else {
    const pending = await prisma.chatRequest.findFirst({
      where: {
        id: input.id,
        status: "PENDING",
        createdAt: { lt: new Date(Date.now() - 5 * 60000) },
      },
    });
    if (!pending) throw new HttpError(409, "仅可对账超时五分钟的处理中请求");
    await prisma.adminAudit.create({
      data: {
        actorId,
        action: input.action,
        entityId: input.id,
        detail: { reason: input.reason },
      },
    });
    await refundRequest(input.id);
  }
}
