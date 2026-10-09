import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripeClient } from "@/lib/stripe";
import { settleOrder } from "@/lib/billing";
import { failure, HttpError } from "@/lib/http";
import { demoMode } from "@/lib/ai";
export async function POST(request: Request) {
  try {
    if (demoMode() || !process.env.STRIPE_WEBHOOK_SECRET)
      throw new HttpError(503, "支付回调未启用");
    const signature = request.headers.get("stripe-signature");
    if (!signature) throw new HttpError(400, "缺少签名");
    let event: Stripe.Event;
    try {
      event = stripeClient().webhooks.constructEvent(
        await request.text(),
        signature,
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch {
      throw new HttpError(400, "签名校验失败");
    }
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === "paid") {
        if (
          session.currency !== "cny" ||
          !session.metadata?.orderId ||
          session.amount_total == null
        )
          throw new HttpError(400, "订单信息不完整");
        await settleOrder(
          session.metadata.orderId,
          session.id,
          session.amount_total,
        );
      }
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    return failure(error);
  }
}
