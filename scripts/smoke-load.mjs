import { performance } from "node:perf_hooks";
const base = process.env.APP_URL || "http://localhost:3100";
const concurrency = 20;
const total = 500;
let next = 0;
let failed = 0;
const latencies = [];
const start = performance.now();
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next++ < total) {
    const at = performance.now();
    try {
      const response = await fetch(base + "/api/characters");
      const result = await response.json();
      if (!response.ok || !result.characters?.length) failed++;
    } catch { failed++; }
    latencies.push(performance.now() - at);
  }
}));
const elapsed = performance.now() - start;
latencies.sort((a, b) => a - b);
console.log(JSON.stringify({ scope: "local catalog smoke, not DAU certification", requests: total, concurrency, failed, elapsedMs: Math.round(elapsed), rps: +(total / (elapsed / 1000)).toFixed(1), p95Ms: +latencies[Math.floor(total * .95)].toFixed(1), p99Ms: +latencies[Math.floor(total * .99)].toFixed(1) }, null, 2));
if (failed) process.exitCode = 1;
