import test from "node:test";
import assert from "node:assert/strict";
import { coupleCharacters } from "../src/lib/couple-characters";
import { buildCharacterPrompt } from "../src/lib/character-prompt";

test("public couple presets fit character limits and include adult romantic boundaries", () => {
  assert.equal(new Set(coupleCharacters.map((card) => card.id)).size, 2);
  for (const card of coupleCharacters) {
    assert.ok(card.name.length <= 30 && card.title.length <= 80);
    assert.ok(card.greeting.length <= 500);
    assert.ok(card.systemPrompt.length >= 10 && card.systemPrompt.length <= 4000);
    assert.ok(card.tags.length <= 5 && card.tags.every((tag) => tag.length <= 15));
    assert.equal(new URL(card.avatarUrl).protocol, "https:");
    assert.ok(card.systemPrompt.includes("成年"));
    assert.ok(card.systemPrompt.includes("过敏"));
    assert.ok(card.systemPrompt.includes("露骨"));
    const data = JSON.parse(buildCharacterPrompt(card.systemPrompt, card).split("角色资料：\n")[1]);
    assert.equal(data.name, card.name);
    assert.equal(data.setting, card.systemPrompt);
  }
});
