import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { failure, HttpError } from "@/lib/http";
import { readCharacterImage } from "@/lib/character-image-store";
export const runtime = "nodejs";
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await currentUser();
    if (user?.role !== "ADMIN") {
      const character = await prisma.character.findFirst({ where: {
        avatarUrl: "/api/character-images/" + id,
        OR: [{ status: "PUBLISHED" }, ...(user ? [{ ownerId: user.id }] : [])],
      }, select: { id: true } });
      if (!character) throw new HttpError(404, "图片不存在");
    }
    const bytes = await readCharacterImage(id);
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache", "Content-Length": String(bytes.length),
    } });
  } catch (error) { return failure(error); }
}
