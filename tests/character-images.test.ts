import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { characterImageUrl, normalizeCharacterImage } from "../src/lib/character-images";

test("character covers permit HTTPS or strictly scoped upload URLs only", () => {
  assert.ok(characterImageUrl.safeParse("https://example.com/portrait.jpg").success);
  assert.ok(characterImageUrl.safeParse("/api/character-images/12345678-1234-4123-8123-123456789012.webp").success);
  for (const value of ["javascript:alert(1)", "http://example.com/a.jpg", "//evil.com/a", "/api/media/private", "/api/character-images/../../secret", "/api/character-images/12345678-1234-4123-8123-123456789012.webp?x=1"])
    assert.ok(!characterImageUrl.safeParse(value).success);
});
test("cover upload decodes raster pixels, bounds dimensions and removes metadata", async () => {
  const input = await sharp({ create: { width: 1400, height: 1800, channels: 3, background: "#eb5678" } }).jpeg().withMetadata().toBuffer();
  const output = await normalizeCharacterImage(input, "image/jpeg");
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "webp");
  assert.ok(metadata.width! <= 1200 && metadata.height! <= 1600);
  assert.equal(metadata.exif, undefined);
});
test("cover upload rejects oversized, forged, SVG and corrupt files", async () => {
  await assert.rejects(() => normalizeCharacterImage(Buffer.alloc(5 * 1024 * 1024 + 1), "image/png"), /5MB/);
  await assert.rejects(() => normalizeCharacterImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/svg+xml"), /仅支持/);
  await assert.rejects(() => normalizeCharacterImage(Buffer.from("not an image"), "image/png"), /无法读取/);
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(() => normalizeCharacterImage(png, "image/jpeg"), /无法读取/);
});
