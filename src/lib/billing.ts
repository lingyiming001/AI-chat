import { prisma } from "./db";
import { HttpError } from "./http";
export const plans = [
  { id: "starter", name: "轻松尝鲜", coins: 100, amountCents: 990 },
  { id: "regular", name: "灵感常伴", coins: 680, amountCents: 4900 },
  { id: "creator", name: "无限想象", coins: 1680, amountCents: 11900 },
] as const;
export async function settleOrder(
  id: string,
  providerRef: string,
  amountCents: number,
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id } });
    if (
      !order ||
      order.amountCents !== amountCents ||
      (order.providerRef && order.providerRef !== providerRef)
    )
      throw new HttpError(400, "订单校验失败");
    const updated = await tx.order.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "PAID", paidAt: new Date(), providerRef },
    });
    if (!updated.count) return;
    const wallet = await tx.wallet.update({
      where: { userId: order.userId },
      data: { balance: { increment: order.coins } },
    });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: order.coins,
        reason: order.provider === "demo" ? "模拟充值" : "充值到账",
        refType: "ORDER",
        refId: id,
      },
    });
  });
}
export async function refundRequest(id: string) {
  await prisma.$transaction(async (tx) => {
    const request = await tx.chatRequest.findUnique({ where: { id } });
    if (!request) return;
    const changed = await tx.chatRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "FAILED" },
    });
    if (!changed.count) return;
    const wallet = await tx.wallet.update({
      where: { userId: request.userId },
      data: { balance: { increment: request.coins } },
    });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: request.coins,
        reason: "聊天失败退回",
        refType: "REFUND",
        refId: id,
      },
    });
  });
}
