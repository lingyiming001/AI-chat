import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { failure, sameOrigin, HttpError } from "@/lib/http";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const result = await prisma.character.updateMany({
      where: { id, ownerId: user.id, status: { in: ["DRAFT", "REJECTED"] } },
      data: { status: "REVIEWING" },
    });
    if (!result.count) throw new HttpError(409, "角色不存在或当前状态无法提交");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
