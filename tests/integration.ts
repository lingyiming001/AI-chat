import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { refundRequest, settleOrder } from "../src/lib/billing";
import Stripe from "stripe";
import { POST as webhook } from "../src/app/api/webhooks/stripe/route";
const base = process.env.APP_URL || "http://localhost:3100";
let cookie = "";
async function request(
  path: string,
  body?: object,
  customCookie = cookie,
  method?: string,
) {
  return fetch(base + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      origin: base,
      "Content-Type": "application/json",
      cookie: customCookie,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
test("authenticated business flows and financial invariants", async (t) => {
  const suffix = randomUUID();
  const email = "qa-" + suffix + "@example.test";
  const password = "Quality-check-2026!";
  await t.test(
    "unauthorized and cross-origin mutations are rejected",
    async () => {
      assert.equal((await request("/api/wallet", undefined, "")).status, 401);
      assert.equal(
        (
          await fetch(base + "/api/auth", {
            method: "POST",
            headers: { origin: "https://attacker.test" },
            body: "{}",
          })
        ).status,
        403,
      );
    },
  );
  await t.test(
    "registration issues HttpOnly session and welcome balance",
    async () => {
      const response = await request("/api/auth", {
        mode: "register",
        email,
        password,
        nickname: "验收用户",
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("set-cookie")!, /httponly/i);
      cookie = response.headers.get("set-cookie")!.split(";")[0];
      assert.equal((await (await request("/api/wallet")).json()).balance, 30);
    },
  );
  await t.test(
    "character prompts are private, custom character persists",
    async () => {
      const list = await (await request("/api/characters")).json();
      assert.ok(list.characters.length >= 8);
      assert.equal(list.characters[0].systemPrompt, undefined);
      const created = await (
        await request("/api/characters", {
          name: "验收私密角色",
          title: "数据隔离测试",
          greeting: "你好",
          systemPrompt: "你是专用于测试的友好 AI 角色。",
          tags: ["测试"],
        })
      ).json();
      assert.ok(created.id);
      assert.equal(
        (await request("/api/characters/" + created.id, undefined, "")).status,
        404,
      );
      assert.equal(
        (await request("/api/characters/" + created.id)).status,
        200,
      );
    },
  );
  await t.test("chat persists and duplicate request charges once", async () => {
    const body = {
      characterId: "luna-strategist",
      content: "帮我制定一个学习计划",
      requestId: randomUUID(),
    };
    const response = await request("/api/chat", body);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /"type":"done"/);
    const replay = await request("/api/chat", body);
    assert.match(await replay.text(), /"replay":true/);
    assert.equal((await (await request("/api/wallet")).json()).balance, 28);
    const history = await (
      await request("/api/characters/luna-strategist")
    ).json();
    assert.equal(history.messages.length, 2);
    const forged = await request("/api/chat", {
      ...body,
      content: "different",
    });
    assert.equal(forged.status, 409);
  });
  await t.test("repeated recharge request credits once", async () => {
    const body = { planId: "starter", requestId: randomUUID() };
    assert.equal((await request("/api/orders", body)).status, 200);
    assert.equal((await request("/api/orders", body)).status, 200);
    assert.equal((await (await request("/api/wallet")).json()).balance, 128);
    assert.equal(
      (
        await request("/api/orders", {
          planId: "forged",
          requestId: randomUUID(),
        })
      ).status,
      400,
    );
  });
  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    include: { wallet: true },
  });
  await t.test("concurrent settlement and refunds are idempotent", async () => {
    const order = await prisma.order.create({
      data: { userId: user.id, amountCents: 990, coins: 100, provider: "demo" },
    });
    await Promise.all(
      Array.from({ length: 8 }, () =>
        settleOrder(order.id, "test-" + order.id, 990),
      ),
    );
    assert.equal(
      (await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } }))
        .balance,
      228,
    );
    await assert.rejects(settleOrder(order.id, "test-" + order.id, 1));
    const req = await prisma.chatRequest.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        characterId: "luna-strategist",
        content: "simulate failure",
        coins: 2,
      },
    });
    await prisma.wallet.update({
      where: { userId: user.id },
      data: { balance: { decrement: 2 } },
    });
    await prisma.walletTransaction.create({
      data: {
        walletId: user.wallet!.id,
        amount: -2,
        reason: "测试预扣",
        refType: "CHAT",
        refId: req.id,
      },
    });
    await Promise.all(Array.from({ length: 8 }, () => refundRequest(req.id)));
    assert.equal(
      (await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } }))
        .balance,
      228,
    );
    const sum = await prisma.walletTransaction.aggregate({
      where: { walletId: user.wallet!.id },
      _sum: { amount: true },
    });
    assert.equal(sum._sum.amount, 228);
  });
  await t.test("insufficient balance cannot generate or overdraw", async () => {
    await prisma.wallet.update({
      where: { userId: user.id },
      data: { balance: 0 },
    });
    const response = await request("/api/chat", {
      characterId: "kai-coder",
      content: "余额不足测试",
      requestId: randomUUID(),
    });
    assert.equal(response.status, 402);
    assert.equal(
      (await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } }))
        .balance,
      0,
    );
    await prisma.wallet.update({
      where: { userId: user.id },
      data: { balance: 228 },
    });
  });
  await t.test(
    "logout revokes session and credentials can log back in",
    async () => {
      assert.equal(
        (await request("/api/auth", undefined, cookie, "DELETE")).status,
        200,
      );
      assert.equal((await request("/api/wallet")).status, 401);
      assert.equal(
        (
          await request("/api/auth", {
            mode: "login",
            email,
            password: "wrong-password",
          })
        ).status,
        401,
      );
      assert.equal(
        (await request("/api/auth", { mode: "login", email, password })).status,
        200,
      );
    },
  );
  await t.test("Stripe signatures, currency and replay are verified without external payment", async () => {
    const previousMode = process.env.APP_MODE;
    process.env.APP_MODE = "production";
    process.env.STRIPE_SECRET_KEY = "sk_test_local_fixture";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_fixture";
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const order = await prisma.order.create({ data: { userId: user.id, provider: "stripe", amountCents: 990, coins: 100, providerRef: "cs_" + suffix } });
    const payload = JSON.stringify({ id: "evt_" + suffix, type: "checkout.session.completed", data: { object: { id: "cs_" + suffix, payment_status: "paid", currency: "cny", amount_total: 990, metadata: { orderId: order.id } } } });
    const makeRequest = (body: string, signature: string) => new Request(base + "/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signature }, body });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    assert.equal((await webhook(makeRequest(payload, "invalid"))).status, 400);
    const foreign = payload.replace('"cny"', '"usd"');
    assert.equal((await webhook(makeRequest(foreign, stripe.webhooks.generateTestHeaderString({ payload: foreign, secret: process.env.STRIPE_WEBHOOK_SECRET })))).status, 400);
    const results = await Promise.all(Array.from({ length: 8 }, () => webhook(makeRequest(payload, signature))));
    assert.ok(results.every(r => r.status === 200));
    assert.equal((await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).balance, 328);
    const sum = await prisma.walletTransaction.aggregate({ where: { walletId: user.wallet!.id }, _sum: { amount: true } });
    assert.equal(sum._sum.amount, 328);
    process.env.APP_MODE = previousMode;
  });
  await prisma.$disconnect();
});
