import { resolve, join } from "node:path";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { coverIdPattern } from "./character-images";
import { HttpError } from "./http";
const root = () => resolve(process.env.MEDIA_ROOT || ".data/media", "character-covers");
export async function storeCharacterImage(bytes: Buffer) {
  const id = randomUUID() + ".webp";
  await mkdir(root(), { recursive: true, mode: 0o700 });
  await writeFile(join(root(), id), bytes, { flag: "wx", mode: 0o600 });
  return { id, url: "/api/character-images/" + id };
}
export async function readCharacterImage(id: string) {
  if (!coverIdPattern.test(id)) throw new HttpError(404, "图片不存在");
  try { return await readFile(join(root(), id)); }
  catch { throw new HttpError(404, "图片不存在"); }
}
export async function removeCharacterImage(id: string) {
  if (coverIdPattern.test(id)) await unlink(join(root(), id)).catch(() => {});
}
