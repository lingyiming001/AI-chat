import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSession, currentUser, revokeSession } from "@/lib/auth";
import { failure, HttpError, jsonBody, sameOrigin } from "@/lib/http";
import { limit } from "@/lib/limits";
import { demoMode } from "@/lib/ai";
export async function GET() {
  try {
    const user = await currentUser();
    return NextResponse.json(
      {
        user: user
          ? {
              id: user.id,
              email: user.email,
              nickname: user.nickname,
              balance: user.wallet?.balance ?? 0,
              role: user.role,
            }
          : null,
        demo: demoMode(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const data = z
      .object({
        mode: z.enum(["login", "register"]),
        email: z
          .email()
          .max(254)
          .transform((v) => v.toLowerCase()),
        password: z.string().min(10).max(72),
        nickname: z.string().trim().min(1).max(30).optional(),
        adminOnly: z.boolean().optional(),
      })
      .parse(await jsonBody(request));
    await limit("auth:" + data.email, 10, 900);
    await limit("auth:global", 1000);
    let user = await prisma.user.findUnique({ where: { email: data.email } });
    if (data.adminOnly || user?.role === "ADMIN")
      throw new HttpError(403, "管理员请使用独立后台登录入口");
    if (data.mode === "register") {
      if (data.adminOnly) throw new HttpError(403, "管理员账号由运营创建");
      if (user) throw new HttpError(409, "无法注册该邮箱，请尝试登录");
      const passwordHash = await bcrypt.hash(data.password, 12);
      user = await prisma.user.create({
        data: {
          email: data.email,
          passwordHash,
          nickname: data.nickname || data.email.split("@")[0],
          wallet: {
            create: {
              balance: 30,
              records: {
                create: {
                  amount: 30,
                  reason: "注册赠送",
                  refType: "WELCOME",
                  refId: data.email,
                },
              },
            },
          },
        },
      });
    } else if (
      !user ||
      user.status !== "ACTIVE" ||
      !(await bcrypt.compare(data.password, user.passwordHash))
    ) {
      throw new HttpError(401, "邮箱或密码不正确");
    }
    if (data.adminOnly && user.role !== "ADMIN")
      throw new HttpError(403, "该账号没有管理员权限");
    await createSession(user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    await revokeSession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
