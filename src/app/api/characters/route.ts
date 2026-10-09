import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { failure, jsonBody, sameOrigin } from "@/lib/http";
import { limit, redis } from "@/lib/limits";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const mine = url.searchParams.get("mine") === "1";
    const user = mine ? await requireUser() : null;
    const q = (url.searchParams.get("q") || "").slice(0, 100);
    const cacheKey = "catalog:" + q;
    if (!mine && !q) {
      const cached = await redis.get(cacheKey).catch(() => null);
      if (cached) return NextResponse.json(JSON.parse(cached));
    }
    const characters = await prisma.character.findMany({
      where: {
        ...(mine ? { ownerId: user!.id } : { status: "PUBLISHED" }),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { title: { contains: q, mode: "insensitive" } },
                { tags: { has: q } },
              ],
            }
          : {}),
      },
      take: 60,
      orderBy: [{ popularity: "desc" }, { createdAt: "desc" }],
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
    if (!mine && !q)
      await redis
        .set(cacheKey, JSON.stringify({ characters }), "EX", 30)
        .catch(() => {});
    return NextResponse.json({ characters });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    await limit("create:" + user.id, 10, 3600);
    const data = z
      .object({
        name: z.string().trim().min(1).max(30),
        title: z.string().trim().min(1).max(80),
        greeting: z.string().trim().min(1).max(500),
        systemPrompt: z.string().trim().min(10).max(4000),
        tags: z.array(z.string().trim().min(1).max(15)).max(5),
        avatarUrl: z
          .url()
          .refine((v) => new URL(v).protocol === "https:")
          .optional(),
      })
      .parse(await jsonBody(request));
    const character = await prisma.character.create({
      data: { ...data, ownerId: user.id, status: "DRAFT", pricePerMessage: 1 },
    });
    return NextResponse.json({ id: character.id }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
