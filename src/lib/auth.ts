import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { HttpError } from "./http";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function currentUser() {
  const token = (await cookies()).get("xingliao_session")?.value;
  if (!token) return null;
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hash(token) },
    include: { user: { include: { wallet: true } } },
  });
  return session &&
    session.expiresAt > new Date() &&
    session.user.status === "ACTIVE"
    ? session.user
    : null;
}
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "请先登录");
  return user;
}
export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new HttpError(403, "仅管理员可访问");
  return user;
}
export async function createSession(userId: string) {
  await revokeSession();
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 7 * 86400000);
  await prisma.authSession.create({
    data: { tokenHash: hash(token), userId, expiresAt: expires },
  });
  (await cookies()).set("xingliao_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.APP_URL?.startsWith("https://") ?? false,
    path: "/",
    expires,
  });
}
export async function revokeSession() {
  const jar = await cookies();
  const token = jar.get("xingliao_session")?.value;
  if (token)
    await prisma.authSession.deleteMany({ where: { tokenHash: hash(token) } });
  jar.delete("xingliao_session");
}
