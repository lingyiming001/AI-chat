import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { decryptSecret, loadModelConfiguration } from "@/lib/model-config";
import { providerPresets, validApiKey } from "@/lib/model-catalog";
import { failure, HttpError } from "@/lib/http";
import { limit } from "@/lib/limits";
import { providerResponseFailure } from "@/lib/model-adapters";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await requireAdmin();
    await limit("model-catalog:" + user.id, 10);
    const id = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("providerId"));
    const { config } = await loadModelConfiguration();
    const provider = config.providers.find((p) => p.id === id);
    if (!provider?.encryptedKey)
      throw new HttpError(400, "请先保存供应商 API Key");
    const key = decryptSecret(provider.encryptedKey, id);
    if (!validApiKey(key))
      throw new HttpError(400, "已保存的 API Key 格式异常，请重新粘贴纯密钥");
    const preset = providerPresets[provider.kind];
    if (preset.protocol !== "openai")
      throw new HttpError(400, "该供应商使用预设或自定义模型 ID");
    const response = await fetch(preset.baseUrl + "/models", {
      headers: {
        Authorization: "Bearer " + key,
      },
      signal: AbortSignal.timeout(15000),
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok)
      throw new HttpError(
        503,
        (await providerResponseFailure(response)).message,
      );
    const reader = response.body?.getReader();
    if (!reader) throw new HttpError(503, "供应商返回空列表");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > 512000) {
        await reader.cancel();
        throw new HttpError(503, "供应商模型列表过大");
      }
      chunks.push(item.value);
    }
    const parsed = z
      .object({
        data: z
          .array(
            z.object({
              id: z
                .string()
                .min(1)
                .max(120)
                .regex(/^[a-zA-Z0-9._:/-]+$/),
            }),
          )
          .max(2000),
      })
      .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    return NextResponse.json(
      { models: [...new Set(parsed.data.map((m) => m.id))].sort() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name))
    )
      return failure(
        new HttpError(503, "无法连接供应商模型列表，请检查网络后重试"),
      );
    return failure(error);
  }
}
