import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "./db";
import { HttpError } from "./http";
import {
  capabilities,
  features,
  providerPresets,
  providerKinds,
  validApiKey,
  requiredStages,
  emptyModelConfiguration,
  type ModelConfiguration,
} from "./model-catalog";

const schema = z.object({
  version: z.number().int().min(0),
  reason: z.string().trim().min(2).max(200),
  config: z.object({
    chatMode: z.enum(["AUTO", "DEMO", "LIVE"]).optional(),
    textModeration: z.enum(["OPENAI", "CHAT_MODEL"]).optional(),
    providers: z
      .array(
        z.object({
          id: z.uuid(),
          name: z.string().trim().min(1).max(60),
          kind: z.enum(providerKinds),
          enabled: z.boolean(),
          apiKey: z.string().trim().max(500).optional(),
          clearKey: z.boolean().optional(),
        }),
      )
      .max(20),
    models: z
      .array(
        z.object({
          id: z.uuid(),
          providerId: z.uuid(),
          name: z.string().trim().min(1).max(60),
          model: z
            .string()
            .trim()
            .min(1)
            .max(120)
            .regex(/^[a-zA-Z0-9._:/-]+$/),
          capability: z.enum(capabilities),
          enabled: z.boolean(),
          voice: z
            .string()
            .trim()
            .max(60)
            .regex(/^[a-zA-Z0-9_-]*$/),
        }),
      )
      .max(100),
    routes: z
      .array(
        z.object({
          feature: z.enum(features),
          enabled: z.boolean(),
          coins: z.number().int().min(1).max(1000),
          stages: z.object({
            CHAT: z.array(z.uuid()).max(2).optional(),
            IMAGE: z.array(z.uuid()).max(2).optional(),
            STT: z.array(z.uuid()).max(2).optional(),
            TTS: z.array(z.uuid()).max(2).optional(),
          }),
        }),
      )
      .length(3),
  }),
});
function encryptionKey() {
  const value = process.env.AI_CONFIG_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new HttpError(503, "请先配置服务端 AI_CONFIG_ENCRYPTION_KEY");
  return Buffer.from(value, "hex");
}
export function encryptSecret(secret: string, id: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(id));
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((b) => b.toString("base64"))
    .join(".");
}
export function decryptSecret(value: string, id: string) {
  const [iv, tag, data] = value.split(".").map((s) => Buffer.from(s, "base64"));
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(id));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
export function validateConfiguration(config: ModelConfiguration) {
  for (const values of [config.providers, config.models]) {
    if (new Set(values.map((v) => v.id)).size !== values.length)
      throw new HttpError(400, "配置编号不能重复");
  }
  if (new Set(config.routes.map((r) => r.feature)).size !== 3)
    throw new HttpError(400, "每项功能必须有且只有一个路由");
  for (const model of config.models) {
    const provider = config.providers.find((p) => p.id === model.providerId);
    if (
      !provider ||
      !(
        providerPresets[provider.kind].capabilities as readonly string[]
      ).includes(model.capability)
    )
      throw new HttpError(400, "模型能力与供应商接口不匹配");
    if (model.capability === "TTS" && !model.voice)
      throw new HttpError(400, "语音合成模型必须指定声音");
  }
  for (const route of config.routes) {
    for (const capability of capabilities) {
      const ids = route.stages[capability] || [];
      if (ids.length && !requiredStages[route.feature].includes(capability))
        throw new HttpError(400, "路由包含不支持的步骤");
      if (
        route.enabled &&
        requiredStages[route.feature].includes(capability) &&
        !ids.length
      )
        throw new HttpError(400, "启用前必须配置全部处理步骤");
      if (new Set(ids).size !== ids.length)
        throw new HttpError(400, "主模型和备用模型不能相同");
      for (const id of ids) {
        const model = config.models.find((m) => m.id === id);
        const provider = config.providers.find(
          (p) => p.id === model?.providerId,
        );
        if (!model || model.capability !== capability || !provider)
          throw new HttpError(400, "路由模型能力不匹配");
        if (
          route.enabled &&
          (!model.enabled || !provider.enabled || !provider.encryptedKey)
        )
          throw new HttpError(400, "启用的路由必须使用已启用且配置密钥的模型");
      }
    }
  }
}
export async function loadModelConfiguration() {
  const saved = await prisma.aIConfiguration.findUnique({
    where: { id: "main" },
  });
  return {
    version: saved?.version || 0,
    config: saved
      ? (saved.config as unknown as ModelConfiguration)
      : emptyModelConfiguration(),
  };
}
export function redactConfiguration(config: ModelConfiguration) {
  return {
    ...config,
    providers: config.providers.map(({ encryptedKey, ...p }) => ({
      ...p,
      hasKey: !!encryptedKey,
      keyValid: encryptedKey
        ? validApiKey(decryptSecret(encryptedKey, p.id))
        : undefined,
    })),
  };
}
export async function saveModelConfiguration(actorId: string, body: unknown) {
  const input = schema.parse(body);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(819431)`;
    const actor = await tx.user.findFirst({
      where: { id: actorId, role: "ADMIN", status: "ACTIVE" },
    });
    if (!actor) throw new HttpError(403, "管理员权限已失效");
    const saved = await tx.aIConfiguration.findUnique({
      where: { id: "main" },
    });
    if ((saved?.version || 0) !== input.version)
      throw new HttpError(409, "配置已更新，请刷新后再修改");
    const previous = saved?.config as unknown as ModelConfiguration | undefined;
    const config: ModelConfiguration = {
      ...input.config,
      providers: input.config.providers.map(({ apiKey, clearKey, ...p }) => {
        if (apiKey && !validApiKey(apiKey))
          throw new HttpError(
            400,
            "API Key 格式异常，请只粘贴供应商生成的纯密钥，不要包含中文、空白或说明文字",
          );
        const old = previous?.providers.find(
          (v) => v.id === p.id && v.kind === p.kind,
        );
        const encryptedKey = clearKey
          ? undefined
          : apiKey
            ? encryptSecret(apiKey, p.id)
            : old?.encryptedKey;
        if (p.enabled && !encryptedKey)
          throw new HttpError(400, "启用供应商前请填写 API Key");
        return { ...p, ...(encryptedKey ? { encryptedKey } : {}) };
      }),
    };
    validateConfiguration(config);
    const version = input.version + 1;
    await tx.aIConfiguration.upsert({
      where: { id: "main" },
      create: {
        id: "main",
        version,
        config: JSON.parse(JSON.stringify(config)),
      },
      update: { version, config: JSON.parse(JSON.stringify(config)) },
    });
    await tx.adminAudit.create({
      data: {
        actorId,
        action: "model-config",
        entityId: "main",
        detail: {
          version,
          reason: input.reason,
          providers: config.providers.length,
          models: config.models.length,
          enabledFeatures: config.routes
            .filter((r) => r.enabled)
            .map((r) => r.feature),
          chatMode: config.chatMode || "AUTO",
          textModeration: config.textModeration || "OPENAI",
        },
      },
    });
    return { version, config: redactConfiguration(config) };
  });
}
