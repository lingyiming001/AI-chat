import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { failure } from "@/lib/http";
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
