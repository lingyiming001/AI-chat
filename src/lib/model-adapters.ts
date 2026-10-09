import {
  providerPresets,
  validApiKey,
  type Model,
  type Provider,
  type Capability,
} from "./model-catalog";
import { decryptSecret } from "./model-config";
import { HttpError } from "./http";

export type StageInput = {
  system?: string;
  messages?: { role: "user" | "assistant"; content: string }[];
  text?: string;
  audio?: File;
};
export type StageOutput = { text?: string; bytes?: Buffer; mimeType?: string };
const providerErrorMessages = {
  Arrearage:
    "阿里云账户欠费或计费状态异常，请检查账户余额及百炼服务计费状态后重试",
  "isv.OUT_OF_SERVICE": "阿里云账户余额不足，服务已暂停，请检查账户计费状态",
  DataInspectionFailed: "供应商内容安全检查未通过，请调整内容后重试",
  data_inspection_failed: "供应商内容安全检查未通过，请调整内容后重试",
  "AccessDenied.Unpurchased":
    "当前账户未开通该模型服务，请在供应商控制台开通模型权限",
  "AllocationQuota.FreeTierOnly":
    "该模型免费额度已耗尽，请检查免费额度模式及付费调用设置",
  insufficient_quota: "供应商账户余额或调用额度不足，请检查账户计费状态",
  InvalidApiKey: "供应商 API Key 无效，请检查密钥及所属地域",
  invalid_api_key: "供应商 API Key 无效，请检查密钥及所属地域",
  ModelNotFound: "模型不存在或无访问权限，请检查模型 ID 与账户权限",
  model_not_found: "模型不存在或无访问权限，请检查模型 ID 与账户权限",
} as const;
type ProviderErrorCode = keyof typeof providerErrorMessages;
export class ProviderFailure extends Error {
  constructor(
    public retryable: boolean,
    public status?: number,
    public code?: ProviderErrorCode,
  ) {
    super(
      code
        ? providerErrorMessages[code]
        : status === 401 || status === 403
          ? "供应商密钥无效或无访问权限"
          : status === 404
            ? "模型不存在，请读取可用模型或检查模型 ID"
            : status === 400
              ? "模型参数或调用方式不匹配"
              : status === 429
                ? "供应商额度不足或请求限流"
                : "模型调用失败或超时",
    );
  }
}
export async function providerResponseFailure(response: Response) {
  let code: ProviderErrorCode | undefined;
  try {
    const body = JSON.parse((await bounded(response, 8192)).toString("utf8"));
    const candidate = body?.error?.code || body?.code;
    if (
      typeof candidate === "string" &&
      Object.prototype.hasOwnProperty.call(providerErrorMessages, candidate)
    )
      code = candidate as ProviderErrorCode;
  } catch {
    /* Discard untrusted error bodies; expose only controlled messages. */
  }
  return new ProviderFailure(
    !code && (response.status === 429 || response.status >= 500),
    response.status,
    code,
  );
}
async function bounded(response: Response, maximum: number) {
  if (!response.body) throw new ProviderFailure(true);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const item = await reader.read();
    if (item.done) break;
    length += item.value.length;
    if (length > maximum) {
      await reader.cancel();
      throw new ProviderFailure(false);
    }
    chunks.push(item.value);
  }
  return Buffer.concat(chunks);
}
export function imageMime(bytes: Buffer) {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  throw new ProviderFailure(false);
}
export async function invokeModel(
  provider: Provider,
  model: Model,
  capability: Capability,
  input: StageInput,
  transport: typeof fetch = fetch,
): Promise<StageOutput> {
  if (!provider.encryptedKey) throw new ProviderFailure(false);
  const key = decryptSecret(provider.encryptedKey, provider.id);
  if (!validApiKey(key))
    throw new HttpError(400, "供应商 API Key 格式异常，请在后台重新粘贴纯密钥");
  const preset = providerPresets[provider.kind];
  let path = "";
  let body: object | FormData;
  const headers: Record<string, string> = {};
  if (preset.protocol === "anthropic") {
    path = "/messages";
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model: model.model,
      max_tokens: 1500,
      system: input.system || "",
      messages: input.messages,
    };
  } else if (preset.protocol === "gemini") {
    path = "/models/" + encodeURIComponent(model.model) + ":generateContent";
    headers["x-goog-api-key"] = key;
    body =
      capability === "IMAGE"
        ? {
            contents: [{ role: "user", parts: [{ text: input.text }] }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
          }
        : {
            systemInstruction: { parts: [{ text: input.system || "" }] },
            contents: input.messages?.map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            })),
            generationConfig: { maxOutputTokens: 1500 },
          };
  } else {
    headers.Authorization = "Bearer " + key;
    if (capability === "CHAT") {
      path = "/chat/completions";
      body = {
        model: model.model,
        messages: [
          { role: "system", content: input.system || "" },
          ...(input.messages || []),
        ],
        max_completion_tokens: 1500,
      };
      // Compatible services use max_tokens rather than the OpenAI-specific field.
      if (provider.kind !== "OPENAI")
        body = {
          model: model.model,
          messages: [
            { role: "system", content: input.system || "" },
            ...(input.messages || []),
          ],
          max_tokens: 1500,
        };
      if (["DEEPSEEK", "ZHIPU", "VOLCENGINE"].includes(provider.kind))
        body = { ...(body as object), thinking: { type: "disabled" } };
      if (provider.kind === "MOONSHOT" && model.model === "kimi-k3")
        body = { ...(body as object), reasoning_effort: "low" };
      if (provider.kind === "MOONSHOT" && model.model === "kimi-k2.6")
        body = { ...(body as object), thinking: { type: "disabled" } };
      if (provider.kind === "QWEN" && !model.model.includes("thinking"))
        body = { ...(body as object), enable_thinking: false };
    } else if (capability === "IMAGE") {
      path = "/images/generations";
      body = {
        model: model.model,
        prompt: input.text,
        n: 1,
        size: "1024x1024",
        ...(model.model.startsWith("dall-e")
          ? { response_format: "b64_json" }
          : {}),
      };
    } else if (capability === "STT") {
      path = "/audio/transcriptions";
      if (!input.audio) throw new ProviderFailure(false);
      const form = new FormData();
      form.append("model", model.model);
      form.append(
        "file",
        input.audio,
        "recording." +
          (input.audio.type.includes("mp4") || input.audio.type.includes("m4a")
            ? "mp4"
            : input.audio.type.includes("mpeg")
              ? "mp3"
              : input.audio.type.includes("wav")
                ? "wav"
                : input.audio.type.includes("ogg")
                  ? "ogg"
                  : "webm"),
      );
      body = form;
    } else {
      path = "/audio/speech";
      body = {
        model: model.model,
        input: input.text,
        voice: model.voice,
        response_format: "mp3",
      };
    }
  }
  if (!(body instanceof FormData)) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await transport(preset.baseUrl + path, {
      method: "POST",
      headers,
      body: body instanceof FormData ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
  } catch {
    throw new ProviderFailure(true);
  }
  if (!response.ok) throw await providerResponseFailure(response);
  if (capability === "TTS") {
    const bytes = await bounded(response, 5 * 1024 * 1024);
    if (!bytes.length) throw new ProviderFailure(true);
    return { bytes, mimeType: "audio/mpeg" };
  }
  const raw = await bounded(
    response,
    capability === "IMAGE" ? 16 * 1024 * 1024 : 128000,
  );
  let data;
  try {
    data = JSON.parse(raw.toString());
  } catch {
    throw new ProviderFailure(true);
  }
  if (capability === "IMAGE") {
    const parts = data.candidates?.[0]?.content?.parts;
    const encoded =
      preset.protocol === "gemini"
        ? parts?.find((p: { inlineData?: object }) => p.inlineData)?.inlineData
            ?.data
        : data.data?.[0]?.b64_json;
    if (typeof encoded !== "string" || !/^[A-Za-z0-9+/=]+$/.test(encoded))
      throw new ProviderFailure(false);
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length > 8 * 1024 * 1024) throw new ProviderFailure(false);
    return { bytes, mimeType: imageMime(bytes) };
  }
  const text =
    capability === "STT"
      ? data.text
      : preset.protocol === "anthropic"
        ? data.content
            ?.filter((p: { type: string }) => p.type === "text")
            .map((p: { text: string }) => p.text)
            .join("")
        : preset.protocol === "gemini"
          ? data.candidates?.[0]?.content?.parts
              ?.filter(
                (p: { text?: string; thought?: boolean }) =>
                  p.text && !p.thought,
              )
              .map((p: { text: string }) => p.text)
              .join("")
          : data.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim() || text.length > 12000)
    throw new ProviderFailure(false);
  return { text };
}
