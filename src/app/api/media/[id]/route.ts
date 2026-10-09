import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { failure, HttpError } from "@/lib/http";
import { readMedia } from "@/lib/media-store";
export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const id = z.uuid().parse((await context.params).id);
    const asset = await prisma.mediaAsset.findFirst({
      where: { id, userId: user.id },
    });
    if (!asset) throw new HttpError(404, "文件不存在");
    const completed = await prisma.chatRequest.findFirst({
      where: { id: asset.requestId, userId: user.id, status: "COMPLETED" },
    });
    if (!completed) throw new HttpError(404, "文件尚未生成");
    return new Response(new Uint8Array(await readMedia(id)), {
      headers: {
        "Content-Type": asset.mimeType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
