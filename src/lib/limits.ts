import Redis from "ioredis";
import { HttpError } from "./http";
const globalRedis = globalThis as unknown as { redis?: Redis };
export const redis =
  globalRedis.redis ??
  new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
globalRedis.redis = redis;
if (!redis.listenerCount("error")) redis.on("error", () => {});
export async function limit(key: string, max: number, seconds = 60) {
  const count = Number(
    await redis.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
      1,
      "limit:" + key,
      seconds,
    ),
  );
  if (count > max) throw new HttpError(429, "操作太频繁，请稍后再试");
}
