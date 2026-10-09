import { NextResponse } from "next/server";
import { ZodError } from "zod";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function failure(error: unknown) {
  if (error instanceof HttpError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  if (error instanceof ZodError || error instanceof SyntaxError)
    return NextResponse.json(
      { error: "请检查输入格式与长度" },
      { status: 400 },
    );
  console.error(
    "Request failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return NextResponse.json(
    { error: "服务暂时不可用，请稍后重试" },
    { status: 503 },
  );
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_URL || new URL(request.url).origin;
  if (origin !== expected) throw new HttpError(403, "请求来源不合法");
}
export async function jsonBody(request: Request) {
  if (!request.body) throw new HttpError(400, "请求内容为空");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > 24000) {
      await reader.cancel();
      throw new HttpError(413, "请求内容过长");
    }
    chunks.push(chunk.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
