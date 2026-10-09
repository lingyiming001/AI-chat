import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { prisma } from "./db";
export type Attachment = { id: string; url: string; mimeType: string };
const root = () => resolve(process.env.MEDIA_ROOT || ".data/media");
export async function saveMedia(
  userId: string,
  requestId: string,
  bytes: Buffer,
  mimeType: string,
): Promise<Attachment> {
  const id = randomUUID();
  await mkdir(root(), { recursive: true, mode: 0o700 });
  await writeFile(join(root(), id), bytes, { flag: "wx", mode: 0o600 });
  try {
    await prisma.mediaAsset.create({
      data: { id, userId, requestId, mimeType, size: bytes.length },
    });
  } catch (error) {
    await unlink(join(root(), id)).catch(() => {});
    throw error;
  }
  return { id, url: "/api/media/" + id, mimeType };
}
export async function removeMedia(id: string) {
  await prisma.mediaAsset.deleteMany({ where: { id } });
  await unlink(join(root(), id)).catch(() => {});
}
export function readMedia(id: string) {
  return readFile(join(root(), id));
}
