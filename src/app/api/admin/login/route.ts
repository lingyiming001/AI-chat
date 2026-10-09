import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { failure, HttpError, jsonBody, sameOrigin } from "@/lib/http";
import { limit } from "@/lib/limits";

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const data = z
      .object({
        username: z
          .string()
          .trim()
          .min(3)
          .max(32)
          .regex(/^[a-zA-Z0-9_-]+$/)
          .transform((v) => v.toLowerCase()),
        password: z.string().min(10).max(72),
      })
      .parse(await jsonBody(request));
    await limit("admin-login:" + data.username, 10, 900);
    await limit("auth:global", 1000);
    const user = await prisma.user.findUnique({
      where: { adminUsername: data.username },
    });
    if (
      !user ||
      user.role !== "ADMIN" ||
      user.status !== "ACTIVE" ||
      !(await bcrypt.compare(data.password, user.passwordHash))
    )
      throw new HttpError(401, "用户名或密码不正确");
    await createSession(user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
