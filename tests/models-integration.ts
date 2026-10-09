import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";
import {
  emptyModelConfiguration,
  type ModelConfiguration,
} from "../src/lib/model-catalog";
import { redis } from "../src/lib/limits";
const base = process.env.APP_URL || "http://localhost:3101";
if (new URL(base).port !== "3101")
  throw new Error("Use the isolated model test server on port 3101");
async function req(path: string, cookie = "", body?: object | FormData) {
  return fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: base,
      Cookie: cookie,
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(body
      ? { body: body instanceof FormData ? body : JSON.stringify(body) }
      : {}),
  });
}
test("model administration and multi-stage generation preserve financial and privacy invariants", async (t) => {
  const nonce = randomUUID();
  const password = "Model-test-password-2026";
  const username = "model-" + nonce.slice(0, 20);
  const admin = await prisma.user.create({
    data: {
      email: nonce + "@admin.test",
      adminUsername: username,
      role: "ADMIN",
      passwordHash: await bcrypt.hash(password, 12),
      wallet: { create: {} },
    },
  });
  const adminResponse = await req("/api/admin/login", "", {
    username,
    password,
  });
  assert.equal(adminResponse.status, 200);
  const adminCookie = adminResponse.headers.get("set-cookie")!.split(";")[0];
  const registered = await req("/api/auth", "", {
    mode: "register",
    email: nonce + "@member.test",
    password,
  });
  const cookie = registered.headers.get("set-cookie")!.split(";")[0];
  const otherResponse = await req("/api/auth", "", {
    mode: "register",
    email: nonce + "@other.test",
    password,
  });
  const other = otherResponse.headers.get("set-cookie")!.split(";")[0];
  const initial = await (await req("/api/admin/models", adminCookie)).json();
  const initialStored = await prisma.aIConfiguration.findUnique({
    where: { id: "main" },
  });
  const p1 = randomUUID(),
    p2 = randomUUID();
  const chat = randomUUID(),
    backup = randomUUID(),
    image = randomUUID(),
    stt = randomUUID(),
    tts = randomUUID();
  const config: ModelConfiguration = {
    ...emptyModelConfiguration(),
    providers: [
      {
        id: p1,
        name: "Mock primary",
        kind: "OPENAI",
        enabled: true,
        apiKey: "test-model-primary",
      },
      {
        id: p2,
        name: "Mock backup",
        kind: "DEEPSEEK",
        enabled: true,
        apiKey: "test-model-backup",
      },
    ],
    models: [
      {
        id: chat,
        providerId: p1,
        name: "Chat",
        model: "mock-chat",
        capability: "CHAT",
        enabled: true,
        voice: "",
      },
      {
        id: backup,
        providerId: p2,
        name: "Backup",
        model: "mock-backup",
        capability: "CHAT",
        enabled: true,
        voice: "",
      },
      ...(
        [
          [image, "IMAGE"],
          [stt, "STT"],
          [tts, "TTS"],
        ] as const
      ).map(([id, capability]) => ({
        id,
        providerId: p1,
        name: capability,
        model: "mock-" + capability.toLowerCase(),
        capability,
        enabled: true,
        voice: capability === "TTS" ? "alloy" : "",
      })),
    ],
  };
  config.routes = [
    {
      feature: "CHAT",
      enabled: true,
      coins: 1,
      stages: { CHAT: [chat, backup] },
    },
    {
      feature: "IMAGE",
      enabled: true,
      coins: 4,
      stages: { CHAT: [chat, backup], IMAGE: [image] },
    },
    {
      feature: "VOICE",
      enabled: true,
      coins: 3,
      stages: { STT: [stt], CHAT: [chat, backup], TTS: [tts] },
    },
  ];
  let version = initial.version;
  const characterResponse = await req("/api/characters", cookie, {
    name: "Pipeline test",
    title: "Private fixture",
    greeting: "hi",
    systemPrompt: "You are a helpful fictional testing character.",
    tags: [],
  });
  const characterId = (await characterResponse.json()).id;
  const compose = (
    feature: "IMAGE" | "VOICE",
    content = "画一棵树",
    requestId = randomUUID(),
  ) => {
    const form = new FormData();
    form.set("feature", feature);
    form.set("content", feature === "VOICE" ? "" : content);
    form.set("characterId", characterId);
    form.set("requestId", requestId);
    if (feature === "VOICE")
      form.set(
        "audio",
        new File(["test recording"], "recording.webm", { type: "audio/webm" }),
      );
    return form;
  };
  const balance = async () =>
    (await (await req("/api/auth", cookie)).json()).user.balance as number;
  const memberId = (await (await req("/api/auth", cookie)).json()).user.id;
  try {
    await t.test(
      "configuration endpoints require admin and keys remain private",
      async () => {
        assert.equal((await req("/api/admin/models")).status, 401);
        assert.equal((await req("/api/admin/models", cookie)).status, 403);
        const result = await req("/api/admin/models", adminCookie, {
          version,
          config,
          reason: "模型组合验收",
        });
        assert.equal(result.status, 200);
        const saved = await result.json();
        version = saved.version;
        const raw = JSON.stringify(saved);
        assert.ok(
          !raw.includes("test-model-") && !raw.includes("encryptedKey"),
        );
        const db = await prisma.aIConfiguration.findUnique({
          where: { id: "main" },
        });
        assert.ok(!JSON.stringify(db?.config).includes("test-model-"));
        assert.equal(
          (
            await req("/api/admin/models", adminCookie, {
              version: initial.version,
              config,
              reason: "过期版本验收",
            })
          ).status,
          409,
        );
        const invalid = structuredClone(config);
        invalid.models.find((m) => m.id === backup)!.capability = "IMAGE";
        assert.equal(
          (
            await req("/api/admin/models", adminCookie, {
              version,
              config: invalid,
              reason: "能力不匹配",
            })
          ).status,
          400,
        );
        const badKey = structuredClone(config);
        badKey.providers[0].apiKey = "包含说明的密钥 内容";
        const rejected = await req("/api/admin/models", adminCookie, {
          version,
          config: badKey,
          reason: "密钥格式验收",
        });
        assert.equal(rejected.status, 400);
        assert.ok((await rejected.json()).error.includes("API Key 格式异常"));
        assert.equal(
          (await req("/api/admin/models/catalog?providerId=" + p1)).status,
          401,
        );
        assert.equal(
          (await req("/api/admin/models/catalog?providerId=" + p1, cookie))
            .status,
          403,
        );
        const catalog = await req(
          "/api/admin/models/catalog?providerId=" + p1,
          adminCookie,
        );
        assert.equal(catalog.status, 200);
        assert.deepEqual((await catalog.json()).models, [
          "mock-backup",
          "mock-chat",
        ]);
      },
    );
    await t.test(
      "image pipeline persists attachments and duplicate replay charges once",
      async () => {
        const id = randomUUID();
        const before = await balance();
        const response = await req(
          "/api/compose",
          cookie,
          compose("IMAGE", "画一棵树", id),
        );
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.deepEqual(
          result.trace.map((s: { capability: string }) => s.capability),
          ["CHAT", "IMAGE"],
        );
        assert.equal(result.attachments[0].mimeType, "image/png");
        assert.equal(await balance(), before - 4);
        const replay = await req(
          "/api/compose",
          cookie,
          compose("IMAGE", "画一棵树", id),
        );
        assert.equal(replay.status, 200);
        assert.equal((await replay.json()).replay, true);
        assert.equal(await balance(), before - 4);
        assert.equal(
          (await req(result.attachments[0].url, cookie)).status,
          200,
        );
        assert.equal((await req(result.attachments[0].url, other)).status, 404);
        assert.equal((await req(result.attachments[0].url)).status, 401);
        assert.equal(
          (await req("/api/compose", cookie, compose("IMAGE", "不同需求", id)))
            .status,
          409,
        );
      },
    );
    await t.test(
      "voice composes recognition, character reply and synthetic audio",
      async () => {
        const before = await balance();
        const response = await req("/api/compose", cookie, compose("VOICE"));
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.deepEqual(
          result.trace.map((s: { capability: string }) => s.capability),
          ["STT", "CHAT", "TTS"],
        );
        assert.ok(result.content.includes("识别"));
        assert.equal(result.attachments[0].mimeType, "audio/mpeg");
        assert.equal(await balance(), before - 3);
        const history = await (
          await req("/api/characters/" + characterId, cookie)
        ).json();
        assert.ok(history.messages.at(-1).attachments.length);
      },
    );
    await t.test(
      "transient failure switches models; all failures refund and audit trace",
      async () => {
        const response = await req(
          "/api/compose",
          cookie,
          compose("IMAGE", "FAIL_PRIMARY"),
        );
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.deepEqual(
          result.trace.map((s: { status: string }) => s.status),
          ["FAILED", "OK", "OK"],
        );
        assert.equal(
          (await req("/api/compose", cookie, compose("IMAGE", "quota check")))
            .status,
          429,
        );
        await redis.del("limit:compose:" + memberId);
        const before = await balance(),
          id = randomUUID();
        const failed = await req(
          "/api/compose",
          cookie,
          compose("IMAGE", "FAIL_ALL", id),
        );
        assert.equal(failed.status, 503);
        assert.equal(await balance(), before);
        assert.equal(
          (await prisma.chatRequest.findUnique({ where: { id } }))?.status,
          "FAILED",
        );
        assert.equal(
          await prisma.walletTransaction.count({
            where: { refType: "REFUND", refId: id },
          }),
          1,
        );
        assert.equal(
          (await req("/api/compose", cookie, compose("IMAGE", "FAIL_ALL", id)))
            .status,
          409,
        );
        assert.equal(await balance(), before);
        const blocked = await req(
          "/api/compose",
          cookie,
          compose("IMAGE", "BLOCKED_CONTENT"),
        );
        assert.equal(blocked.status, 400);
        assert.equal(await balance(), before);
      },
    );
    await t.test(
      "configured text chat automatically uses the configured dialogue model",
      async () => {
        const response = await req("/api/chat", cookie, {
          characterId,
          content: "你好",
          requestId: randomUUID(),
        });
        assert.equal(response.status, 200);
        const raw = await response.text();
        assert.ok(raw.includes('"type":"done"'));
        const message = await prisma.chatMessage.findFirst({
          where: {
            session: {
              userId: (await (await req("/api/auth", cookie)).json()).user.id,
            },
          },
          orderBy: { createdAt: "desc" },
        });
        assert.equal(message?.model, "mock-chat");
      },
    );
    await t.test(
      "billing denial is actionable in chat, refunded and never leaks provider error bodies",
      async () => {
        const before = await balance(),
          id = randomUUID();
        const response = await req("/api/chat", cookie, {
          characterId,
          content: "BILLING_CHAT_FAIL",
          requestId: id,
        });
        assert.equal(response.status, 200);
        const raw = await response.text();
        assert.ok(raw.includes("账户欠费"));
        assert.ok(raw.includes("本次星币已退回"));
        assert.ok(!raw.includes("private-billing-response"));
        assert.equal(await balance(), before);
        const request = await prisma.chatRequest.findUnique({ where: { id } });
        assert.equal(request?.status, "FAILED");
        assert.equal(
          (request?.result as { trace: { errorCode: string }[] }).trace[0]
            .errorCode,
          "Arrearage",
        );
      },
    );
    await t.test(
      "model safety classification and explicit demo/live modes apply to real chat requests",
      async () => {
        const changed = await req("/api/admin/models", adminCookie, {
          version,
          config: { ...config, chatMode: "LIVE", textModeration: "CHAT_MODEL" },
          reason: "验收聊天模式与模型安全分类",
        });
        assert.equal(changed.status, 200);
        version = (await changed.json()).version;
        const before = await balance();
        for (const content of ["BLOCKED_CONTENT", "MALFORMED_CHECK"]) {
          const denied = await req("/api/chat", cookie, {
            characterId,
            content,
            requestId: randomUUID(),
          });
          assert.equal(
            denied.status,
            content === "BLOCKED_CONTENT" ? 400 : 503,
          );
          assert.equal(await balance(), before);
        }
        const live = await req("/api/chat", cookie, {
          characterId,
          content: "正常聊天",
          requestId: randomUUID(),
        });
        const text = await live.text();
        assert.ok(text.includes('"demo":false'));
        assert.ok(text.includes('"type":"done"'));
        assert.ok(!text.includes("【本地演示】"));
        const demo = await req("/api/admin/models", adminCookie, {
          version,
          config: { ...config, chatMode: "DEMO", textModeration: "CHAT_MODEL" },
          reason: "验收显式演示模式",
        });
        assert.equal(demo.status, 200);
        version = (await demo.json()).version;
        const demoReply = await req("/api/chat", cookie, {
          characterId,
          content: "模式验证",
          requestId: randomUUID(),
        });
        assert.ok((await demoReply.text()).includes("【本地演示】"));
      },
    );
  } finally {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(819431)`;
        if (initialStored) {
          const restored = await tx.aIConfiguration.updateMany({
            where: { id: "main", version },
            data: { version: version + 1, config: initialStored.config! },
          });
          assert.equal(
            restored.count,
            1,
            "Refuse to overwrite concurrent configuration changes",
          );
        } else {
          const deleted = await tx.aIConfiguration.deleteMany({
            where: { id: "main", version },
          });
          assert.equal(deleted.count, 1);
        }
        await tx.adminAudit.create({
          data: {
            actorId: admin.id,
            action: "model-test-restore",
            entityId: "main",
            detail: { reason: "恢复验收前完整加密配置", version: version + 1 },
          },
        });
      });
    } finally {
      await prisma.$disconnect();
      redis.disconnect();
    }
  }
});
