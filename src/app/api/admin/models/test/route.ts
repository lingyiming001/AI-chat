import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { sameOrigin, failure, jsonBody, HttpError } from "@/lib/http";
import { limit } from "@/lib/limits";
import { loadModelConfiguration } from "@/lib/model-config";
import { invokeModel, ProviderFailure } from "@/lib/model-adapters";
import { prisma } from "@/lib/db";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireAdmin();
    await limit("model-test:" + user.id, 2);
    const { id } = z.object({ id: z.uuid() }).parse(await jsonBody(request));
    const { config } = await loadModelConfiguration();
    const model = config.models.find(
      (m) => m.id === id && m.enabled && m.capability === "CHAT",
    );
    const provider = config.providers.find(
      (p) => p.id === model?.providerId && p.enabled && p.encryptedKey,
    );
    if (!model || !provider)
      throw new HttpError(400, "请先保存并启用对话模型及供应商");
    await prisma.adminAudit.create({
      data: {
        actorId: user.id,
        action: "model-test",
        entityId: id,
        detail: { provider: provider.name, model: model.model },
      },
    });
    const start = Date.now();
    await invokeModel(provider, model, "CHAT", {
      system: "Reply briefly.",
      messages: [{ role: "user", content: "Reply with OK." }],
    });
    return NextResponse.json({ ok: true, durationMs: Date.now() - start });
  } catch (error) {
    if (error instanceof ProviderFailure)
      return failure(new HttpError(503, error.message));
    return failure(error);
  }
}
