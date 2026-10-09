import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { failure, HttpError } from "@/lib/http";
export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const user = await currentUser();
    const character = await prisma.character.findFirst({
      where: {
        id,
        OR: [{ status: "PUBLISHED" }, ...(user ? [{ ownerId: user.id }] : [])],
      },
      select: {
        id: true,
        name: true,
        title: true,
        avatarUrl: true,
        tags: true,
        greeting: true,
        pricePerMessage: true,
        status: true,
      },
    });
    if (!character) throw new HttpError(404, "角色不存在或尚未公开");
    const session = user
      ? await prisma.chatSession.findUnique({
          where: { userId_characterId: { userId: user.id, characterId: id } },
          include: { messages: { orderBy: { createdAt: "desc" }, take: 100 } },
        })
      : null;
    return NextResponse.json({
      character,
      messages:
        session?.messages
          .reverse()
          .map((m) => ({
            role: m.role.toLowerCase(),
            content: m.content,
            attachments: m.attachments,
          })) ?? [],
    });
  } catch (error) {
    return failure(error);
  }
}
