import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";
import { removeCharacterImage } from "../src/lib/character-image-store";

test("cover upload, saved replacement, permissions and archive visibility", async () => {
  const db = new PrismaClient();
  const base = process.env.APP_URL || "http://localhost:3100";
  const suffix = randomUUID();
  const password = randomUUID() + "!Aa1";
  const users: string[] = [];
  let cover = "", characterId = "";
  try {
    const admin = await db.user.create({ data: { email: `cover-${suffix}@example.test`, adminUsername: `cover-${suffix.slice(0, 20)}`, passwordHash: await bcrypt.hash(password, 10), role: "ADMIN" } });
    users.push(admin.id);
    const login = await fetch(base + "/api/admin/login", { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ username: admin.adminUsername, password }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const png = await sharp({ create: { width: 30, height: 40, channels: 3, background: "#2db69a" } }).png().toBuffer();
    const upload = (auth = "", origin = base, bytes = png, mime = "image/png") => {
      const form = new FormData(); form.set("image", new Blob([new Uint8Array(bytes)], { type: mime }), "cover.png");
      return fetch(base + "/api/admin/character-images", { method: "POST", headers: { Cookie: auth, Origin: origin }, body: form });
    };
    assert.equal((await upload()).status, 401);
    assert.equal((await upload(cookie, "https://evil.example")).status, 403);
    assert.equal((await upload(cookie, base, Buffer.from("fake png"))).status, 400);
    const response = await upload(cookie);
    assert.equal(response.status, 201);
    cover = (await response.json()).url;
    assert.equal((await fetch(base + cover)).status, 404);
    const preview = await fetch(base + cover, { headers: { Cookie: cookie } });
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get("content-type"), "image/webp");
    const character = await db.character.create({ data: { name: "封面验收", title: "临时测试角色", greeting: "你好", systemPrompt: "你是温柔的虚构测试角色。", tags: ["测试"], status: "PUBLISHED" } });
    characterId = character.id;
    const save = await fetch(base + "/api/admin/actions", { method: "POST", headers: { Origin: base, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "character-save", id: character.id, expectedUpdatedAt: character.updatedAt.toISOString(), name: character.name, title: character.title, greeting: character.greeting, systemPrompt: character.systemPrompt, tags: character.tags, pricePerMessage: 1, avatarUrl: cover, reason: "封面上传验收" }) });
    assert.equal(save.status, 200);
    assert.equal((await db.character.findUniqueOrThrow({ where: { id: character.id } })).avatarUrl, cover);
    assert.equal((await fetch(base + cover)).status, 200);
    const catalog = await (await fetch(base + "/api/characters?q=" + encodeURIComponent(character.name))).json();
    assert.equal(catalog.characters[0].avatarUrl, cover);
    await db.character.update({ where: { id: character.id }, data: { status: "ARCHIVED" } });
    assert.equal((await fetch(base + cover)).status, 404);
    assert.equal((await fetch(base + cover, { headers: { Cookie: cookie } })).status, 200);
  } finally {
    if (characterId) await db.character.delete({ where: { id: characterId } });
    if (cover) await removeCharacterImage(cover.split("/").at(-1)!);
    await db.adminAudit.deleteMany({ where: { actorId: { in: users } } });
    await db.authSession.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
});
