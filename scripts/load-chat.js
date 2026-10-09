import http from "k6/http";
import { check } from "k6";
import { SharedArray } from "k6/data";
// Each VU needs its own pre-funded account to avoid intentionally enforced per-user locks.
const cookies = new SharedArray("sessions", () =>
  JSON.parse(open(__ENV.SESSIONS_FILE)),
);
export const options = {
  vus: 100,
  duration: "10m",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<15000"],
  },
};
export default function () {
  const base = __ENV.BASE_URL;
  if (!base || cookies.length < 100)
    throw new Error("BASE_URL and 100 funded session cookies required");
  const bytes = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  );
  bytes[12] = "4";
  bytes[16] = "8";
  const raw = bytes.join("");
  const id =
    raw.slice(0, 8) +
    "-" +
    raw.slice(8, 12) +
    "-" +
    raw.slice(12, 16) +
    "-" +
    raw.slice(16, 20) +
    "-" +
    raw.slice(20);
  const response = http.post(
    base + "/api/chat",
    JSON.stringify({
      requestId: id,
      characterId: "luna-strategist",
      content: "请给出一个简短的学习建议",
    }),
    {
      headers: {
        "Content-Type": "application/json",
        Origin: base,
        Cookie: cookies[__VU - 1],
      },
    },
  );
  check(response, {
    completed: (r) => r.status === 200 && r.body.includes('"type":"done"'),
  });
}
