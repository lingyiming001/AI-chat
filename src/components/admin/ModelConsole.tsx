"use client";
import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Save,
  RefreshCw,
  X,
  Play,
  ArrowRight,
  ShieldCheck,
  Network,
  Image as ImageIcon,
  Mic,
  MessageSquare,
  Volume2,
} from "lucide-react";
import { api } from "../Session";
import {
  providerPresets,
  providerConsoles,
  modelPresets,
  importCommonPresets,
  configureDefaultChat,
  capabilityLabels,
  featureLabels,
  requiredStages,
  type ModelConfiguration,
  type Provider,
  type Model,
  type Route,
  type Capability,
  type ProviderKind,
} from "@/lib/model-catalog";
type Run = {
  id: string;
  feature: keyof typeof featureLabels;
  status: string;
  createdAt: string;
  trace: {
    capability: Capability;
    model: string;
    provider: string;
    status: string;
    durationMs: number;
    errorMessage?: string;
  }[];
};
type Payload = {
  config: ModelConfiguration;
  version: number;
  demo: boolean;
  encryptionReady: boolean;
  moderationReady: boolean;
  chat: { demo: boolean; model: string; provider: string; blockers: string[] };
  recent: Run[];
};
const icons = { CHAT: MessageSquare, IMAGE: ImageIcon, STT: Mic, TTS: Volume2 };
export function ModelConsole() {
  const [data, setData] = useState<Payload | null>(null);
  const [config, setConfig] = useState<ModelConfiguration | null>(null);
  const [tab, setTab] = useState("quick");
  const [quickProvider, setQuickProvider] = useState("");
  const [quickModel, setQuickModel] = useState("");
  const [quickKey, setQuickKey] = useState("");
  const [availableModels, setAvailableModels] = useState<
    Record<string, string[]>
  >({});
  const [quickModeration, setQuickModeration] = useState<
    "OPENAI" | "CHAT_MODEL"
  >("OPENAI");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState<
    | { type: "provider"; value: Provider }
    | { type: "model"; value: Model }
    | null
  >(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const dirty =
    !!config && JSON.stringify(config) !== JSON.stringify(data?.config);
  const quickOptions =
    availableModels[quickProvider] ||
    modelPresets[
      config?.providers.find((p) => p.id === quickProvider)?.kind || "OPENAI"
    ] ||
    [];
  const savedQuickModel = data?.config.models.find(
    (m) =>
      m.providerId === quickProvider &&
      m.model === quickModel &&
      m.capability === "CHAT" &&
      m.enabled,
  );
  async function load() {
    const result = await api<Payload>("/api/admin/models");
    setData(result);
    setConfig(result.config);
    const route = result.config.routes.find((r) => r.feature === "CHAT");
    const model = result.config.models.find(
      (m) => m.id === route?.stages.CHAT?.[0],
    );
    const provider =
      result.config.providers.find((p) => p.id === model?.providerId) ||
      result.config.providers.find((p) => p.hasKey) ||
      result.config.providers[0];
    setQuickProvider(provider?.id || "");
    setQuickModel(
      model?.model || modelPresets[provider?.kind || "OPENAI"]?.[0] || "",
    );
    setQuickModeration(
      result.config.textModeration ||
        (result.moderationReady ? "OPENAI" : "CHAT_MODEL"),
    );
    setError("");
    setReason("");
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (editing) dialog.current?.showModal();
    else dialog.current?.close();
  }, [editing]);
  function change(callback: (c: ModelConfiguration) => ModelConfiguration) {
    setConfig((c) => c && callback(c));
    setNotice("");
  }
  function remove(type: "provider" | "model", id: string) {
    if (!confirm("删除此配置及关联路由选择？保存后生效。")) return;
    change((c) => {
      const removed = c.models
        .filter((m) => (type === "model" ? m.id === id : m.providerId === id))
        .map((m) => m.id);
      return {
        ...c,
        providers:
          type === "provider"
            ? c.providers.filter((p) => p.id !== id)
            : c.providers,
        models: c.models.filter((m) => !removed.includes(m.id)),
        routes: c.routes.map((r) => ({
          ...r,
          enabled: removed.some((id) =>
            Object.values(r.stages).some((ids) => ids?.includes(id)),
          )
            ? false
            : r.enabled,
          stages: Object.fromEntries(
            Object.entries(r.stages).map(([key, ids]) => [
              key,
              ids?.filter((id) => !removed.includes(id)),
            ]),
          ),
        })),
      };
    });
  }
  function updateRoute(index: number, patch: Partial<Route>) {
    change((c) => ({
      ...c,
      routes: c.routes.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }));
  }
  function pick(
    index: number,
    capability: Capability,
    position: number,
    value: string,
  ) {
    const route = config!.routes[index];
    const ids = [...(route.stages[capability] || [])];
    const updated =
      position === 0
        ? value
          ? [value, ...(ids[1] && ids[1] !== value ? [ids[1]] : [])]
          : []
        : [ids[0], ...(value ? [value] : [])].filter(Boolean);
    updateRoute(index, { stages: { ...route.stages, [capability]: updated } });
  }
  async function save(nextConfig = config, saveReason = reason) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{
        version: number;
        config: ModelConfiguration;
        moderationReady: boolean;
        chat: Payload["chat"];
      }>("/api/admin/models", {
        method: "POST",
        body: JSON.stringify({
          version: data!.version,
          config: nextConfig,
          reason: saveReason,
        }),
      });
      setData((d) => d && { ...d, ...result });
      setConfig(result.config);
      setReason("");
      setQuickKey("");
      setNotice(
        result.chat.demo
          ? "已保存，当前聊天仍为本地演示。"
          : result.chat.blockers.length
            ? "已保存，但聊天尚未就绪：" + result.chat.blockers.join("；")
            : "已启用真实聊天：" +
              result.chat.provider +
              " / " +
              result.chat.model,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="admin-content model-console">
      <header className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">AI / CONTROL PLANE</p>
          <h1>模型与路由</h1>
          <p>供应商 · 能力 · 功能编排</p>
        </div>
        <div className="admin-heading-actions">
          <button
            className="admin-action"
            aria-label="刷新模型配置"
            title="刷新模型配置"
            disabled={busy}
            onClick={() => {
              if (!dirty || confirm("放弃未保存的修改并刷新？"))
                void load().catch((e) => setError(e.message));
            }}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="admin-toast" role="status">
          {notice}
        </p>
      )}
      {!config || !data ? (
        <div className="admin-empty">
          {error ? "配置加载失败" : "正在读取配置…"}
        </div>
      ) : (
        <>
          <div className="admin-environment">
            <ShieldCheck size={16} />
            <span>
              {data.encryptionReady ? "密钥加密已就绪" : "加密主密钥未配置"}
            </span>
            <span
              className={
                "admin-badge " + (data.moderationReady ? "active" : "rejected")
              }
            >
              {config.textModeration === "CHAT_MODEL"
                ? "文本审核：聊天模型分类"
                : data.moderationReady
                  ? "内容审核已配置"
                  : "内容审核未配置"}
            </span>
            <span className="admin-badge demo">
              {data.chat.demo
                ? "聊天：本地演示"
                : data.chat.blockers.length
                  ? "聊天：配置未就绪"
                  : "聊天：真实模型"}
            </span>
            <span className="admin-updated">
              版本 {data.version}
              {dirty ? " · 未发布修改" : ""}
            </span>
          </div>
          <div className="admin-toolbar">
            <div
              className="admin-filters"
              role="tablist"
              aria-label="模型管理视图"
            >
              {[
                ["quick", "快速配置"],
                ["providers", "供应商"],
                ["models", "模型目录"],
                ["routes", "功能路由"],
                ["runs", "调用记录"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
                  className={tab === key ? "selected" : ""}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            {["providers", "models"].includes(tab) && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  change((c) =>
                    importCommonPresets(c, () => crypto.randomUUID()),
                  );
                  setNotice("常用预设已加入草稿，新增配置默认关闭");
                }}
              >
                <Plus size={16} />
                导入常用预设
              </button>
            )}
            {["providers", "models"].includes(tab) && (
              <button
                className="button"
                disabled={
                  busy || (tab === "models" && !config.providers.length)
                }
                onClick={() =>
                  setEditing(
                    tab === "providers"
                      ? {
                          type: "provider",
                          value: {
                            id: crypto.randomUUID(),
                            name: "OpenAI",
                            kind: "OPENAI",
                            enabled: false,
                          },
                        }
                      : {
                          type: "model",
                          value: {
                            id: crypto.randomUUID(),
                            providerId: config.providers[0].id,
                            name: "",
                            model: "",
                            capability: "CHAT",
                            enabled: true,
                            voice: "",
                          },
                        },
                  )
                }
              >
                <Plus size={16} />
                {tab === "providers" ? "添加供应商" : "添加模型"}
              </button>
            )}
          </div>
          {tab === "quick" && (
            <section className="model-quick">
              <div className="model-current">
                <strong>当前聊天</strong>
                <label className="field">
                  运行模式
                  <select
                    disabled={busy || dirty}
                    value={data.config.chatMode || "AUTO"}
                    onChange={(e) => {
                      const mode = e.target
                        .value as ModelConfiguration["chatMode"];
                      if (
                        !confirm(
                          mode === "DEMO"
                            ? "切换到本地演示，不再调用真实聊天模型？"
                            : "切换后已启用的聊天路由将调用真实模型，可能产生费用。继续？",
                        )
                      )
                        return;
                      void save(
                        { ...config, chatMode: mode },
                        "切换聊天运行模式",
                      );
                    }}
                  >
                    <option value="AUTO">自动 · 路由启用后调用真实模型</option>
                    <option value="LIVE">真实模型 · 不回退演示</option>
                    <option value="DEMO">本地演示</option>
                  </select>
                </label>
                <span>
                  {data.chat.demo
                    ? "本地演示"
                    : data.chat.provider + " / " + data.chat.model}
                </span>
                {data.chat.blockers.length > 0 && (
                  <p className="error">{data.chat.blockers.join("；")}</p>
                )}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    dirty &&
                    !confirm("快速配置将同时发布当前未保存的修改，继续？")
                  )
                    return;
                  if (
                    !confirm(
                      "启用后用户聊天与内容检查将调用供应商 API，可能产生费用。" +
                        (quickModeration === "CHAT_MODEL"
                          ? "通用模型安全分类不等价于生产级专用审核。"
                          : "") +
                        "继续？",
                    )
                  )
                    return;
                  try {
                    const next = configureDefaultChat(
                      config,
                      quickProvider,
                      quickModel.trim(),
                      quickKey,
                      quickModeration,
                      () => crypto.randomUUID(),
                    );
                    void save(next, "快速配置默认聊天模型与内容审核");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <div className="model-quick-fields">
                  <label className="field">
                    供应商
                    <select
                      required
                      value={quickProvider}
                      onChange={(e) => {
                        setQuickProvider(e.target.value);
                        setQuickKey("");
                        const p = config.providers.find(
                          (p) => p.id === e.target.value,
                        );
                        setQuickModel(p ? modelPresets[p.kind]?.[0] || "" : "");
                      }}
                    >
                      <option value="">选择供应商</option>
                      {config.providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.keyValid === false
                            ? " · 密钥格式异常"
                            : p.hasKey
                              ? " · 密钥已保存"
                              : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    API Key
                    <input
                      type="password"
                      autoComplete="new-password"
                      maxLength={500}
                      value={quickKey}
                      onChange={(e) => setQuickKey(e.target.value)}
                      placeholder={
                        config.providers.find((p) => p.id === quickProvider)
                          ?.keyValid === false
                          ? "已保存密钥格式异常，请重新输入"
                          : config.providers.find((p) => p.id === quickProvider)
                                ?.hasKey
                            ? "已保存，留空保持不变"
                            : "输入 API Key"
                      }
                    />
                  </label>
                  <label className="field">
                    常用模型
                    <select
                      value={
                        quickOptions.includes(quickModel) ? quickModel : ""
                      }
                      onChange={(e) => setQuickModel(e.target.value)}
                    >
                      <option value="">自定义模型</option>
                      {quickOptions.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    模型 ID
                    <input
                      required
                      maxLength={120}
                      value={quickModel}
                      onChange={(e) => setQuickModel(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    文本内容审核
                    <select
                      value={quickModeration}
                      onChange={(e) =>
                        setQuickModeration(
                          e.target.value as typeof quickModeration,
                        )
                      }
                    >
                      <option value="OPENAI">
                        OpenAI 专用审核
                        {data.moderationReady ? " · 已配置" : " · 缺少密钥"}
                      </option>
                      <option value="CHAT_MODEL">
                        所选聊天模型安全分类 · 额外 API 调用
                      </option>
                    </select>
                  </label>
                </div>
                {config.providers.find((p) => p.id === quickProvider)
                  ?.keyValid === false && (
                  <p className="error" role="alert">
                    已保存的 API Key 格式异常，请重新粘贴供应商生成的纯密钥
                  </p>
                )}
                <div className="model-quick-actions">
                  <button
                    className="button secondary"
                    type="button"
                    disabled={
                      busy ||
                      !!quickKey ||
                      !config.providers.find((p) => p.id === quickProvider)
                        ?.hasKey
                    }
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        const result = await api<{ models: string[] }>(
                          "/api/admin/models/catalog?providerId=" +
                            quickProvider,
                        );
                        setAvailableModels((old) => ({
                          ...old,
                          [quickProvider]: result.models,
                        }));
                        setNotice(
                          "已读取供应商模型列表，共 " +
                            result.models.length +
                            " 个",
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <RefreshCw size={16} />
                    读取可用模型
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    disabled={busy || dirty || !!quickKey || !savedQuickModel}
                    onClick={async () => {
                      if (
                        !confirm(
                          "连通测试会发送真实 API 请求，可能产生费用。继续？",
                        )
                      )
                        return;
                      setBusy(true);
                      setError("");
                      try {
                        const result = await api<{ durationMs: number }>(
                          "/api/admin/models/test",
                          {
                            method: "POST",
                            body: JSON.stringify({ id: savedQuickModel!.id }),
                          },
                        );
                        setNotice(
                          "模型连通成功 · " + result.durationMs + " ms",
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Play size={16} />
                    测试已保存模型
                  </button>
                  <button
                    className="button"
                    disabled={busy || !data.encryptionReady || !quickProvider}
                  >
                    <Save size={16} />
                    保存并启用聊天
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      change((c) =>
                        importCommonPresets(c, () => crypto.randomUUID()),
                      );
                      setTab("providers");
                    }}
                  >
                    <Plus size={16} />
                    导入供应商
                  </button>
                </div>
              </form>
            </section>
          )}
          {tab === "providers" && (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>供应商</th>
                    <th>接口地址</th>
                    <th>密钥</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {config.providers.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.name}</strong>
                        <small className="admin-secondary">
                          {providerPresets[p.kind].name}
                        </small>
                      </td>
                      <td className="model-endpoint">
                        {providerPresets[p.kind].baseUrl}
                      </td>
                      <td>
                        {p.clearKey
                          ? "待清除"
                          : p.apiKey
                            ? "待更新"
                            : p.keyValid === false
                              ? "格式异常"
                              : p.hasKey
                                ? "已配置"
                                : "未配置"}
                      </td>
                      <td>
                        <label className="model-toggle">
                          <input
                            type="checkbox"
                            aria-label={p.name + "启用"}
                            checked={p.enabled}
                            onChange={(e) =>
                              change((c) => ({
                                ...c,
                                providers: c.providers.map((v) =>
                                  v.id === p.id
                                    ? { ...v, enabled: e.target.checked }
                                    : v,
                                ),
                              }))
                            }
                          />
                          <span>{p.enabled ? "启用" : "停用"}</span>
                        </label>
                      </td>
                      <td>
                        <div className="admin-row-actions">
                          <button
                            className="admin-action"
                            title="编辑供应商"
                            aria-label={"编辑供应商 " + p.name}
                            onClick={() =>
                              setEditing({
                                type: "provider",
                                value: { ...p, apiKey: p.apiKey || "" },
                              })
                            }
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            className="admin-action"
                            title="删除供应商"
                            aria-label={"删除供应商 " + p.name}
                            onClick={() => remove("provider", p.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!config.providers.length && (
                <div className="admin-empty">
                  <Network size={26} />
                  <strong>暂无供应商</strong>
                </div>
              )}
            </div>
          )}
          {tab === "models" && (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>模型名称</th>
                    <th>供应商</th>
                    <th>模型 ID</th>
                    <th>能力</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {config.models.map((m) => (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td>
                        {
                          config.providers.find((p) => p.id === m.providerId)
                            ?.name
                        }
                      </td>
                      <td>
                        <code>{m.model}</code>
                      </td>
                      <td>
                        <span className="model-capability">
                          {(() => {
                            const Icon = icons[m.capability];
                            return <Icon size={14} />;
                          })()}
                          {capabilityLabels[m.capability]}
                        </span>
                      </td>
                      <td>
                        <label className="model-toggle">
                          <input
                            type="checkbox"
                            checked={m.enabled}
                            aria-label={m.name + "启用"}
                            onChange={(e) =>
                              change((c) => ({
                                ...c,
                                models: c.models.map((v) =>
                                  v.id === m.id
                                    ? { ...v, enabled: e.target.checked }
                                    : v,
                                ),
                              }))
                            }
                          />
                          <span>{m.enabled ? "启用" : "停用"}</span>
                        </label>
                      </td>
                      <td>
                        <div className="admin-row-actions">
                          <button
                            className="admin-action"
                            title="编辑模型"
                            aria-label={"编辑模型 " + m.name}
                            onClick={() =>
                              setEditing({ type: "model", value: { ...m } })
                            }
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            className="admin-action"
                            title="删除模型"
                            aria-label={"删除模型 " + m.name}
                            onClick={() => remove("model", m.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                          {m.capability === "CHAT" && (
                            <button
                              className="admin-action"
                              title="付费连通测试"
                              aria-label={"测试模型 " + m.name}
                              disabled={busy || dirty}
                              onClick={async () => {
                                if (
                                  !confirm(
                                    "测试将发送真实 API 请求，可能产生供应商费用。继续？",
                                  )
                                )
                                  return;
                                setBusy(true);
                                setError("");
                                try {
                                  const r = await api<{ durationMs: number }>(
                                    "/api/admin/models/test",
                                    {
                                      method: "POST",
                                      body: JSON.stringify({ id: m.id }),
                                    },
                                  );
                                  setNotice(`连接成功 · ${r.durationMs} ms`);
                                } catch (e) {
                                  setError((e as Error).message);
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              <Play size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!config.models.length && (
                <div className="admin-empty">暂无模型</div>
              )}
            </div>
          )}
          {tab === "routes" && (
            <div className="model-routes">
              {config.routes.map((r, index) => (
                <section className="model-route" key={r.feature}>
                  <header>
                    <h2>{featureLabels[r.feature]}</h2>
                    <label className="model-toggle">
                      <input
                        type="checkbox"
                        aria-label={featureLabels[r.feature] + "启用"}
                        checked={r.enabled}
                        onChange={(e) =>
                          updateRoute(index, { enabled: e.target.checked })
                        }
                      />
                      启用
                    </label>
                    {r.feature !== "CHAT" ? (
                      <label className="model-price">
                        星币 / 次
                        <input
                          aria-label={featureLabels[r.feature] + "价格"}
                          type="number"
                          min={1}
                          max={1000}
                          value={r.coins}
                          onChange={(e) =>
                            updateRoute(index, {
                              coins: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    ) : (
                      <span className="muted">按角色单价计费</span>
                    )}
                  </header>
                  <div className="model-stage-list">
                    {requiredStages[r.feature].map((capability, i) => {
                      const Icon = icons[capability];
                      const choices = config.models.filter(
                        (m) =>
                          m.capability === capability &&
                          m.enabled &&
                          config.providers.some(
                            (p) => p.id === m.providerId && p.enabled,
                          ),
                      );
                      return (
                        <div className="model-stage" key={capability}>
                          <div className="model-stage-label">
                            <span>{i + 1}</span>
                            <Icon size={17} />
                            <strong>{capabilityLabels[capability]}</strong>
                            {i < requiredStages[r.feature].length - 1 && (
                              <ArrowRight size={15} />
                            )}
                          </div>
                          <label>
                            主模型
                            <select
                              aria-label={
                                featureLabels[r.feature] +
                                capabilityLabels[capability] +
                                "主模型"
                              }
                              value={r.stages[capability]?.[0] || ""}
                              onChange={(e) =>
                                pick(index, capability, 0, e.target.value)
                              }
                            >
                              <option value="">未选择</option>
                              {choices.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name} ·{" "}
                                  {
                                    config.providers.find(
                                      (p) => p.id === m.providerId,
                                    )?.name
                                  }
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            备用模型
                            <select
                              aria-label={
                                featureLabels[r.feature] +
                                capabilityLabels[capability] +
                                "备用模型"
                              }
                              disabled={!r.stages[capability]?.[0]}
                              value={r.stages[capability]?.[1] || ""}
                              onChange={(e) =>
                                pick(index, capability, 1, e.target.value)
                              }
                            >
                              <option value="">不使用备用</option>
                              {choices
                                .filter(
                                  (m) => m.id !== r.stages[capability]?.[0],
                                )
                                .map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
          {tab === "runs" && (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>请求</th>
                    <th>功能 / 状态</th>
                    <th>实际模型链</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <code className="admin-id">{r.id}</code>
                      </td>
                      <td>
                        {featureLabels[r.feature]}
                        <small className="admin-secondary">{r.status}</small>
                      </td>
                      <td>
                        {r.trace.length
                          ? r.trace.map((s, i) => (
                              <div className="model-run-step" key={i}>
                                <span
                                  className={
                                    "admin-badge " +
                                    (s.status === "OK" ? "active" : "failed")
                                  }
                                >
                                  {capabilityLabels[s.capability]} · {s.status}
                                </span>
                                <span>
                                  {s.provider} / {s.model}
                                </span>
                                <small>{s.durationMs} ms</small>
                                {s.errorMessage && (
                                  <small className="error">
                                    {s.errorMessage}
                                  </small>
                                )}
                              </div>
                            ))
                          : "演示 / 环境默认"}
                      </td>
                      <td className="admin-time">
                        {new Date(r.createdAt).toLocaleString("zh-CN", {
                          timeZone: "Asia/Shanghai",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.recent.length && (
                <div className="admin-empty">暂无调用记录</div>
              )}
            </div>
          )}
          {tab !== "quick" && (
            <form
              className="model-publish"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <label>
                发布原因
                <input
                  aria-label="配置发布原因"
                  required
                  minLength={2}
                  maxLength={200}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="本次配置变更依据"
                />
              </label>
              <button
                className="button primary"
                type="submit"
                disabled={busy || !dirty || !data.encryptionReady}
              >
                <Save size={16} />
                {busy ? "正在发布…" : "发布配置"}
              </button>
            </form>
          )}
          <dialog
            ref={dialog}
            className="admin-dialog"
            aria-label={
              editing?.type === "provider" ? "供应商配置" : "模型配置"
            }
            onCancel={() => setEditing(null)}
          >
            <div className="admin-dialog-heading">
              <h2>
                {editing?.type === "provider" ? "供应商配置" : "模型配置"}
              </h2>
              <button
                className="icon-button"
                aria-label="关闭配置编辑"
                title="关闭"
                onClick={() => setEditing(null)}
              >
                <X size={18} />
              </button>
            </div>
            {editing && (
              <form
                className="form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const { type, value } = editing;
                  change((c) =>
                    type === "provider"
                      ? {
                          ...c,
                          providers: c.providers.some((p) => p.id === value.id)
                            ? c.providers.map((p) =>
                                p.id === value.id ? (value as Provider) : p,
                              )
                            : [...c.providers, value as Provider],
                        }
                      : {
                          ...c,
                          models: c.models.some((m) => m.id === value.id)
                            ? c.models.map((m) =>
                                m.id === value.id ? (value as Model) : m,
                              )
                            : [...c.models, value as Model],
                        },
                  );
                  setEditing(null);
                }}
              >
                <label className="field">
                  名称
                  <input
                    required
                    maxLength={60}
                    value={editing.value.name}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        value: { ...editing.value, name: e.target.value },
                      } as typeof editing)
                    }
                  />
                </label>
                {editing.type === "provider" ? (
                  <>
                    <label className="field">
                      供应商
                      <select
                        value={editing.value.kind}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            value: {
                              ...editing.value,
                              kind: e.target.value as ProviderKind,
                              apiKey: "",
                              hasKey: false,
                            },
                          })
                        }
                      >
                        {Object.entries(providerPresets).map(([key, p]) => (
                          <option key={key} value={key}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      接口地址
                      <input
                        readOnly
                        value={providerPresets[editing.value.kind].baseUrl}
                      />
                    </label>
                    <label className="field">
                      API Key
                      <input
                        type="password"
                        autoComplete="new-password"
                        maxLength={500}
                        value={editing.value.apiKey || ""}
                        placeholder={
                          editing.value.keyValid === false
                            ? "已保存密钥格式异常，请重新输入"
                            : editing.value.hasKey
                              ? "已配置，留空保持不变"
                              : "输入供应商 API Key"
                        }
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            value: {
                              ...editing.value,
                              apiKey: e.target.value,
                              clearKey: false,
                            },
                          })
                        }
                      />
                    </label>
                    <a
                      href={providerConsoles[editing.value.kind]}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      供应商密钥控制台
                    </a>
                    <label className="model-toggle">
                      <input
                        type="checkbox"
                        checked={editing.value.clearKey || false}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            value: {
                              ...editing.value,
                              clearKey: e.target.checked,
                              apiKey: "",
                            },
                          })
                        }
                      />
                      清除已保存密钥
                    </label>
                  </>
                ) : (
                  <>
                    <label className="field">
                      供应商
                      <select
                        value={editing.value.providerId}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            value: {
                              ...editing.value,
                              providerId: e.target.value,
                              model: "",
                              voice: "",
                              capability: "CHAT",
                            },
                          })
                        }
                      >
                        {config.providers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      常用模型
                      <select
                        value={
                          editing.value.capability === "CHAT" &&
                          (
                            modelPresets[
                              config.providers.find(
                                (p) => p.id === editing.value.providerId,
                              )!.kind
                            ] || []
                          ).includes(editing.value.model)
                            ? editing.value.model
                            : ""
                        }
                        onChange={(e) => {
                          if (!e.target.value) return;
                          setEditing({
                            ...editing,
                            value: {
                              ...editing.value,
                              model: e.target.value,
                              name: e.target.value,
                              capability: "CHAT",
                              voice: "",
                            },
                          });
                        }}
                      >
                        <option value="">自定义模型 ID</option>
                        {(
                          modelPresets[
                            config.providers.find(
                              (p) => p.id === editing.value.providerId,
                            )!.kind
                          ] || []
                        ).map((id) => (
                          <option key={id} value={id}>
                            {id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      模型 ID
                      <input
                        required
                        maxLength={120}
                        value={editing.value.model}
                        placeholder="供应商控制台中的模型 ID"
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            value: { ...editing.value, model: e.target.value },
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      能力
                      <select
                        value={editing.value.capability}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            value: {
                              ...editing.value,
                              capability: e.target.value as Capability,
                            },
                          })
                        }
                      >
                        {providerPresets[
                          config.providers.find(
                            (p) => p.id === editing.value.providerId,
                          )!.kind
                        ].capabilities.map((c) => (
                          <option key={c} value={c}>
                            {capabilityLabels[c]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {editing.value.capability === "TTS" && (
                      <label className="field">
                        声音 ID
                        <input
                          required
                          maxLength={60}
                          value={editing.value.voice}
                          onChange={(e) =>
                            setEditing({
                              ...editing,
                              value: {
                                ...editing.value,
                                voice: e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                    )}
                  </>
                )}
                <label className="model-toggle">
                  <input
                    type="checkbox"
                    checked={editing.value.enabled}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        value: { ...editing.value, enabled: e.target.checked },
                      } as typeof editing)
                    }
                  />
                  启用
                </label>
                <div className="admin-dialog-actions">
                  <button
                    type="button"
                    className="button"
                    onClick={() => setEditing(null)}
                  >
                    取消
                  </button>
                  <button className="button primary" type="submit">
                    确认修改
                  </button>
                </div>
              </form>
            )}
          </dialog>
        </>
      )}
    </main>
  );
}
