import { PrismaClient } from "@prisma/client";
import { featuredCharacters } from "../src/lib/characters";

const prisma = new PrismaClient();

async function main() {
  for (const character of featuredCharacters) {
    await prisma.character.upsert({
      where: { id: character.id },
      update: {
        name: character.name,
        title: character.title,
        avatarUrl: character.avatar,
        greeting: character.greeting,
        systemPrompt: character.systemPrompt,
        tags: character.tags,
        pricePerMessage: character.pricePerMessage,
        status: "PUBLISHED"
      },
      create: {
        id: character.id,
        name: character.name,
        title: character.title,
        avatarUrl: character.avatar,
        greeting: character.greeting,
        systemPrompt: character.systemPrompt,
        tags: character.tags,
        pricePerMessage: character.pricePerMessage,
        status: "PUBLISHED"
      }
    });
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
