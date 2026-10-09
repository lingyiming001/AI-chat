import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { failure, HttpError, jsonBody, sameOrigin } from "@/lib/http";
import { plans, settleOrder } from "@/lib/billing";
import { demoMode } from "@/lib/ai";
import { stripeClient } from "@/lib/stripe";
import { limit } from "@/lib/limits";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    await limit("orders:" + user.id, 10);
    const data = z
      .object({ planId: z.string(), requestId: z.uuid() })
      .parse(await jsonBody(request));
    const plan = plans.find((p) => p.id === data.planId);
    if (!plan) throw new HttpError(400, "充值套餐不存在");
    const provider = demoMode() ? "demo" : "stripe";
    if (provider === "stripe" && !process.env.STRIPE_SECRET_KEY)
      throw new HttpError(503, "支付服务尚未配置");
    const order = await prisma.order.upsert({
      where: { id: data.requestId },
      create: {
        id: data.requestId,
        userId: user.id,
        provider,
        coins: plan.coins,
        amountCents: plan.amountCents,
      },
      update: {},
    });
    if (
      order.userId !== user.id ||
      order.amountCents !== plan.amountCents ||
      order.provider !== provider
    )
      throw new HttpError(409, "订单标识已使用");
    if (provider === "demo") {
      await settleOrder(order.id, "demo-" + order.id, plan.amountCents);
      return NextResponse.json({ demo: true, paid: true });
    }
    if (order.status === "PAID") return NextResponse.json({ paid: true });
    const stripe = stripeClient();
    const checkout = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: order.id,
        metadata: { orderId: order.id },
        line_items: [
          {
            price_data: {
              currency: "cny",
              product_data: { name: plan.coins + " 星币" },
              unit_amount: plan.amountCents,
            },
            quantity: 1,
          },
        ],
        success_url: process.env.APP_URL + "/recharge?payment=returned",
        cancel_url: process.env.APP_URL + "/recharge?payment=cancelled",
      },
      { idempotencyKey: order.id },
    );
    await prisma.order.update({
      where: { id: order.id },
      data: { providerRef: checkout.id },
    });
    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    return failure(error);
  }
}
