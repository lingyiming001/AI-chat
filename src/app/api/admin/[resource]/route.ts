import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redis, limit } from "@/lib/limits";
import { failure, sameOrigin, jsonBody, HttpError } from "@/lib/http";
import { adminActionSchema, performAdminAction } from "@/lib/admin";
import { plans } from "@/lib/billing";
import { demoMode } from "@/lib/ai";
import { loadModelConfiguration } from "@/lib/model-config";
export const dynamic = "force-dynamic";
const userInfo = { id: true, email: true, nickname: true } as const;
export async function GET(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  try {
    await requireAdmin();
    const { resource } = await context.params;
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").slice(0, 100);
    const status = url.searchParams.get("status") || "";
    const cursor = url.searchParams.get("cursor");
    const page = {
      take: 21,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    };
    let items: unknown[] = [];
    let total = 0;
    if (resource === "overview") {
      const since = new Date(Date.now() - 86400000);
      const [
        users,
        characters,
        reviewing,
        messages,
        orders,
        revenue,
        demoRevenue,
        active,
        stale,
        trend,
        recent,
      ] = await Promise.all([
        prisma.user.count({ where: { status: { not: "DELETED" } } }),
        prisma.character.count({ where: { status: "PUBLISHED" } }),
        prisma.character.count({ where: { status: "REVIEWING" } }),
        prisma.chatRequest.count({
          where: { status: "COMPLETED", createdAt: { gte: since } },
        }),
        prisma.order.count({ where: { status: "PAID" } }),
        prisma.order.aggregate({
          where: { status: "PAID", provider: { not: "demo" } },
          _sum: { amountCents: true },
        }),
        prisma.order.aggregate({
          where: { status: "PAID", provider: "demo" },
          _sum: { amountCents: true },
        }),
        prisma.$queryRaw<
          { count: bigint }[]
        >`SELECT COUNT(DISTINCT "userId") AS count FROM "ChatRequest" WHERE "createdAt" >= ${since}`,
        prisma.chatRequest.count({
          where: {
            status: "PENDING",
            createdAt: { lt: new Date(Date.now() - 300000) },
          },
        }),
        prisma.$queryRaw<
          { day: string; count: bigint }[]
        >`SELECT to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS day, count(*) AS count FROM "ChatRequest" WHERE status='COMPLETED' AND "createdAt" >= NOW()-INTERVAL '7 days' GROUP BY day ORDER BY day`,
        prisma.adminAudit.findMany({
          take: 5,
          orderBy: { createdAt: "desc" },
          include: { actor: { select: userInfo } },
        }),
      ]);
      return NextResponse.json(
        {
          users,
          characters,
          reviewing,
          messages,
          orders,
          revenueCents: revenue._sum.amountCents || 0,
          demoRevenueCents: demoRevenue._sum.amountCents || 0,
          activeUsers: Number(active[0].count),
          stale,
          trend: trend.map((d) => ({ ...d, count: Number(d.count) })),
          recent,
          demo: demoMode(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (resource === "users") {
      const where: Prisma.UserWhereInput = {
        ...(status && ["ACTIVE", "FROZEN"].includes(status)
          ? { status: status as "ACTIVE" | "FROZEN" }
          : {}),
        ...(q
          ? {
              OR: [
                { email: { contains: q, mode: "insensitive" } },
                { nickname: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      [items, total] = await Promise.all([
        prisma.user.findMany({
          ...page,
          where,
          select: {
            ...userInfo,
            status: true,
            role: true,
            createdAt: true,
            wallet: { select: { balance: true } },
            _count: { select: { characters: true, sessions: true } },
          },
        }),
        prisma.user.count({ where }),
      ]);
    } else if (resource === "characters") {
      const allowed = ["REVIEWING", "PUBLISHED", "REJECTED", "ARCHIVED"];
      const where: Prisma.CharacterWhereInput = {
        status: {
          in: allowed as (
            "REVIEWING" | "PUBLISHED" | "REJECTED" | "ARCHIVED"
          )[],
        },
        ...(allowed.includes(status)
          ? {
              status: status as
                "REVIEWING" | "PUBLISHED" | "REJECTED" | "ARCHIVED",
            }
          : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { title: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      [items, total] = await Promise.all([
        prisma.character.findMany({
          ...page,
          where,
          include: { owner: { select: userInfo } },
        }),
        prisma.character.count({ where }),
      ]);
    } else if (resource === "orders") {
      const where: Prisma.OrderWhereInput = {
        ...(["PENDING", "PAID", "FAILED", "REFUNDED"].includes(status)
          ? { status: status as "PENDING" | "PAID" | "FAILED" | "REFUNDED" }
          : {}),
        ...(q
          ? {
              OR: [
                { id: { contains: q } },
                { user: { email: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {}),
      };
      [items, total] = await Promise.all([
        prisma.order.findMany({
          ...page,
          where,
          include: { user: { select: userInfo } },
        }),
        prisma.order.count({ where }),
      ]);
    } else if (resource === "ledger") {
      const where: Prisma.WalletTransactionWhereInput = {
        ...(q
          ? {
              OR: [
                {
                  wallet: {
                    user: { email: { contains: q, mode: "insensitive" } },
                  },
                },
                { refId: { contains: q } },
                { reason: { contains: q } },
              ],
            }
          : {}),
        ...(status ? { refType: status } : {}),
      };
      [items, total] = await Promise.all([
        prisma.walletTransaction.findMany({
          ...page,
          where,
          include: { wallet: { select: { user: { select: userInfo } } } },
        }),
        prisma.walletTransaction.count({ where }),
      ]);
    } else if (resource === "audit") {
      const where: Prisma.AdminAuditWhereInput = q
        ? {
            OR: [
              { entityId: { contains: q } },
              { actor: { email: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {};
      [items, total] = await Promise.all([
        prisma.adminAudit.findMany({
          ...page,
          where,
          include: { actor: { select: userInfo } },
        }),
        prisma.adminAudit.count({ where }),
      ]);
    } else if (resource === "requests") {
      const where: Prisma.ChatRequestWhereInput = {
        status: "PENDING",
        createdAt: { lt: new Date(Date.now() - 300000) },
      };
      [items, total] = await Promise.all([
        prisma.chatRequest.findMany({
          ...page,
          where,
          select: {
            id: true,
            userId: true,
            characterId: true,
            coins: true,
            status: true,
            createdAt: true,
            user: { select: userInfo },
          },
        }),
        prisma.chatRequest.count({ where }),
      ]);
    } else if (resource === "settings") {
      const { version, config } = await loadModelConfiguration();
      const chat = config.routes.find((r) => r.feature === "CHAT" && r.enabled);
      const chatModel = config.models.find(
        (m) => m.id === chat?.stages.CHAT?.[0],
      );
      const [db, cache] = await Promise.allSettled([
        prisma.$queryRaw`SELECT 1`,
        redis.ping(),
      ]);
      return NextResponse.json(
        {
          demo: demoMode(),
          model: chatModel?.model || process.env.OPENAI_MODEL || "gpt-6-luna",
          aiConfigured: version
            ? !!chatModel &&
              config.providers.some(
                (p) =>
                  p.id === chatModel.providerId && p.enabled && p.encryptedKey,
              )
            : !!process.env.OPENAI_API_KEY,
          moderationConfigured:
            !!process.env.OPENAI_API_KEY ||
            config.providers.some(
              (p) => p.kind === "OPENAI" && p.enabled && p.encryptedKey,
            ),
          paymentConfigured: !!process.env.STRIPE_SECRET_KEY,
          webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
          database: db.status === "fulfilled",
          redis: cache.status === "fulfilled",
          plans,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } else throw new HttpError(404, "页面不存在");
    const hasMore = items.length > 20;
    const shown = items.slice(0, 20) as { id: string }[];
    return NextResponse.json(
      { items: shown, total, nextCursor: hasMore ? shown.at(-1)!.id : null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  try {
    sameOrigin(request);
    const actor = await requireAdmin();
    const { resource } = await context.params;
    if (resource !== "actions") throw new HttpError(404, "操作不存在");
    await limit("admin:" + actor.id, 60);
    const input = adminActionSchema.parse(await jsonBody(request));
    await performAdminAction(actor.id, input);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
