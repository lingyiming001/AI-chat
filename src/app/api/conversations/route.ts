import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { failure, HttpError, jsonBody, sameOrigin } from "@/lib/http";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { redis, limit } from "@/lib/limits";
import { removeMedia } from "@/lib/media-store";
export async function POST(request: Request) {
  let lock = "";
  const token = randomUUID();
  try {
    sameOrigin(request);
    const user = await requireUser();
    const input = z.object({ characterId: z.string().min(1).max(100), action: z.enum(["clear", "delete"]) }).parse(await jsonBody(request));
    await limit("conversation-manage:" + user.id, 20);
    const key = "chat-lock:" + user.id;
    if (!(await redis.set(key, token, "EX", 240, "NX"))) throw new HttpError(409, "消息正在处理中，请完成后再清理");
    lock = key;
    const assets = await prisma.$transaction(async (tx) => {
      const where = { userId: user.id, characterId: input.characterId };
      if (await tx.chatRequest.count({ where: { ...where, status: "PENDING" } })) throw new HttpError(409, "还有未完成的消息，请稍后再清理");
      const session = await tx.chatSession.findUnique({ where: { userId_characterId: where } });
      const requests = await tx.chatRequest.findMany({ where, select: { id: true } });
      const ids = requests.map((r) => r.id);
      const media = await tx.mediaAsset.findMany({ where: { userId: user.id, requestId: { in: ids } }, select: { id: true } });
      await tx.mediaAsset.deleteMany({ where: { userId: user.id, requestId: { in: ids } } });
      // Preserve billing/idempotency metadata without retaining conversation text or replay results.
      await tx.chatRequest.updateMany({ where, data: { content: "", reply: null, result: Prisma.DbNull } });
      if (session) {
        await tx.chatMessage.deleteMany({ where: { sessionId: session.id } });
        if (input.action === "delete") await tx.chatSession.delete({ where: { id: session.id } });
        else await tx.chatSession.update({ where: { id: session.id }, data: { title: null, updatedAt: new Date() } });
      }
      return media;
    });
    for (const asset of assets) await removeMedia(asset.id).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (error) { return failure(error); }
  finally {
    if (lock) await redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", 1, lock, token).catch(() => {});
  }
}
export async function GET() {
  try {
    const user = await requireUser();
    const sessions = await prisma.chatSession.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        character: {
          select: { id: true, name: true, avatarUrl: true, title: true },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true },
        },
      },
    });
    return NextResponse.json({ sessions });
  } catch (error) {
    return failure(error);
  }
}
