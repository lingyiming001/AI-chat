import {
  requiredStages,
  type Capability,
  type Feature,
  type ModelConfiguration,
  type Route,
} from "./model-catalog";
import {
  invokeModel,
  ProviderFailure,
  type StageInput,
  type StageOutput,
} from "./model-adapters";
import { HttpError } from "./http";
export type ModelTrace = {
  capability: Capability;
  model: string;
  provider: string;
  status: "OK" | "FAILED";
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
};
export class ModelExecutionError extends HttpError {
  constructor(
    public trace: ModelTrace[],
    message = "模型暂时不可用，请稍后重试",
  ) {
    super(503, message);
  }
}
export function enabledRoute(config: ModelConfiguration, feature: Feature) {
  const route = config.routes.find((r) => r.feature === feature && r.enabled);
  if (!route) throw new HttpError(503, "该功能尚未配置或已停用");
  return route;
}
export async function runStage(
  config: ModelConfiguration,
  route: Route,
  capability: Capability,
  input: StageInput,
  trace: ModelTrace[],
  invoke = invokeModel,
): Promise<StageOutput> {
  for (const id of route.stages[capability] || []) {
    const model = config.models.find(
      (m) => m.id === id && m.enabled && m.capability === capability,
    );
    const provider = config.providers.find(
      (p) => p.id === model?.providerId && p.enabled && p.encryptedKey,
    );
    if (!model || !provider) throw new ModelExecutionError(trace);
    const start = Date.now();
    try {
      const output = await invoke(provider, model, capability, input);
      trace.push({
        capability,
        model: model.model,
        provider: provider.name,
        status: "OK",
        durationMs: Date.now() - start,
      });
      return output;
    } catch (error) {
      trace.push({
        capability,
        model: model.model,
        provider: provider.name,
        status: "FAILED",
        durationMs: Date.now() - start,
        ...(error instanceof ProviderFailure
          ? { errorCode: error.code, errorMessage: error.message }
          : {}),
      });
      if (!(error instanceof ProviderFailure) || !error.retryable)
        throw new ModelExecutionError(
          trace,
          error instanceof ProviderFailure ? error.message : undefined,
        );
    }
  }
  throw new ModelExecutionError(trace);
}
export function featureAvailability(config: ModelConfiguration) {
  return config.routes.map((r) => ({
    feature: r.feature,
    enabled:
      r.enabled &&
      requiredStages[r.feature].every((c) =>
        (r.stages[c] || []).some((id) => {
          const m = config.models.find(
            (v) => v.id === id && v.enabled && v.capability === c,
          );
          return (
            m &&
            config.providers.some(
              (p) => p.id === m.providerId && p.enabled && p.encryptedKey,
            )
          );
        }),
      ),
    coins: r.coins,
  }));
}
