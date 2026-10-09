import test from "node:test";
import assert from "node:assert/strict";
import { sameOrigin, jsonBody, HttpError } from "../src/lib/http";
test("same-origin mutation rejects absent or foreign Origin", () => {
  process.env.APP_URL = "https://example.test";
  for (const origin of ["https://attacker.test", "null", ""]) {
    assert.throws(
      () =>
        sameOrigin(
          new Request("https://example.test/api/auth", {
            headers: origin ? { origin } : {},
          }),
        ),
      HttpError,
    );
  }
  assert.doesNotThrow(() =>
    sameOrigin(
      new Request("https://example.test/api/auth", {
        headers: { origin: "https://example.test" },
      }),
    ),
  );
});
test("request body rejects oversize input", async () => {
  const request = new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ content: "x".repeat(24001) }),
  });
  await assert.rejects(jsonBody(request), HttpError);
});
