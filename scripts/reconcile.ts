import { prisma } from "../src/lib/db";
import { refundRequest } from "../src/lib/billing";
async function main() {
  const stale = await prisma.chatRequest.findMany({
    where: {
      status: "PENDING",
      createdAt: { lt: new Date(Date.now() - 5 * 60000) },
    },
    take: 1000,
  });
  for (const item of stale) await refundRequest(item.id);
  await prisma.authSession.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  console.log("Reconciled", stale.length, "stale requests");
}
main()
  .catch(() => {
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
