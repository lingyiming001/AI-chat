import { NextResponse } from "next/server";
import { loadModelConfiguration } from "@/lib/model-config";
import { featureAvailability } from "@/lib/model-router";
import { demoMode } from "@/lib/ai";
import { failure } from "@/lib/http";
import { chatUsesDemo } from "@/lib/model-catalog";
export async function GET() {
  try {
    const { config } = await loadModelConfiguration();
    return NextResponse.json(
      {
        features: featureAvailability(config).map((f) => ({
          ...f,
          enabled:
            !(f.feature === "CHAT"
              ? chatUsesDemo(config, demoMode())
              : demoMode()) && f.enabled,
        })),
        demo: chatUsesDemo(config, demoMode()),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
