import http from "k6/http";
import { check } from "k6";
export const options = {
  scenarios: {
    catalog: {
      executor: "ramping-arrival-rate",
      startRate: 20,
      timeUnit: "1s",
      preAllocatedVUs: 100,
      maxVUs: 1000,
      stages: [
        { target: 100, duration: "1m" },
        { target: 500, duration: "5m" },
        { target: 500, duration: "10m" },
        { target: 0, duration: "1m" },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<300", "p(99)<800"],
  },
};
export default function () {
  const response = http.get(
    (__ENV.BASE_URL || "http://localhost:3100") + "/api/characters",
  );
  check(response, {
    "catalog available": (r) =>
      r.status === 200 && r.json("characters").length > 0,
  });
}
