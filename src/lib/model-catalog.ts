export const capabilities = ["CHAT", "IMAGE", "STT", "TTS"] as const;
export type Capability = (typeof capabilities)[number];
export const features = ["CHAT", "IMAGE", "VOICE"] as const;
export type Feature = (typeof features)[number];
export const capabilityLabels: Record<Capability, string> = {
  CHAT: "对话",
  IMAGE: "图片生成",
  STT: "语音识别",
  TTS: "语音合成",
};
export const featureLabels: Record<Feature, string> = {
  CHAT: "文字聊天",
  IMAGE: "角色绘图",
  VOICE: "语音聊天",
};
export const providerPresets = {
  OPENAI: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    protocol: "openai",
    capabilities: ["CHAT", "IMAGE", "STT", "TTS"],
  },
  DEEPSEEK: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    protocol: "openai",
    capabilities: ["CHAT"],
  },
  QWEN: {
    name: "阿里云百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    protocol: "openai",
    capabilities: ["CHAT"],
  },
  ANTHROPIC: {
    name: "Anthropic / Claude",
    baseUrl: "https://api.anthropic.com/v1",
    protocol: "anthropic",
    capabilities: ["CHAT"],
  },
  GEMINI: {
    name: "Google / Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    protocol: "gemini",
    capabilities: ["CHAT", "IMAGE"],
  },
  ZHIPU: {
    name: "智谱 / GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    protocol: "openai",
    capabilities: ["CHAT"],
  },
  MOONSHOT: {
    name: "月之暗面 / Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    protocol: "openai",
    capabilities: ["CHAT"],
  },
  VOLCENGINE: {
    name: "火山引擎 / 豆包",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    protocol: "openai",
    capabilities: ["CHAT"],
  },
  SILICONFLOW: {
    name: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    protocol: "openai",
    capabilities: ["CHAT"],
  },
} as const;
export type ProviderKind = keyof typeof providerPresets;
export const providerKinds = Object.keys(providerPresets) as [
  ProviderKind,
  ...ProviderKind[],
];
export const providerConsoles: Record<ProviderKind, string> = {
  OPENAI: "https://platform.openai.com/api-keys",
  DEEPSEEK: "https://platform.deepseek.com/api_keys",
  QWEN: "https://bailian.console.aliyun.com/",
  ANTHROPIC: "https://console.anthropic.com/",
  GEMINI: "https://aistudio.google.com/apikey",
  ZHIPU: "https://bigmodel.cn/",
  MOONSHOT: "https://platform.kimi.com/",
  VOLCENGINE: "https://ark.volcengine.com/region:cn-beijing/apikey",
  SILICONFLOW: "https://cloud.siliconflow.cn/",
};
export const modelPresets: Partial<Record<ProviderKind, readonly string[]>> = {
  QWEN: ["qwen3.8-max", "qwen3.7-plus", "qwen3.8-flash"],
  DEEPSEEK: ["deepseek-flash", "deepseek-v4-pro"],
  ZHIPU: ["glm-5.3", "glm-5.2", "glm-4.7", "glm-4.7-flash"],
  MOONSHOT: ["kimi-k3", "kimi-k2.6"],
  VOLCENGINE: ["doubao-seed-2-1-pro-260915", "doubao-seed-2-1-lite-260915"],
  SILICONFLOW: ["deepseek-ai/DeepSeek-V4-Flash", "Qwen/Qwen3.5-397B-A17B"],
};
export function importCommonPresets(
  config: ModelConfiguration,
  uuid: () => string,
): ModelConfiguration {
  const providers = [...config.providers];
  const models = [...config.models];
  for (const kind of providerKinds) {
    if (!modelPresets[kind]?.length) continue;
    let provider = providers.find((p) => p.kind === kind);
    if (!provider) {
      provider = {
        id: uuid(),
        name: providerPresets[kind].name,
        kind,
        enabled: false,
      };
      providers.push(provider);
    }
    for (const model of modelPresets[kind]!) {
      if (
        models.some(
          (m) =>
            m.providerId === provider.id &&
            m.model === model &&
            m.capability === "CHAT",
        )
      )
        continue;
      models.push({
        id: uuid(),
        providerId: provider.id,
        name: model,
        model,
        capability: "CHAT",
        enabled: false,
        voice: "",
      });
    }
  }
  return { ...config, providers, models };
}
export type Provider = {
  id: string;
  name: string;
  kind: ProviderKind;
  enabled: boolean;
  encryptedKey?: string;
  apiKey?: string;
  hasKey?: boolean;
  keyValid?: boolean;
  clearKey?: boolean;
};
export type Model = {
  id: string;
  providerId: string;
  name: string;
  model: string;
  capability: Capability;
  enabled: boolean;
  voice: string;
};
export type Route = {
  feature: Feature;
  enabled: boolean;
  coins: number;
  stages: Partial<Record<Capability, string[]>>;
};
export type ModelConfiguration = {
  chatMode?: "AUTO" | "DEMO" | "LIVE";
  textModeration?: "OPENAI" | "CHAT_MODEL";
  providers: Provider[];
  models: Model[];
  routes: Route[];
};
export function chatUsesDemo(
  config: ModelConfiguration,
  environmentDemo: boolean,
) {
  if (config.chatMode === "DEMO") return true;
  if (config.chatMode === "LIVE") return false;
  return (
    environmentDemo &&
    !config.routes.some((r) => r.feature === "CHAT" && r.enabled)
  );
}
export function configureDefaultChat(
  config: ModelConfiguration,
  providerId: string,
  modelId: string,
  apiKey: string,
  moderation: "OPENAI" | "CHAT_MODEL",
  uuid: () => string,
): ModelConfiguration {
  const provider = config.providers.find((p) => p.id === providerId);
  if (!provider) throw new Error("请选择供应商");
  if (
    (apiKey.trim() && !validApiKey(apiKey.trim())) ||
    (!apiKey.trim() && provider.keyValid === false)
  )
    throw new Error(
      "API Key 格式异常，请只粘贴供应商生成的纯密钥，不要包含中文、空白或说明文字",
    );
  if (!/^[a-zA-Z0-9._:/-]{1,120}$/.test(modelId))
    throw new Error("请填写有效模型 ID");
  if (
    !apiKey.trim() &&
    !provider.hasKey &&
    !provider.encryptedKey &&
    !provider.apiKey
  )
    throw new Error("请填写 API Key");
  const selected = config.models.find(
    (m) =>
      m.providerId === providerId &&
      m.model === modelId &&
      m.capability === "CHAT",
  );
  const id = selected?.id || uuid();
  const model: Model = {
    id,
    providerId,
    model: modelId,
    name: selected?.name || modelId.slice(0, 60),
    capability: "CHAT",
    enabled: true,
    voice: "",
  };
  return {
    ...config,
    chatMode: "LIVE",
    textModeration: moderation,
    providers: config.providers.map((p) =>
      p.id === providerId
        ? {
            ...p,
            enabled: true,
            clearKey: false,
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          }
        : p,
    ),
    models: selected
      ? config.models.map((m) => (m.id === id ? model : m))
      : [...config.models, model],
    routes: config.routes.map((r) =>
      r.feature === "CHAT"
        ? {
            ...r,
            enabled: true,
            stages: {
              CHAT: [
                id,
                ...(r.stages.CHAT?.[1] && r.stages.CHAT[1] !== id
                  ? [r.stages.CHAT[1]]
                  : []),
              ],
            },
          }
        : r,
    ),
  };
}
export function chatConfigurationStatus(
  config: ModelConfiguration,
  environmentDemo: boolean,
  openAIReady: boolean,
) {
  const route = config.routes.find((r) => r.feature === "CHAT");
  const model = config.models.find((m) => m.id === route?.stages.CHAT?.[0]);
  const provider = config.providers.find((p) => p.id === model?.providerId);
  const blockers: string[] = [];
  if (!route?.enabled) blockers.push("聊天路由未启用");
  if (!model?.enabled || model.capability !== "CHAT")
    blockers.push("默认聊天模型未启用");
  if (
    model &&
    (!provider?.enabled ||
      !(provider.hasKey || provider.encryptedKey || provider.apiKey))
  )
    blockers.push("供应商密钥未配置或未启用");
  if (provider?.keyValid === false) blockers.push("供应商密钥格式异常");
  if ((config.textModeration || "OPENAI") === "OPENAI" && !openAIReady)
    blockers.push("OpenAI 内容审核密钥未配置");
  return {
    demo: chatUsesDemo(config, environmentDemo),
    model: model?.model || "",
    provider: provider?.name || "",
    blockers,
  };
}
export const requiredStages: Record<Feature, Capability[]> = {
  CHAT: ["CHAT"],
  IMAGE: ["CHAT", "IMAGE"],
  VOICE: ["STT", "CHAT", "TTS"],
};
export function emptyModelConfiguration(): ModelConfiguration {
  return {
    providers: [],
    models: [],
    routes: features.map((feature) => ({
      feature,
      enabled: false,
      coins: feature === "IMAGE" ? 10 : feature === "VOICE" ? 3 : 1,
      stages: Object.fromEntries(requiredStages[feature].map((c) => [c, []])),
    })),
  };
}
export function validApiKey(value: string) {
  return /^[A-Za-z0-9._:/+=-]{8,500}$/.test(value);
}
