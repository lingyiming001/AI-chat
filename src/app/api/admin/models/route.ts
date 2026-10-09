import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { failure, sameOrigin, jsonBody, HttpError } from "@/lib/http";
import {
  loadModelConfiguration,
  redactConfiguration,
  saveModelConfiguration,
} from "@/lib/model-config";
import { demoMode } from "@/lib/ai";
import { limit } from "@/lib/limits";
import { prisma } from "@/lib/db";
import { chatConfigurationStatus } from "@/lib/model-catalog";
function status(config: Parameters<typeof chatConfigurationStatus>[0]) {
  return chatConfigurationStatus(
    config,
    demoMode(),
    !!process.env.OPENAI_API_KEY ||
      config.providers.some(
        (p) => p.kind === "OPENAI" && p.enabled && (p.encryptedKey || p.hasKey),
      ),
  );
}
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await requireAdmin();
    const saved = await loadModelConfiguration();
    const recent = await prisma.chatRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        feature: true,
        status: true,
        createdAt: true,
        result: true,
      },
    });
    return NextResponse.json(
      {
        version: saved.version,
        config: redactConfiguration(saved.config),
        demo: demoMode(),
        chat: status(redactConfiguration(saved.config)),
        moderationReady:
          !!process.env.OPENAI_API_KEY ||
          saved.config.providers.some(
            (p) => p.kind === "OPENAI" && p.enabled && p.encryptedKey,
          ),
        encryptionReady: /^[a-f0-9]{64}$/i.test(
          process.env.AI_CONFIG_ENCRYPTION_KEY || "",
        ),
        recent: recent
          .filter((r) => r.result)
          .map((r) => ({
            id: r.id,
            feature: r.feature,
            status: r.status,
            createdAt: r.createdAt,
            trace: (r.result as { trace?: unknown }).trace || [],
          })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireAdmin();
    await limit("model-config:" + user.id, 20);
    if (
      request.headers.get("content-length") &&
      Number(request.headers.get("content-length")) > 24000
    )
      throw new HttpError(413, "配置过大");
    const result = await saveModelConfiguration(
      user.id,
      await jsonBody(request),
    );
    return NextResponse.json({
      ...result,
      chat: status(result.config),
      moderationReady:
        !!process.env.OPENAI_API_KEY ||
        result.config.providers.some(
          (p) => p.kind === "OPENAI" && p.enabled && p.hasKey,
        ),
    });
  } catch (error) {
    return failure(error);
  }
}
