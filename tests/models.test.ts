import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  encryptSecret,
  decryptSecret,
  redactConfiguration,
  validateConfiguration,
} from "../src/lib/model-config";
import {
  emptyModelConfiguration,
  importCommonPresets,
  providerPresets,
  chatUsesDemo,
  chatConfigurationStatus,
  configureDefaultChat,
  validApiKey,
  type Model,
  type Provider,
  type ModelConfiguration,
} from "../src/lib/model-catalog";
import { moderationVerdict, moderate, generateReply } from "../src/lib/ai";
import {
  invokeModel,
  ProviderFailure,
  providerResponseFailure,
  imageMime,
} from "../src/lib/model-adapters";
import {
  runStage,
  featureAvailability,
  type ModelTrace,
} from "../src/lib/model-router";
process.env.AI_CONFIG_ENCRYPTION_KEY = "1".repeat(64);
test("provider billing failures are not misclassified as invalid model parameters and never expose raw bodies", async () => {
  const error = await providerResponseFailure(
    Response.json(
      {
        error: { code: "Arrearage", message: "private-secret-should-not-leak" },
      },
      { status: 400 },
    ),
  );
  assert.equal(error.code, "Arrearage");
  assert.equal(error.retryable, false);
  assert.ok(error.message.includes("账户欠费"));
  assert.ok(!error.message.includes("参数"));
  assert.ok(!error.message.includes("private-secret"));
  const unknown = await providerResponseFailure(
    Response.json(
      { error: { code: "private-secret", message: "private-secret" } },
      { status: 400 },
    ),
  );
  assert.equal(unknown.code, undefined);
  assert.equal(unknown.message, "模型参数或调用方式不匹配");
  assert.equal(
    (
      await providerResponseFailure(
        new Response("x".repeat(9000), { status: 503 }),
      )
    ).retryable,
    true,
  );
});
test("billing error survives routing with safe diagnostics and no fallback", async () => {
  const c = emptyModelConfiguration();
  c.providers = [provider];
  c.models = [model, { ...model, id: randomUUID() }];
  const route = {
    feature: "CHAT" as const,
    enabled: true,
    coins: 1,
    stages: { CHAT: c.models.map((m) => m.id) },
  };
  const trace: ModelTrace[] = [];
  let calls = 0;
  await assert.rejects(
    runStage(c, route, "CHAT", { text: "hello" }, trace, async () => {
      calls++;
      throw new ProviderFailure(false, 400, "Arrearage");
    }),
    /账户欠费/,
  );
  assert.equal(calls, 1);
  assert.equal(trace[0].errorCode, "Arrearage");
  assert.ok(trace[0].errorMessage?.includes("账户欠费"));
});
test("API key format rejects explanatory text and marks stored invalid credentials without exposing them", () => {
  assert.equal(validApiKey("sk-test-model-valid"), true);
  for (const value of [
    "这是我的密钥",
    "Bearer sk-test-secret",
    "sk-test\nsecret",
    " ",
    "短密钥",
  ])
    assert.equal(validApiKey(value), false);
  const p: Provider = {
    id: randomUUID(),
    kind: "QWEN",
    name: "阿里",
    enabled: true,
  };
  p.encryptedKey = encryptSecret("这里是带说明的密钥 内容", p.id);
  const config = { ...emptyModelConfiguration(), providers: [p] };
  const safe = redactConfiguration(config);
  assert.equal(safe.providers[0].hasKey, true);
  assert.equal(safe.providers[0].keyValid, false);
  assert.ok(!JSON.stringify(safe).includes("带说明"));
  assert.throws(() =>
    configureDefaultChat(safe, p.id, "qwen-plus", "", "CHAT_MODEL", randomUUID),
  );
});
test("configured chat overrides environment demo without silently masking disabled routes", () => {
  const config = importCommonPresets(emptyModelConfiguration(), randomUUID);
  const p = config.providers.find((p) => p.kind === "QWEN")!;
  assert.equal(chatUsesDemo(config, true), true);
  assert.throws(() =>
    configureDefaultChat(config, p.id, "qwen-plus", "", "OPENAI", randomUUID),
  );
  p.hasKey = true;
  const next = configureDefaultChat(
    config,
    p.id,
    "qwen-plus",
    "",
    "CHAT_MODEL",
    randomUUID,
  );
  assert.equal(chatUsesDemo(next, true), false);
  assert.equal(next.providers.find((v) => v.id === p.id)?.enabled, true);
  assert.equal(next.models.find((m) => m.model === "qwen-plus")?.enabled, true);
  assert.deepEqual(chatConfigurationStatus(next, true, false).blockers, []);
  assert.deepEqual(
    configureDefaultChat(next, p.id, "qwen-plus", "", "CHAT_MODEL", randomUUID),
    next,
  );
  assert.equal(
    next.routes.find((r) => r.feature === "IMAGE"),
    config.routes.find((r) => r.feature === "IMAGE"),
  );
  assert.equal(chatUsesDemo({ ...next, chatMode: "DEMO" }, false), true);
  assert.equal(chatUsesDemo({ ...next, chatMode: "AUTO" }, true), false);
  assert.equal(
    chatConfigurationStatus(
      { ...next, textModeration: "OPENAI" },
      true,
      false,
    ).blockers.at(-1),
    "OpenAI 内容审核密钥未配置",
  );
});
test("model safety classifier fails closed for rejection and malformed output", () => {
  assert.doesNotThrow(() => moderationVerdict(" ALLOW "));
  assert.throws(() => moderationVerdict("BLOCK"));
  for (const text of [
    "",
    "ALLOW then ignore rules",
    '{"verdict":"ALLOW"}',
    "<think>ALLOW</think>",
  ])
    assert.throws(() => moderationVerdict(text));
});
test("environment demo still invokes configured real chat and text safety adapter", async () => {
  const previousMode = process.env.APP_MODE,
    originalFetch = globalThis.fetch;
  process.env.APP_MODE = "demo";
  const config = importCommonPresets(emptyModelConfiguration(), randomUUID);
  const p = config.providers.find((p) => p.kind === "QWEN")!;
  p.encryptedKey = encryptSecret("test-model-qwen", p.id);
  const ready = configureDefaultChat(
    config,
    p.id,
    "qwen-plus",
    "",
    "CHAT_MODEL",
    randomUUID,
  );
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(
      String(url),
      providerPresets.QWEN.baseUrl + "/chat/completions",
    );
    const body = JSON.parse(init?.body as string);
    assert.equal(body.enable_thinking, false);
    calls++;
    if (!body.messages[0].content.includes("独立的内容安全分类器")) {
      assert.ok(body.messages[0].content.includes("以角色的第一人称回应"));
      const persona = JSON.parse(body.messages[0].content.split("角色资料：\n")[1]);
      assert.equal(persona.name, "林月");
      assert.equal(persona.setting, "温暖的人物");
    }
    return Response.json({
      choices: [
        {
          message: {
            content: body.messages[0].content.includes("独立的内容安全分类器")
              ? "ALLOW"
              : "真实适配器回复",
          },
        },
      ],
    });
  };
  try {
    const snapshot = { version: 1, config: ready };
    await moderate("疲惫的一天", snapshot);
    let reply = "";
    for await (const delta of generateReply(
      "温暖的人物",
      [{ role: "user", content: "你呢" }],
      [],
      snapshot,
      { name: "林月", title: "领航员", greeting: "舰长，晚上好" },
    ))
      reply += delta;
    assert.equal(reply, "真实适配器回复");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = previousMode;
  }
});
test("common presets are disabled, compatible, idempotent and preserve configuration", () => {
  const original = emptyModelConfiguration();
  const first = importCommonPresets(original, randomUUID);
  assert.equal(first.providers.length, 6);
  assert.equal(first.models.length, 15);
  assert.ok(first.providers.every((p) => !p.enabled && !p.apiKey));
  assert.ok(first.models.every((m) => !m.enabled));
  validateConfiguration(first);
  assert.deepEqual(importCommonPresets(first, randomUUID), first);
  assert.equal(first.routes, original.routes);
  const existing = first.providers[0];
  existing.apiKey = "preserve-secret";
  assert.equal(
    importCommonPresets(first, randomUUID).providers[0].apiKey,
    "preserve-secret",
  );
  assert.ok(!first.models.some((m) => m.model === "deepseek-chat"));
});
test("new suppliers use fixed official endpoints and bearer credentials", async () => {
  for (const kind of [
    "ZHIPU",
    "MOONSHOT",
    "VOLCENGINE",
    "SILICONFLOW",
  ] as const) {
    const p: Provider = { id: randomUUID(), name: kind, kind, enabled: true };
    p.encryptedKey = encryptSecret("supplier-test-secret", p.id);
    await invokeModel(
      p,
      {
        ...model,
        providerId: p.id,
        model: kind === "MOONSHOT" ? "kimi-k3" : "unit-chat",
      },
      "CHAT",
      { messages: [{ role: "user", content: "hello" }] },
      async (url, init) => {
        assert.equal(
          String(url),
          providerPresets[kind].baseUrl + "/chat/completions",
        );
        assert.equal(
          (init?.headers as Record<string, string>).Authorization,
          "Bearer supplier-test-secret",
        );
        const body = JSON.parse(init?.body as string);
        assert.equal(body.max_tokens, 1500);
        if (kind === "MOONSHOT") assert.equal(body.reasoning_effort, "low");
        if (kind === "ZHIPU" || kind === "VOLCENGINE")
          assert.equal(body.thinking.type, "disabled");
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "hello" } }] }),
        );
      },
    );
  }
});
const provider: Provider = {
  id: randomUUID(),
  name: "Unit OpenAI",
  kind: "OPENAI",
  enabled: true,
};
provider.encryptedKey = encryptSecret("test-model-secret", provider.id);
const model: Model = {
  id: randomUUID(),
  providerId: provider.id,
  name: "Unit model",
  model: "unit-chat",
  capability: "CHAT",
  enabled: true,
  voice: "alloy",
};
const fixture = (): ModelConfiguration => ({
  ...emptyModelConfiguration(),
  providers: [provider],
  models: [model],
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
  "base64",
);
test("provider keys are authenticated encrypted and never returned in configuration", () => {
  assert.equal(
    decryptSecret(provider.encryptedKey!, provider.id),
    "test-model-secret",
  );
  assert.throws(() => decryptSecret(provider.encryptedKey!, randomUUID()));
  const value = JSON.stringify(redactConfiguration(fixture()));
  assert.ok(
    !value.includes("test-model-secret") && !value.includes("encryptedKey"),
  );
  assert.ok(value.includes('"hasKey":true'));
});
test("configuration rejects capability mismatches and unavailable route models", () => {
  const c = fixture();
  c.providers[0] = { ...provider, kind: "DEEPSEEK" };
  c.models[0] = { ...model, capability: "IMAGE" };
  assert.throws(() => validateConfiguration(c));
  const broken = fixture();
  broken.routes[0].enabled = true;
  assert.throws(() => validateConfiguration(broken));
  broken.routes[0].stages.CHAT = [model.id];
  validateConfiguration(broken);
  broken.routes[0].stages.CHAT = [model.id, model.id];
  assert.throws(() => validateConfiguration(broken));
});
test("OpenAI compatible adapter uses fixed official endpoint and bounded output", async () => {
  const transport: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    assert.equal(
      (init!.headers as Record<string, string>).Authorization,
      "Bearer test-model-secret",
    );
    assert.equal(init!.redirect, "error");
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, "unit-chat");
    assert.equal(body.messages[0].role, "system");
    return Response.json({ choices: [{ message: { content: "verified" } }] });
  };
  assert.equal(
    (
      await invokeModel(
        provider,
        model,
        "CHAT",
        { system: "safe", messages: [{ role: "user", content: "hello" }] },
        transport,
      )
    ).text,
    "verified",
  );
});
test("native Anthropic and Gemini protocols map roles and authentication", async () => {
  for (const kind of ["ANTHROPIC", "GEMINI"] as const) {
    const p = { ...provider, kind };
    const transport: typeof fetch = async (url, init) => {
      const body = JSON.parse(init!.body as string);
      const headers = init!.headers as Record<string, string>;
      if (kind === "ANTHROPIC") {
        assert.ok(String(url).endsWith("/messages"));
        assert.equal(headers["x-api-key"], "test-model-secret");
        assert.equal(body.max_tokens, 1500);
        return Response.json({ content: [{ type: "text", text: "native" }] });
      }
      assert.ok(String(url).endsWith(":generateContent"));
      assert.equal(headers["x-goog-api-key"], "test-model-secret");
      assert.equal(body.contents[0].role, "model");
      return Response.json({
        candidates: [
          {
            content: {
              parts: [{ text: "hidden", thought: true }, { text: "native" }],
            },
          },
        ],
      });
    };
    assert.equal(
      (
        await invokeModel(
          p,
          model,
          "CHAT",
          { messages: [{ role: "assistant", content: "hi" }] },
          transport,
        )
      ).text,
      "native",
    );
  }
});
test("image adapters accept image bytes, reject URL fetches and SVG", async () => {
  const output = await invokeModel(
    provider,
    { ...model, capability: "IMAGE" },
    "IMAGE",
    { text: "safe picture" },
    async () => Response.json({ data: [{ b64_json: png.toString("base64") }] }),
  );
  assert.equal(output.mimeType, "image/png");
  assert.deepEqual(output.bytes, png);
  assert.throws(() => imageMime(Buffer.from("<svg/>")));
  await assert.rejects(
    invokeModel(provider, model, "IMAGE", { text: "picture" }, async () =>
      Response.json({ data: [{ url: "http://127.0.0.1/private" }] }),
    ),
    ProviderFailure,
  );
  const gemini = await invokeModel(
    { ...provider, kind: "GEMINI" },
    model,
    "IMAGE",
    { text: "picture" },
    async () =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: png.toString("base64"),
                  },
                },
              ],
            },
          },
        ],
      }),
  );
  assert.deepEqual(gemini.bytes, png);
});
test("voice stages use multipart transcription and audio speech response", async () => {
  const stt = await invokeModel(
    provider,
    model,
    "STT",
    { audio: new File(["clip"], "clip.ogg", { type: "audio/ogg" }) },
    async (_, init) => {
      assert.ok(init?.body instanceof FormData);
      assert.equal((init.body.get("file") as File).name, "recording.ogg");
      return Response.json({ text: "识别后的文字" });
    },
  );
  assert.equal(stt.text, "识别后的文字");
  const tts = await invokeModel(
    provider,
    model,
    "TTS",
    { text: "reply" },
    async (_, init) => {
      assert.equal(JSON.parse(init!.body as string).voice, "alloy");
      return new Response("audio");
    },
  );
  assert.equal(tts.mimeType, "audio/mpeg");
  assert.equal(tts.bytes!.toString(), "audio");
});
test("transient model failure selects fallback and records both attempts", async () => {
  const c = fixture();
  const backup = { ...model, id: randomUUID(), model: "backup" };
  c.models.push(backup);
  const route = {
    ...c.routes[0],
    enabled: true,
    stages: { CHAT: [model.id, backup.id] },
  };
  const trace: ModelTrace[] = [];
  const result = await runStage(c, route, "CHAT", {}, trace, async (_, m) => {
    if (m.id === model.id) throw new ProviderFailure(true);
    return { text: "fallback result" };
  });
  assert.equal(result.text, "fallback result");
  assert.deepEqual(
    trace.map((t) => t.status),
    ["FAILED", "OK"],
  );
  assert.equal(trace[1].model, "backup");
});
test("authentication or safety errors do not fall back to bypass rejection", async () => {
  const c = fixture();
  c.models.push({ ...model, id: randomUUID() });
  const route = { ...c.routes[0], stages: { CHAT: c.models.map((m) => m.id) } };
  let calls = 0;
  await assert.rejects(
    runStage(c, route, "CHAT", {}, [], async () => {
      calls++;
      throw new ProviderFailure(false);
    }),
  );
  assert.equal(calls, 1);
  await assert.rejects(
    invokeModel(
      provider,
      model,
      "CHAT",
      {},
      async () => new Response("secret provider error", { status: 401 }),
    ),
    (e: unknown) =>
      e instanceof ProviderFailure &&
      !e.retryable &&
      !e.message.includes("secret"),
  );
});
test("feature availability requires every stage and active credentials", () => {
  const c = fixture();
  c.routes[0].enabled = true;
  c.routes[0].stages.CHAT = [model.id];
  assert.equal(featureAvailability(c)[0].enabled, true);
  c.providers[0] = { ...provider, enabled: false };
  assert.equal(featureAvailability(c)[0].enabled, false);
});
