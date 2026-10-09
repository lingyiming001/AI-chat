import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../src/lib/db";
async function main() {
  const email = z.email().parse(process.argv[2]?.toLowerCase());
  const adminUsername = z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .parse(process.argv[3])
    .toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.status !== "ACTIVE") throw new Error("Account is not active");
    await prisma.user.update({
      where: { id: existing.id },
      data: { role: "ADMIN", adminUsername },
    });
    console.log(
      "Administrator enabled:",
      adminUsername,
      "(existing password preserved)",
    );
  } else {
    const password = randomBytes(15).toString("base64url");
    await prisma.user.create({
      data: {
        email,
        adminUsername,
        nickname: "平台管理员",
        role: "ADMIN",
        passwordHash: await bcrypt.hash(password, 12),
        wallet: { create: {} },
      },
    });
    console.log(
      "Administrator:",
      adminUsername,
      "\nInitial password:",
      password,
    );
  }
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
