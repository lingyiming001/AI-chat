import sharp from "sharp";
import { z } from "zod";
import { HttpError } from "./http";

export const coverIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/;
export const characterImageUrl = z.string().refine((value) => {
  if (value.startsWith("/api/character-images/"))
    return coverIdPattern.test(value.slice("/api/character-images/".length));
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}, "请选择图片或填写 HTTPS 图片地址");

export async function normalizeCharacterImage(bytes: Buffer, mime: string) {
  if (!bytes.length || bytes.length > 5 * 1024 * 1024)
    throw new HttpError(413, "图片大小须在 5MB 以内");
  const formats: Record<string, string> = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };
  if (!formats[mime]) throw new HttpError(400, "仅支持 JPG、PNG、WebP 图片");
  try {
    const image = sharp(bytes, { limitInputPixels: 20_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    if (metadata.format !== formats[mime] || (metadata.pages || 1) > 1)
      throw new Error("Invalid image format");
    return await image.rotate().resize({ width: 1200, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  } catch { throw new HttpError(400, "图片无法读取，请选择有效的静态 JPG、PNG 或 WebP 图片"); }
}
