import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";
const base = process.env.APP_URL || "http://localhost:3100";
async function req(path: string, cookie = "", body?: object) {
  return fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: base,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
test("admin console enforces authorization and audited business changes", async (t) => {
  const id = randomUUID();
  const password = "Admin-integration-2026!";
  const email = "admin-qa-" + id + "@example.test";
  const username = "qa-" + id.slice(0, 20);
  const memberEmail = "member-qa-" + id + "@example.test";
  const admin = await prisma.user.create({
    data: {
      email,
      adminUsername: username,
      passwordHash: await bcrypt.hash(password, 12),
      role: "ADMIN",
      nickname: "验收管理员",
      wallet: { create: {} },
    },
  });
  let adminCookie = "",
    memberCookie = "",
    memberId = "",
    characterId = "";
  await t.test(
    "registration cannot grant admin role and regular accounts cannot use admin login",
    async () => {
      const response = await req("/api/auth", "", {
        mode: "register",
        email: memberEmail,
        password,
        nickname: "后台验收用户",
        role: "ADMIN",
      });
      assert.equal(response.status, 200);
      memberCookie = response.headers.get("set-cookie")!.split(";")[0];
      const user = await (await req("/api/auth", memberCookie)).json();
      memberId = user.user.id;
      assert.equal(user.user.role, "USER");
      assert.equal(
        (
          await req("/api/admin/login", "", {
            username: "missing-user",
            password,
          })
        ).status,
        401,
      );
      assert.equal(
        (await req("/api/auth", "", { mode: "login", email, password })).status,
        403,
      );
      assert.equal(
        (
          await req("/api/admin/login", "", {
            username,
            password: "Wrong-password-2026",
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await req("/api/auth", "", {
            mode: "login",
            email: memberEmail,
            password,
            adminOnly: true,
          })
        ).status,
        403,
      );
    },
  );
  await t.test("all admin resources reject guests and members", async () => {
    for (const resource of [
      "overview",
      "users",
      "characters",
      "orders",
      "ledger",
      "audit",
      "requests",
      "settings",
    ]) {
      assert.equal((await req("/api/admin/" + resource)).status, 401);
      assert.equal(
        (await req("/api/admin/" + resource, memberCookie)).status,
        403,
      );
    }
    assert.equal(
      (
        await req("/api/admin/actions", memberCookie, {
          action: "user-status",
          id: admin.id,
          status: "FROZEN",
          reason: "非法请求",
        })
      ).status,
      403,
    );
  });
  await t.test(
    "administrator can authenticate and read real operational data",
    async () => {
      const response = await req("/api/admin/login", "", {
        username,
        password,
      });
      assert.equal(response.status, 200);
      adminCookie = response.headers.get("set-cookie")!.split(";")[0];
      for (const resource of [
        "overview",
        "users",
        "characters",
        "orders",
        "ledger",
        "audit",
        "requests",
        "settings",
      ])
        assert.equal(
          (await req("/api/admin/" + resource, adminCookie)).status,
          200,
        );
      const data = await (
        await req(
          "/api/admin/users?q=" + encodeURIComponent(memberEmail),
          adminCookie,
        )
      ).json();
      assert.equal(data.items[0].passwordHash, undefined);
      assert.equal(
        (
          await req("/api/admin/actions", adminCookie, {
            action: "user-status",
            id: admin.id,
            status: "FROZEN",
            reason: "冻结自身",
          })
        ).status,
        409,
      );
    },
  );
  await t.test(
    "private drafts are hidden until owner submits, then moderation and archiving work",
    async () => {
      const created = await (
        await req("/api/characters", memberCookie, {
          name: "审核-" + id.slice(0, 8),
          title: "审核流程测试",
          greeting: "你好",
          systemPrompt: "你是一个友好的测试角色，不冒充真人。",
          tags: ["测试"],
        })
      ).json();
      characterId = created.id;
      const hidden = await (
        await req(
          "/api/admin/characters?q=" +
            encodeURIComponent("审核-" + id.slice(0, 8)),
          adminCookie,
        )
      ).json();
      assert.equal(hidden.items.length, 0);
      assert.equal(
        (
          await req(
            "/api/characters/" + characterId + "/submit",
            adminCookie,
            {},
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await req(
            "/api/characters/" + characterId + "/submit",
            memberCookie,
            {},
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await req("/api/admin/actions", adminCookie, {
            action: "character-status",
            id: characterId,
            expectedStatus: "REVIEWING",
            status: "PUBLISHED",
            reason: "内容已人工复核",
          })
        ).status,
        200,
      );
      assert.equal((await req("/api/characters/" + characterId)).status, 200);
      assert.equal(
        (
          await req("/api/admin/actions", adminCookie, {
            action: "character-status",
            id: characterId,
            expectedStatus: "REVIEWING",
            status: "REJECTED",
            reason: "过期操作",
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await req("/api/admin/actions", adminCookie, {
            action: "character-status",
            id: characterId,
            expectedStatus: "PUBLISHED",
            status: "ARCHIVED",
            reason: "测试下架",
          })
        ).status,
        200,
      );
      assert.equal((await req("/api/characters/" + characterId)).status, 404);
    },
  );
  await t.test(
    "concurrent identical wallet adjustments are applied once and cannot overdraw",
    async () => {
      const body = {
        action: "wallet-adjust",
        id: memberId,
        requestId: randomUUID(),
        amount: 10,
        reason: "测试运营补偿",
      };
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          req("/api/admin/actions", adminCookie, body),
        ),
      );
      assert.ok(
        responses.every((r) => r.status === 200),
        await Promise.all(responses.map((r) => r.text())).then((v) =>
          v.join("\n"),
        ),
      );
      assert.equal(
        (await prisma.wallet.findUniqueOrThrow({ where: { userId: memberId } }))
          .balance,
        40,
      );
      assert.equal(
        (await req("/api/admin/actions", adminCookie, { ...body, amount: 20 }))
          .status,
        409,
      );
      assert.equal(
        (
          await req("/api/admin/actions", adminCookie, {
            ...body,
            requestId: randomUUID(),
            amount: -100,
          })
        ).status,
        409,
      );
      const wallet = await prisma.wallet.findUniqueOrThrow({
        where: { userId: memberId },
      });
      const sum = await prisma.walletTransaction.aggregate({
        where: { walletId: wallet.id },
        _sum: { amount: true },
      });
      assert.equal(sum._sum.amount, wallet.balance);
    },
  );
  await t.test(
    "freezing revokes existing sessions and recovery permits fresh login",
    async () => {
      assert.equal(
        (
          await req("/api/admin/actions", adminCookie, {
            action: "user-status",
            id: memberId,
            status: "FROZEN",
            reason: "验收冻结",
          })
        ).status,
        200,
      );
      assert.equal((await req("/api/wallet", memberCookie)).status, 401);
      assert.equal(
        (
          await req("/api/auth", "", {
            mode: "login",
            email: memberEmail,
            password,
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await req("/api/admin/actions", adminCookie, {
            action: "user-status",
            id: memberId,
            status: "ACTIVE",
            reason: "验收恢复",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await req("/api/auth", "", {
            mode: "login",
            email: memberEmail,
            password,
          })
        ).status,
        200,
      );
      assert.equal((await req("/api/wallet", memberCookie)).status, 401);
    },
  );
  await t.test(
    "audit events are recorded and same-origin checks apply",
    async () => {
      const events = await prisma.adminAudit.count({
        where: { actorId: admin.id },
      });
      assert.ok(events >= 5);
      const response = await fetch(base + "/api/admin/actions", {
        method: "POST",
        headers: { Origin: "https://evil.test", Cookie: adminCookie },
        body: "{}",
      });
      assert.equal(response.status, 403);
    },
  );
  await prisma.$disconnect();
});
