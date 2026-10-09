import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { failure, HttpError, sameOrigin } from "@/lib/http";
import { limit } from "@/lib/limits";
import { normalizeCharacterImage } from "@/lib/character-images";
import { storeCharacterImage, removeCharacterImage } from "@/lib/character-image-store";
import { prisma } from "@/lib/db";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let stored: string | undefined;
  try {
    sameOrigin(request);
    const admin = await requireAdmin();
    await limit("cover-upload:" + admin.id, 30, 3600);
    if (!request.body) throw new HttpError(400, "请选择图片");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 5 * 1024 * 1024 + 65536) {
        await reader.cancel();
        throw new HttpError(413, "图片不能超过 5MB");
      }
      chunks.push(chunk.value);
    }
    const form = await new Response(Buffer.concat(chunks), {
      headers: { "Content-Type": request.headers.get("content-type") || "" },
    }).formData().catch(() => { throw new HttpError(400, "图片上传格式不正确"); });
    const file = form.get("image");
    if (!(file instanceof File)) throw new HttpError(400, "请选择图片");
    const bytes = await normalizeCharacterImage(Buffer.from(await file.arrayBuffer()), file.type);
    const image = await storeCharacterImage(bytes);
    stored = image.id;
    await prisma.adminAudit.create({ data: { actorId: admin.id, action: "character-image-upload", entityId: image.id, detail: { size: bytes.length } } });
    return NextResponse.json({ url: image.url }, { status: 201 });
  } catch (error) {
    if (stored) await removeCharacterImage(stored);
    return failure(error);
  }
}
