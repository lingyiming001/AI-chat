import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { failure, HttpError, sameOrigin } from "@/lib/http";
import { limit, redis } from "@/lib/limits";
import { loadModelConfiguration } from "@/lib/model-config";
import { enabledRoute, runStage, type ModelTrace } from "@/lib/model-router";
import { aiClient, demoMode, moderate, moderateImage } from "@/lib/ai";
import { buildCharacterPrompt } from "@/lib/character-prompt";
import { refundRequest } from "@/lib/billing";
import { saveMedia, removeMedia, type Attachment } from "@/lib/media-store";
export const runtime = "nodejs";
export const maxDuration = 180;

async function multipart(request: Request) {
  if (!request.body) throw new HttpError(400, "请求内容为空");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 6 * 1024 * 1024) {
      await reader.cancel();
      throw new HttpError(413, "音频文件不能超过5MB");
    }
    chunks.push(part.value);
  }
  return new Response(Buffer.concat(chunks), {
    headers: { "Content-Type": request.headers.get("content-type") || "" },
  }).formData();
}
export async function POST(request: Request) {
  let reserved = "",
    lock = "",
    lockValue = "";
  const attachments: Attachment[] = [];
  const trace: ModelTrace[] = [];
  try {
    sameOrigin(request);
    const user = await requireUser();
    await limit("compose:" + user.id, 5);
    const form = await multipart(request);
    const input = z
      .object({
        requestId: z.uuid(),
        characterId: z.string().min(1).max(100),
        feature: z.enum(["IMAGE", "VOICE"]),
        content: z.string().trim().max(4000),
      })
      .parse(
        Object.fromEntries(
          ["requestId", "characterId", "feature", "content"].map((k) => [
            k,
            form.get(k) || "",
          ]),
        ),
      );
    const audio = form.get("audio");
    if (input.feature === "IMAGE" && !input.content)
      throw new HttpError(400, "请输入画面描述");
    if (
      input.feature === "VOICE" &&
      (!(audio instanceof File) ||
        !audio.size ||
        audio.size > 5 * 1024 * 1024 ||
        ![
          "audio/webm",
          "audio/mp4",
          "audio/x-m4a",
          "audio/mpeg",
          "audio/wav",
          "audio/x-wav",
          "audio/ogg",
        ].includes(audio.type.split(";")[0]))
    )
      throw new HttpError(400, "请选择5MB以内的音频文件");
    const digest = createHash("sha256")
      .update(input.content)
      .update(
        input.feature === "VOICE"
          ? Buffer.from(await (audio as File).arrayBuffer())
          : "",
      )
      .digest("hex");
    const existing = await prisma.chatRequest.findUnique({
      where: { id: input.requestId },
    });
    if (existing) {
      if (
        existing.userId !== user.id ||
        existing.characterId !== input.characterId ||
        existing.feature !== input.feature ||
        existing.content !== digest
      )
        throw new HttpError(409, "请求标识已使用");
      if (existing.status !== "COMPLETED")
        throw new HttpError(
          409,
          existing.status === "PENDING"
            ? "请求正在处理中"
            : "本次请求已失败，请重新发送",
        );
      return NextResponse.json({
        ...(existing.result as object),
        replay: true,
      });
    }
    if (demoMode())
      throw new HttpError(
        503,
        "演示模式不调用付费图片或语音模型，请先启用正式环境",
      );
    const { config } = await loadModelConfiguration();
    const route = enabledRoute(config, input.feature);
    const character = await prisma.character.findFirst({
      where: {
        id: input.characterId,
        OR: [{ status: "PUBLISHED" }, { ownerId: user.id }],
      },
    });
    if (!character) throw new HttpError(404, "角色不存在或无权访问");
    // Fail closed before reserving funds if moderation has no configured credentials.
    await aiClient();
    if (input.content) await moderate(input.content);
    lock = "chat-lock:" + user.id;
    lockValue = input.requestId;
    if (!(await redis.set(lock, lockValue, "EX", 240, "NX"))) {
      lock = "";
      throw new HttpError(409, "请等待上一条请求完成");
    }
    const session = await prisma.chatSession.upsert({
      where: {
        userId_characterId: { userId: user.id, characterId: character.id },
      },
      create: { userId: user.id, characterId: character.id },
      update: {},
    });
    const history = await prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    await prisma.$transaction(async (tx) => {
      const changed = await tx.wallet.updateMany({
        where: { userId: user.id, balance: { gte: route.coins } },
        data: { balance: { decrement: route.coins } },
      });
      if (!changed.count) throw new HttpError(402, "星币不足，请先充值");
      await tx.chatRequest.create({
        data: {
          id: input.requestId,
          userId: user.id,
          characterId: character.id,
          feature: input.feature,
          content: digest,
          coins: route.coins,
        },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: user.wallet!.id,
          amount: -route.coins,
          reason: input.feature === "IMAGE" ? "角色绘图" : "语音聊天",
          refType: "CHAT",
          refId: input.requestId,
        },
      });
    });
    reserved = input.requestId;
    const system = buildCharacterPrompt(character.systemPrompt, character);
    let content = input.content;
    let reply = "";
    if (input.feature === "VOICE") {
      content = (
        await runStage(config, route, "STT", { audio: audio as File }, trace)
      ).text!;
      if (content.length > 4000) throw new HttpError(400, "语音内容过长");
      await moderate(content);
      reply = (
        await runStage(
          config,
          route,
          "CHAT",
          {
            system,
            messages: [
              ...history
                .reverse()
                .map((m) => ({
                  role:
                    m.role === "USER"
                      ? ("user" as const)
                      : ("assistant" as const),
                  content: m.content,
                })),
              { role: "user", content },
            ],
          },
          trace,
        )
      ).text!;
      await moderate(reply);
      if (reply.length > 4000) throw new HttpError(400, "语音回复过长");
      const result = await runStage(
        config,
        route,
        "TTS",
        { text: reply },
        trace,
      );
      attachments.push(
        await saveMedia(user.id, reserved, result.bytes!, result.mimeType!),
      );
    } else {
      const prompt = (
        await runStage(
          config,
          route,
          "CHAT",
          {
            system: buildCharacterPrompt(character.systemPrompt, character, "IMAGE"),
            messages: [{ role: "user", content }],
          },
          trace,
        )
      ).text!;
      if (prompt.length > 4000) throw new HttpError(400, "画面描述过长");
      await moderate(prompt);
      const result = await runStage(
        config,
        route,
        "IMAGE",
        { text: prompt },
        trace,
      );
      await moderateImage(result.bytes!, result.mimeType!);
      attachments.push(
        await saveMedia(user.id, reserved, result.bytes!, result.mimeType!),
      );
      reply = "已为你生成这幅画面。";
    }
    const result = { reply, content, attachments, trace, coins: route.coins };
    await prisma.$transaction(async (tx) => {
      const changed = await tx.chatRequest.updateMany({
        where: { id: reserved, status: "PENDING" },
        data: { status: "COMPLETED", reply, result },
      });
      if (!changed.count) throw new Error("Request expired");
      await tx.chatMessage.create({
        data: { sessionId: session.id, role: "USER", content },
      });
      await tx.chatMessage.create({
        data: {
          sessionId: session.id,
          role: "ASSISTANT",
          content: reply,
          attachments,
          costCoins: route.coins,
          model: trace
            .filter((t) => t.status === "OK")
            .map((t) => t.model)
            .join(" → "),
        },
      });
      await tx.chatSession.update({
        where: { id: session.id },
        data: { updatedAt: new Date() },
      });
    });
    reserved = "";
    return NextResponse.json(result);
  } catch (error) {
    if (reserved) {
      try {
        await refundRequest(reserved);
        await prisma.chatRequest.updateMany({
          where: { id: reserved, status: "FAILED" },
          data: { result: { trace } },
        });
        await Promise.all(attachments.map((a) => removeMedia(a.id)));
      } catch {
        return failure(new HttpError(503, "请求未完成，余额等待自动对账"));
      }
      return failure(new HttpError(503, "生成未完成，本次星币已退回"));
    }
    return failure(error);
  } finally {
    if (lock)
      await redis
        .eval(
          "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
          1,
          lock,
          lockValue,
        )
        .catch(() => {});
  }
}
