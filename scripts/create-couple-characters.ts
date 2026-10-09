import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { coupleCharacters } from "../src/lib/couple-characters";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL!);
async function main() {
try {
  const cards = await prisma.$transaction(async (tx) => {
    const result = [];
    for (const card of coupleCharacters) {
      const existing = await tx.character.findUnique({ where: { id: card.id } });
      if (existing) {
        if (existing.ownerId || existing.name !== card.name)
          throw new Error(`Character ID conflict: ${card.id}`);
        result.push({ id: existing.id, name: existing.name, status: existing.status, created: false });
        continue;
      }
      const created = await tx.character.create({
        data: { ...card, tags: [...card.tags], ownerId: null, status: "PUBLISHED", pricePerMessage: 1 },
      });
      result.push({ id: created.id, name: created.name, status: created.status, created: true });
    }
    return result;
  });
  await redis.del("catalog:");
  console.log(JSON.stringify(cards));
} finally {
  await prisma.$disconnect();
  await redis.quit();
}
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Character creation failed");
  process.exitCode = 1;
});
