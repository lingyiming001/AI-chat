import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { failure, HttpError, jsonBody, sameOrigin } from "@/lib/http";
import { limit, redis } from "@/lib/limits";
import { demoMode, generateReply, moderate } from "@/lib/ai";
import { refundRequest } from "@/lib/billing";
import { enabledRoute, type ModelTrace } from "@/lib/model-router";
import { loadModelConfiguration } from "@/lib/model-config";
import { chatUsesDemo } from "@/lib/model-catalog";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function POST(request: Request) {
  let lockKey = "";
  let lockValue = "";
  try {
    sameOrigin(request);
    const user = await requireUser();
    const data = z
      .object({
        requestId: z.uuid(),
        characterId: z.string().min(1).max(100),
        content: z.string().trim().min(1).max(4000),
      })
      .parse(await jsonBody(request));
    await limit("chat:" + user.id, 20);
    const existing = await prisma.chatRequest.findUnique({
      where: { id: data.requestId },
    });
    if (existing) {
      if (
        existing.userId !== user.id ||
        existing.feature !== "CHAT" ||
        existing.characterId !== data.characterId ||
        existing.content !== data.content
      )
        throw new HttpError(409, "请求标识已使用");
      if (existing.status === "COMPLETED")
        return new Response(
          JSON.stringify({
            type: "done",
            reply: existing.reply,
            replay: true,
          }) + "\n",
          { headers: { "Content-Type": "application/x-ndjson" } },
        );
      throw new HttpError(
        409,
        existing.status === "PENDING"
          ? "消息正在处理中"
          : "本次请求已失败，请重新发送",
      );
    }
    const character = await prisma.character.findFirst({
      where: {
        id: data.characterId,
        OR: [{ status: "PUBLISHED" }, { ownerId: user.id }],
      },
    });
    if (!character) throw new HttpError(404, "角色不存在或无权访问");
    const snapshot = await loadModelConfiguration();
    const chatDemo = chatUsesDemo(snapshot.config, demoMode());
    if (!chatDemo && snapshot.version) enabledRoute(snapshot.config, "CHAT");
    const key = "chat-lock:" + user.id;
    if (!(await redis.set(key, data.requestId, "EX", 240, "NX")))
      throw new HttpError(409, "请等待上一条消息完成");
    lockKey = key;
    lockValue = data.requestId;
    await moderate(data.content, snapshot);
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
      const wallet = await tx.wallet.updateMany({
        where: { userId: user.id, balance: { gte: character.pricePerMessage } },
        data: { balance: { decrement: character.pricePerMessage } },
      });
      if (!wallet.count) throw new HttpError(402, "星币不足，请先充值");
      await tx.chatRequest.create({
        data: {
          id: data.requestId,
          userId: user.id,
          characterId: character.id,
          content: data.content,
          coins: character.pricePerMessage,
        },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: user.wallet!.id,
          amount: -character.pricePerMessage,
          reason: "角色对话",
          refType: "CHAT",
          refId: data.requestId,
        },
      });
    });
    const encoder = new TextEncoder();
    const release = () =>
      redis.eval(
        "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
        1,
        key,
        data.requestId,
      );
    const stream = new ReadableStream({
      async start(controller) {
        const trace: ModelTrace[] = [];
        let connected = true;
        const emit = (event: object) => {
          if (connected) {
            try {
              controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
            } catch {
              connected = false;
            }
          }
        };
        try {
          emit({ type: "start", demo: chatDemo });
          let reply = "";
          for await (const delta of generateReply(
            character.systemPrompt,
            [
              ...history.reverse().map((m) => ({
                role:
                  m.role === "USER"
                    ? ("user" as const)
                    : ("assistant" as const),
                content: m.content,
              })),
              { role: "user", content: data.content },
            ],
            trace,
            snapshot,
            character,
          )) {
            reply += delta;
            // Hold production output until moderation succeeds.
            if (chatDemo) emit({ type: "delta", delta });
          }
          if (!reply.trim()) throw new Error("Empty response");
          await moderate(reply, snapshot);
          await prisma.$transaction(async (tx) => {
            const updated = await tx.chatRequest.updateMany({
              where: { id: data.requestId, status: "PENDING" },
              data: { status: "COMPLETED", reply, result: { trace } },
            });
            if (!updated.count) throw new Error("Request expired");
            await tx.chatMessage.create({
              data: {
                sessionId: session.id,
                role: "USER",
                content: data.content,
              },
            });
            await tx.chatMessage.create({
              data: {
                sessionId: session.id,
                role: "ASSISTANT",
                content: reply,
                costCoins: character.pricePerMessage,
                model:
                  trace.filter((t) => t.status === "OK").at(-1)?.model ||
                  (chatDemo
                    ? "demo"
                    : process.env.OPENAI_MODEL || "gpt-6-luna"),
              },
            });
            await tx.chatSession.update({
              where: { id: session.id },
              data: { updatedAt: new Date() },
            });
          });
          emit({ type: "done", reply });
        } catch (error) {
          try {
            await refundRequest(data.requestId);
            await prisma.chatRequest.updateMany({
              where: { id: data.requestId, status: "FAILED" },
              data: { result: { trace } },
            });
            emit({
              type: "error",
              error:
                error instanceof HttpError
                  ? error.message + "；本次星币已退回"
                  : "回复未完成，本次星币已退回，请重试",
            });
          } catch {
            emit({
              type: "error",
              error: "服务异常，订单等待自动对账，请稍后查看余额",
            });
          }
        } finally {
          await release().catch(() => {});
          if (connected) {
            try {
              controller.close();
            } catch {}
          }
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (lockKey)
      await redis
        .eval(
          "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
          1,
          lockKey,
          lockValue,
        )
        .catch(() => {});
    return failure(error);
  }
}
