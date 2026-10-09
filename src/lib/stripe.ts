import Stripe from "stripe";
export function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("支付服务尚未配置");
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    timeout: 20000,
    maxNetworkRetries: 1,
  });
}
