// Preloaded only by the isolated model integration server; never contacts a provider.
if (
  process.env.MODEL_MOCK_TEST !== "1" ||
  new URL(process.env.APP_URL).port !== "3101"
)
  throw new Error("Model mock may only run on the isolated integration server");
const original = globalThis.fetch;
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (
    ![
      "api.openai.com",
      "api.deepseek.com",
      "dashscope.aliyuncs.com",
      "api.anthropic.com",
      "generativelanguage.googleapis.com",
      "open.bigmodel.cn",
      "api.moonshot.cn",
      "ark.cn-beijing.volces.com",
      "api.siliconflow.cn",
    ].includes(url.hostname)
  )
    return original(input, init);
  const headers = new Headers(init?.headers);
  const key =
    headers.get("authorization") ||
    headers.get("x-api-key") ||
    headers.get("x-goog-api-key");
  if (!key?.includes("test-model-"))
    throw new Error("Non-test key rejected by model mock");
  if (url.pathname.endsWith("/models"))
    return Response.json({
      data: [{ id: "mock-chat" }, { id: "mock-backup" }],
    });
  if (url.pathname.endsWith("/moderations")) {
    const body = JSON.parse(init.body);
    return Response.json({
      id: "mock-moderation",
      model: "mock",
      results: [
        {
          flagged:
            typeof body.input === "string" &&
            body.input.includes("BLOCKED_CONTENT"),
        },
      ],
    });
  }
  if (url.pathname.endsWith("/audio/transcriptions"))
    return Response.json({ text: "这是识别得到的用户问题。" });
  if (url.pathname.endsWith("/audio/speech"))
    return new Response(Buffer.from("ID3mock-audio"), {
      headers: { "Content-Type": "audio/mpeg" },
    });
  if (url.pathname.endsWith("/images/generations"))
    return Response.json({ data: [{ b64_json: png }] });
  const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
  const last = body.messages?.at(-1)?.content || "";
  if (
    last.includes("BILLING_CHAT_FAIL") &&
    !body.messages?.[0]?.content.includes("独立的内容安全分类器")
  )
    return Response.json(
      { error: { code: "Arrearage", message: "private-billing-response" } },
      { status: 400 },
    );
  if (
    last.includes("FAIL_ALL") ||
    (last.includes("FAIL_PRIMARY") && key.includes("primary"))
  )
    return new Response("Unavailable", { status: 503 });
  if (url.pathname.endsWith("/chat/completions"))
    return Response.json({
      choices: [
        {
          message: {
            content: body.messages?.[0]?.content.includes(
              "独立的内容安全分类器",
            )
              ? last.includes("BLOCKED_CONTENT")
                ? "BLOCK"
                : last.includes("MALFORMED_CHECK")
                  ? "uncertain"
                  : "ALLOW"
              : "这是一段经过组合模型生成的测试回复。",
          },
        },
      ],
    });
  throw new Error("Unexpected provider path in model mock");
};
