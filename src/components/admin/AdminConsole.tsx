"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Users,
  MessageSquare,
  ContactRound,
  Coins,
  RefreshCw,
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  Plus,
  Pencil,
  Check,
  X,
  Archive,
  ShieldCheck,
  AlertCircle,
  ArrowUpRight,
  Wallet,
  LoaderCircle,
} from "lucide-react";
import { api, fallbackAvatar } from "../Session";
import { CharacterImagePicker } from "../CharacterImagePicker";
type Person = { id: string; email: string; nickname: string | null };
type Row = {
  id: string;
  email?: string;
  nickname?: string;
  role?: string;
  status?: string;
  createdAt: string;
  updatedAt?: string;
  wallet?: { balance?: number; user?: Person };
  user?: Person;
  owner?: Person | null;
  name?: string;
  title?: string;
  avatarUrl?: string;
  greeting?: string;
  systemPrompt?: string;
  tags?: string[];
  pricePerMessage?: number;
  provider?: string;
  providerRef?: string;
  amountCents?: number;
  coins?: number;
  amount?: number;
  reason?: string;
  refType?: string;
  refId?: string;
  actor?: Person;
  action?: string;
  detail?: Record<string, unknown>;
  _count?: { sessions: number; characters: number };
};
type Overview = {
  users: number;
  characters: number;
  reviewing: number;
  messages: number;
  orders: number;
  revenueCents: number;
  demoRevenueCents: number;
  activeUsers: number;
  stale: number;
  trend: { day: string; count: number }[];
  recent: Row[];
  demo: boolean;
};
type SettingsData = {
  demo: boolean;
  model: string;
  aiConfigured: boolean;
  paymentConfigured: boolean;
  webhookConfigured: boolean;
  database: boolean;
  redis: boolean;
  plans: { id: string; name: string; coins: number; amountCents: number }[];
};
type ResponseData = { items: Row[]; total: number; nextCursor: string | null };
type Modal = {
  kind: "status" | "adjust" | "edit" | "sync" | "reconcile";
  row?: Row;
  status?: string;
};
const labels: Record<string, string> = {
  ACTIVE: "正常",
  FROZEN: "已冻结",
  DELETED: "已注销",
  REVIEWING: "待审核",
  PUBLISHED: "已发布",
  REJECTED: "已驳回",
  ARCHIVED: "已下架",
  PENDING: "待处理",
  PAID: "已支付",
  FAILED: "失败",
  REFUNDED: "已退款",
};
const actionLabels: Record<string, string> = {
  "user-status": "账号状态调整",
  "wallet-adjust": "星币调整",
  "character-save": "角色资料更新",
  "character-image-upload": "角色封面上传",
  "character-status": "角色审核 / 上下架",
  "order-sync": "支付平台同步",
  reconcile: "异常请求对账",
};
const configs: Record<
  string,
  { title: string; caption: string; filters: string[] }
> = {
  overview: { title: "运营概览", caption: "平台数据与运营动态", filters: [] },
  users: {
    title: "用户管理",
    caption: "账户状态 · 星币余额",
    filters: ["ACTIVE", "FROZEN"],
  },
  characters: {
    title: "角色管理",
    caption: "公开角色与投稿审核",
    filters: ["REVIEWING", "PUBLISHED", "REJECTED", "ARCHIVED"],
  },
  orders: {
    title: "充值订单",
    caption: "真实支付与模拟充值",
    filters: ["PENDING", "PAID", "FAILED", "REFUNDED"],
  },
  ledger: {
    title: "钱包流水",
    caption: "星币收支明细",
    filters: ["ORDER", "CHAT", "REFUND", "ADMIN", "WELCOME"],
  },
  requests: {
    title: "异常对账",
    caption: "超过五分钟仍未完成的聊天请求",
    filters: [],
  },
  audit: { title: "操作日志", caption: "管理员操作记录", filters: [] },
  settings: { title: "系统状态", caption: "服务连接与运行配置", filters: [] },
};
const fmt = (v: number | undefined) => Number(v || 0).toLocaleString("zh-CN");
const date = (v: string) =>
  new Date(v).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
function Badge({ status }: { status: string }) {
  return (
    <span className={"admin-badge " + status.toLowerCase()}>
      {labels[status] || status}
    </span>
  );
}
function PersonCell({ person }: { person?: Person }) {
  return (
    <div className="admin-person">
      <strong>{person?.nickname || "—"}</strong>
      <small>{person?.email || "—"}</small>
    </div>
  );
}
function ModalForm({
  modal,
  onClose,
  onSuccess,
}: {
  modal: Modal;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const row = modal.row;
  const title =
    modal.kind === "edit"
      ? row
        ? "编辑角色"
        : "新增官方角色"
      : modal.kind === "adjust"
        ? "调整星币余额"
        : modal.kind === "sync"
          ? "核验支付订单"
          : modal.kind === "reconcile"
            ? "对账超时请求"
            : row?.email
              ? modal.status === "FROZEN"
                ? "冻结用户"
                : "恢复用户"
              : modal.status === "PUBLISHED"
                ? "通过并发布角色"
                : modal.status === "REJECTED"
                  ? "驳回角色"
                  : modal.status === "ARCHIVED"
                    ? "下架角色"
                    : "重新进入审核";
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (imageBusy) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason"));
    let body: object;
    if (modal.kind === "edit")
      body = {
        action: "character-save",
        ...(row ? { id: row.id, expectedUpdatedAt: row.updatedAt } : {}),
        name: form.get("name"),
        title: form.get("title"),
        greeting: form.get("greeting"),
        systemPrompt: form.get("systemPrompt"),
        avatarUrl: String(form.get("avatarUrl")).trim() || null,
        tags: String(form.get("tags"))
          .split(/[,，]/)
          .map((v) => v.trim())
          .filter(Boolean),
        pricePerMessage: Number(form.get("price")),
        reason,
      };
    else if (modal.kind === "adjust")
      body = {
        action: "wallet-adjust",
        id: row!.id,
        requestId: requestId.current,
        amount: Number(amount),
        reason,
      };
    else if (modal.kind === "sync")
      body = { action: "order-sync", id: row!.id, reason };
    else if (modal.kind === "reconcile")
      body = { action: "reconcile", id: row!.id, reason };
    else
      body = {
        action: row?.email ? "user-status" : "character-status",
        id: row!.id,
        status: modal.status,
        ...(row?.email ? {} : { expectedStatus: row?.status }),
        reason,
      };
    try {
      await api("/api/admin/actions", {
        method: "POST",
        body: JSON.stringify(body),
      });
      await onSuccess();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="admin-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      aria-label={title}
    >
      <div className="admin-dialog-heading">
        <div>
          <span className="admin-eyebrow">OPERATION</span>
          <h2>{title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="关闭"
          title="关闭"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <form className="form" onSubmit={submit}>
        {modal.kind === "edit" ? (
          <>
            <div className="admin-form-grid">
              <label className="field">
                角色名
                <input
                  name="name"
                  defaultValue={row?.name}
                  maxLength={30}
                  required
                />
              </label>
              <label className="field">
                单条价格（星币）
                <input
                  name="price"
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  defaultValue={row?.pricePerMessage || 1}
                  required
                />
              </label>
            </div>
            <label className="field">
              角色介绍
              <input
                name="title"
                defaultValue={row?.title}
                maxLength={80}
                required
              />
            </label>
            <CharacterImagePicker initial={row?.avatarUrl || ""} onBusyChange={setImageBusy} />
            <label className="field">
              标签
              <input
                name="tags"
                defaultValue={row?.tags?.join("，")}
                placeholder="故事，学习"
              />
            </label>
            <label className="field">
              开场白
              <textarea
                name="greeting"
                maxLength={500}
                defaultValue={row?.greeting}
                required
              />
            </label>
            <label className="field">
              角色设定
              <textarea
                name="systemPrompt"
                maxLength={4000}
                minLength={10}
                defaultValue={row?.systemPrompt}
                required
              />
            </label>
          </>
        ) : (
          <div className="admin-operation-target">
            <strong>{row?.nickname || row?.name || row?.id}</strong>
            <span>{row?.email || row?.user?.email || row?.title || ""}</span>
            {modal.kind === "status" && (
              <div>
                <Badge status={row?.status || ""} />
                <ArrowUpRight size={15} />
                <Badge status={modal.status || ""} />
              </div>
            )}
          </div>
        )}
        {modal.kind === "adjust" && (
          <>
            <label className="field">
              调整数量
              <input
                name="amount"
                type="number"
                step={1}
                min={-100000}
                max={100000}
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="正数增加，负数扣减"
              />
            </label>
            <div className="admin-balance-preview">
              <span>当前 {fmt(row?.wallet?.balance)} 星币</span>
              <span>
                调整后{" "}
                <strong>
                  {fmt((row?.wallet?.balance || 0) + Number(amount || 0))}
                </strong>{" "}
                星币
              </span>
            </div>
          </>
        )}
        <label className="field">
          操作原因
          <textarea
            name="reason"
            required
            minLength={2}
            maxLength={200}
            placeholder="填写本次操作依据"
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="admin-dialog-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
          <button className="button primary" disabled={busy || imageBusy} type="submit">
            {busy ? (
              <LoaderCircle className="admin-spinning" size={16} />
            ) : (
              <Check size={16} />
            )}
            确认{modal.kind === "edit" ? "保存" : ""}
          </button>
        </div>
      </form>
    </dialog>
  );
}
export function AdminConsole({ resource }: { resource: string }) {
  const config = configs[resource];
  const [data, setData] = useState<ResponseData | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [cursors, setCursors] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<Modal | null>(null);
  const sequence = useRef(0);
  const cursor = cursors.at(-1) || "";
  const load = useCallback(async () => {
    const seq = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({
        q: search,
        status,
        ...(cursor ? { cursor } : {}),
      });
      const result = await api<ResponseData & Overview & SettingsData>(
        "/api/admin/" + resource + "?" + query,
      );
      if (seq !== sequence.current) return;
      if (resource === "overview") setOverview(result);
      else if (resource === "settings") setSettings(result);
      else setData(result);
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
    } finally {
      if (seq === sequence.current) setBusy(false);
    }
  }, [resource, search, status, cursor]);
  useEffect(() => {
    const initialStatus = new URLSearchParams(location.search).get("status");
    if (initialStatus && configs[resource].filters.includes(initialStatus)) setStatus(initialStatus);
  }, [resource]);
  useEffect(() => {
    void load();
    return () => {
      sequence.current++;
    };
  }, [load]);
  function filter(value: string) {
    setStatus(value);
    setCursors([]);
  }
  const success = async () => {
    setNotice("操作已完成，审计日志已记录");
    await load();
  };
  function exportCsv() {
    const rows = data?.items || [];
    const fields =
      resource === "users"
        ? ["id", "email", "nickname", "status", "role", "createdAt"]
        : resource === "characters"
          ? ["id", "name", "title", "status", "pricePerMessage", "createdAt"]
          : resource === "orders"
            ? ["id", "provider", "status", "amountCents", "coins", "createdAt"]
            : resource === "ledger"
              ? ["id", "amount", "reason", "refType", "refId", "createdAt"]
              : ["id", "action", "entityId", "createdAt"];
    const escape = (v: unknown) => {
      let s = String(v ?? "");
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const csv =
      "\ufeff" +
      [
        fields.join(","),
        ...rows.map((row) =>
          fields
            .map((f) => escape((row as unknown as Record<string, unknown>)[f]))
            .join(","),
        ),
      ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = resource + "-page.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  function IconAction({
    label,
    children,
    onClick,
    disabled = false,
  }: {
    label: string;
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
  }) {
    return (
      <button
        className="admin-action"
        title={label}
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </button>
    );
  }
  function rows() {
    return data?.items.map((row) => (
      <tr key={row.id}>
        {resource === "users" && (
          <>
            <td>
              <PersonCell
                person={{
                  id: row.id,
                  email: row.email!,
                  nickname: row.nickname || null,
                }}
              />
              <small className="admin-id">{row.id}</small>
            </td>
            <td>
              {row.role === "ADMIN" ? (
                <span className="admin-role">
                  <ShieldCheck size={13} />
                  管理员
                </span>
              ) : (
                "用户"
              )}
            </td>
            <td>
              <Badge status={row.status!} />
            </td>
            <td className="admin-number">
              {fmt(row.wallet?.balance)}
              <small> 星币</small>
            </td>
            <td>
              {fmt(row._count?.sessions)} / {fmt(row._count?.characters)}
            </td>
            <td className="admin-time">{date(row.createdAt)}</td>
            <td>
              <div className="admin-row-actions">
                <IconAction
                  label="调整星币"
                  onClick={() => setModal({ kind: "adjust", row })}
                >
                  <Wallet size={16} />
                </IconAction>
                <IconAction
                  label={row.status === "FROZEN" ? "恢复用户" : "冻结用户"}
                  disabled={row.role === "ADMIN" || row.status === "DELETED"}
                  onClick={() =>
                    setModal({
                      kind: "status",
                      row,
                      status: row.status === "FROZEN" ? "ACTIVE" : "FROZEN",
                    })
                  }
                >
                  {row.status === "FROZEN" ? (
                    <Check size={16} />
                  ) : (
                    <ShieldCheck size={16} />
                  )}
                </IconAction>
              </div>
            </td>
          </>
        )}
        {resource === "characters" && (
          <>
            <td>
              <div className="admin-character">
                <img src={row.avatarUrl || fallbackAvatar} alt={row.name} />
                <div>
                  <strong>{row.name}</strong>
                  <small>{row.title}</small>
                </div>
              </div>
            </td>
            <td>
              {row.owner ? (
                <PersonCell person={row.owner} />
              ) : (
                <span className="admin-role">官方角色</span>
              )}
            </td>
            <td>
              <Badge status={row.status!} />
            </td>
            <td>{row.tags?.slice(0, 3).join(" · ") || "—"}</td>
            <td className="admin-number">{row.pricePerMessage}</td>
            <td className="admin-time">{date(row.createdAt)}</td>
            <td>
              <div className="admin-row-actions">
                <IconAction
                  label="查看与编辑角色"
                  onClick={() => setModal({ kind: "edit", row })}
                >
                  <Pencil size={16} />
                </IconAction>
                {row.status === "REVIEWING" && (
                  <>
                    <IconAction
                      label="审核通过"
                      onClick={() =>
                        setModal({ kind: "status", row, status: "PUBLISHED" })
                      }
                    >
                      <Check size={16} />
                    </IconAction>
                    <IconAction
                      label="驳回投稿"
                      onClick={() =>
                        setModal({ kind: "status", row, status: "REJECTED" })
                      }
                    >
                      <X size={16} />
                    </IconAction>
                  </>
                )}
                {row.status === "PUBLISHED" ? (
                  <IconAction
                    label="下架角色"
                    onClick={() =>
                      setModal({ kind: "status", row, status: "ARCHIVED" })
                    }
                  >
                    <Archive size={16} />
                  </IconAction>
                ) : (
                  row.status !== "REVIEWING" && (
                    <IconAction
                      label="重新审核"
                      onClick={() =>
                        setModal({ kind: "status", row, status: "REVIEWING" })
                      }
                    >
                      <RefreshCw size={16} />
                    </IconAction>
                  )
                )}
              </div>
            </td>
          </>
        )}
        {resource === "orders" && (
          <>
            <td>
              <span className="admin-id">{row.id}</span>
              <small className="admin-secondary">
                {row.providerRef || "—"}
              </small>
            </td>
            <td>
              <PersonCell person={row.user} />
            </td>
            <td>
              <span
                className={
                  "admin-provider " + (row.provider === "demo" ? "demo" : "")
                }
              >
                {row.provider === "demo" ? "模拟充值" : "Stripe"}
              </span>
            </td>
            <td className="admin-number">
              ¥{((row.amountCents || 0) / 100).toFixed(2)}
            </td>
            <td>{fmt(row.coins)}</td>
            <td>
              <Badge status={row.status!} />
            </td>
            <td className="admin-time">{date(row.createdAt)}</td>
            <td>
              <IconAction
                label="核验支付状态"
                disabled={
                  row.provider !== "stripe" ||
                  row.status !== "PENDING" ||
                  !row.providerRef
                }
                onClick={() => setModal({ kind: "sync", row })}
              >
                <RefreshCw size={16} />
              </IconAction>
            </td>
          </>
        )}
        {resource === "ledger" && (
          <>
            <td>
              <PersonCell person={row.wallet?.user} />
            </td>
            <td
              className={
                "admin-number " +
                ((row.amount || 0) > 0 ? "admin-positive" : "")
              }
            >
              {(row.amount || 0) > 0 ? "+" : ""}
              {fmt(row.amount)}
            </td>
            <td>{row.reason}</td>
            <td>
              {(
                {
                  ORDER: "充值",
                  CHAT: "对话预扣",
                  REFUND: "失败退回",
                  ADMIN: "运营调整",
                  WELCOME: "注册赠送",
                } as Record<string, string>
              )[row.refType || ""] || row.refType}
            </td>
            <td>
              <span className="admin-id">{row.refId || "—"}</span>
            </td>
            <td className="admin-time">{date(row.createdAt)}</td>
          </>
        )}
        {resource === "audit" && (
          <>
            <td className="admin-time">{date(row.createdAt)}</td>
            <td>
              <PersonCell person={row.actor} />
            </td>
            <td>{actionLabels[row.action!] || row.action}</td>
            <td>
              <span className="admin-id">
                {(row as unknown as { entityId: string }).entityId}
              </span>
            </td>
            <td>
              <strong className="admin-audit-reason">
                {String(row.detail?.reason || "—")}
              </strong>
              <small className="admin-secondary">
                {row.detail?.before && row.detail?.after
                  ? String(
                      labels[String(row.detail.before)] || row.detail.before,
                    ) +
                    " → " +
                    String(labels[String(row.detail.after)] || row.detail.after)
                  : row.detail?.amount
                    ? String(row.detail.amount) + " 星币"
                    : ""}
              </small>
            </td>
          </>
        )}
        {resource === "requests" && (
          <>
            <td>
              <span className="admin-id">{row.id}</span>
            </td>
            <td>
              <PersonCell person={row.user} />
            </td>
            <td>{(row as unknown as { characterId: string }).characterId}</td>
            <td>{row.coins}</td>
            <td className="admin-time">{date(row.createdAt)}</td>
            <td>
              <button
                className="admin-text-action"
                onClick={() => setModal({ kind: "reconcile", row })}
              >
                <RefreshCw size={14} />
                执行对账
              </button>
            </td>
          </>
        )}
      </tr>
    ));
  }
  const headings: Record<string, string[]> = {
    users: ["用户", "身份", "状态", "余额", "对话 / 角色", "注册时间", "操作"],
    characters: ["角色", "创建者", "状态", "标签", "单价", "创建时间", "操作"],
    orders: [
      "订单号",
      "用户",
      "渠道",
      "金额",
      "星币",
      "状态",
      "创建时间",
      "操作",
    ],
    ledger: ["用户", "星币变动", "备注", "类型", "关联单号", "发生时间"],
    audit: ["操作时间", "管理员", "操作", "对象 ID", "依据"],
    requests: ["请求编号", "用户", "角色编号", "预扣星币", "请求时间", "操作"],
  };
  return (
    <main className="admin-content">
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">PLATFORM / {resource.toUpperCase()}</p>
          <h1>{config.title}</h1>
          <p>{config.caption}</p>
        </div>
        <div className="admin-heading-actions">
          {resource === "characters" && (
            <button
              className="button primary"
              onClick={() => setModal({ kind: "edit" })}
            >
              <Plus size={16} />
              新增角色
            </button>
          )}
          {data && (
            <button
              className="admin-action"
              onClick={exportCsv}
              title="导出当前页"
              aria-label="导出当前页"
            >
              <Download size={18} />
            </button>
          )}
          <button
            className="admin-action"
            title="刷新数据"
            aria-label="刷新数据"
            onClick={() => void load()}
            disabled={busy}
          >
            <RefreshCw size={18} className={busy ? "admin-spinning" : ""} />
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <div className="admin-toast" role="status">
          <Check size={16} />
          {notice}
          <button
            className="icon-button"
            aria-label="关闭通知"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {resource === "overview" && overview && (
        <>
          <div className="admin-environment">
            <span
              className={"admin-badge " + (overview.demo ? "demo" : "active")}
            >
              {overview.demo ? "演示环境" : "生产环境"}
            </span>
            <span>数据实时读取 · 最近 24 小时</span>
            <span className="admin-updated">
              {new Date().toLocaleTimeString("zh-CN", {
                timeZone: "Asia/Shanghai",
                hour12: false,
              })}
            </span>
          </div>
          <div className="admin-metrics">
            {[
              {
                name: "累计用户",
                value: overview.users,
                icon: Users,
                foot: "活跃聊天用户（24h） " + fmt(overview.activeUsers),
                color: "green",
              },
              {
                name: "已发布角色",
                value: overview.characters,
                icon: ContactRound,
                foot: "待审核 " + fmt(overview.reviewing),
                color: "blue",
              },
              {
                name: "完成对话（24h）",
                value: overview.messages,
                icon: MessageSquare,
                foot: "按成功回复计数",
                color: "rose",
              },
              {
                name: "真实充值收入",
                value: "¥" + (overview.revenueCents / 100).toFixed(2),
                icon: Coins,
                foot:
                  "模拟订单金额 ¥" +
                  (overview.demoRevenueCents / 100).toFixed(2),
                color: "gold",
              },
            ].map((m) => (
              <article className="admin-metric" key={m.name}>
                <div>
                  <span>{m.name}</span>
                  <m.icon className={m.color} size={19} />
                </div>
                <strong>
                  {typeof m.value === "number" ? fmt(m.value) : m.value}
                </strong>
                <small>{m.foot}</small>
              </article>
            ))}
          </div>
          <div className="admin-dashboard-grid">
            <section className="admin-chart-section">
              <div className="admin-section-heading">
                <h2>对话趋势</h2>
                <span>近 7 日 · 上海时间</span>
              </div>
              <div className="admin-bars">
                {Array.from({ length: 7 }, (_, i) => {
                  const d = new Date(Date.now() - (6 - i) * 86400000);
                  const day = d.toLocaleDateString("en-CA", {
                    timeZone: "Asia/Shanghai",
                  });
                  const count =
                    overview.trend.find((v) => v.day === day)?.count || 0;
                  const max = Math.max(
                    1,
                    ...overview.trend.map((v) => v.count),
                  );
                  return (
                    <div
                      key={day}
                      className="admin-bar-column"
                      title={day + "：" + count + " 次"}
                    >
                      <span>{fmt(count)}</span>
                      <div>
                        <i
                          style={{
                            height: Math.max(3, (count / max) * 150) + "px",
                          }}
                        />
                      </div>
                      <small>{day.slice(5).replace("-", "/")}</small>
                    </div>
                  );
                })}
              </div>
            </section>
            <section className="admin-queue">
              <div className="admin-section-heading">
                <h2>待办事项</h2>
                <span>运营队列</span>
              </div>
              <Link href="/admin/characters?status=REVIEWING">
                <span className="admin-queue-icon">
                  <ContactRound size={19} />
                </span>
                <div>
                  <strong>角色投稿审核</strong>
                  <small>等待审核的公开投稿</small>
                </div>
                <b>{overview.reviewing}</b>
                <ChevronRight size={16} />
              </Link>
              <Link href="/admin/requests">
                <span className="admin-queue-icon amber">
                  <AlertCircle size={19} />
                </span>
                <div>
                  <strong>超时请求对账</strong>
                  <small>处理中超过五分钟</small>
                </div>
                <b>{overview.stale}</b>
                <ChevronRight size={16} />
              </Link>
              <Link href="/admin/orders">
                <span className="admin-queue-icon blue">
                  <Coins size={19} />
                </span>
                <div>
                  <strong>已支付订单</strong>
                  <small>含演示充值</small>
                </div>
                <b>{overview.orders}</b>
                <ChevronRight size={16} />
              </Link>
            </section>
          </div>
          <section className="admin-recent">
            <div className="admin-section-heading">
              <h2>最近操作</h2>
              <Link href="/admin/audit">
                查看全部 <ArrowUpRight size={14} />
              </Link>
            </div>
            {overview.recent.length ? (
              overview.recent.map((r) => (
                <div key={r.id}>
                  <span className="admin-audit-dot" />
                  <div>
                    <strong>{actionLabels[r.action!] || r.action}</strong>
                    <small>
                      {r.actor?.nickname || r.actor?.email} ·{" "}
                      {String(r.detail?.reason || "")}
                    </small>
                  </div>
                  <time>{date(r.createdAt)}</time>
                </div>
              ))
            ) : (
              <div className="admin-empty">暂无管理操作记录</div>
            )}
          </section>
        </>
      )}
      {resource === "settings" && settings && (
        <>
          <div className="admin-environment">
            <Badge status={settings.demo ? "DEMO" : "ACTIVE"} />
            <span>{settings.demo ? "模拟 AI 与充值" : "真实服务模式"}</span>
          </div>
          <section className="admin-settings-section">
            <h2>服务连接</h2>
            <div className="admin-service-grid">
              {[
                {
                  name: "PostgreSQL",
                  ok: settings.database,
                  sub: "业务数据库",
                },
                { name: "Redis", ok: settings.redis, sub: "缓存与分布式限流" },
                {
                  name: "AI 模型服务",
                  ok: settings.aiConfigured,
                  sub: settings.model,
                },
                {
                  name: "Stripe 支付",
                  ok: settings.paymentConfigured && settings.webhookConfigured,
                  sub: settings.webhookConfigured
                    ? "支付回调已配置"
                    : "支付回调尚未配置",
                },
              ].map((s) => (
                <div key={s.name}>
                  <span className={"admin-service-dot " + (s.ok ? "ok" : "")} />
                  <div>
                    <strong>{s.name}</strong>
                    <small>{s.sub}</small>
                  </div>
                  <span>{s.ok ? "已连接 / 已配置" : "未配置 / 不可用"}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="admin-settings-section">
            <h2>充值套餐</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>套餐</th>
                    <th>星币</th>
                    <th>金额</th>
                  </tr>
                </thead>
                <tbody>
                  {settings.plans.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{fmt(p.coins)}</td>
                      <td>¥{(p.amountCents / 100).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="admin-settings-section">
            <h2>运行策略</h2>
            <dl className="admin-policy">
              <div>
                <dt>登录会话</dt>
                <dd>7 天 · 服务器校验</dd>
              </div>
              <div>
                <dt>收费方式</dt>
                <dd>预扣星币 · 失败退回</dd>
              </div>
              <div>
                <dt>角色目录缓存</dt>
                <dd>30 秒</dd>
              </div>
              <div>
                <dt>内容审核</dt>
                <dd>
                  {settings.demo ? "演示模式未启用审核" : "输入与完整输出审核"}
                </dd>
              </div>
              <div>
                <dt>秘钥管理</dt>
                <dd>部署环境配置</dd>
              </div>
            </dl>
          </section>
        </>
      )}
      {!["overview", "settings"].includes(resource) && (
        <>
          <div className="admin-toolbar">
            <div className="admin-filters">
              <button
                className={!status ? "selected" : ""}
                onClick={() => filter("")}
              >
                全部
              </button>
              {config.filters.map((f) => (
                <button
                  key={f}
                  className={status === f ? "selected" : ""}
                  onClick={() => filter(f)}
                >
                  {labels[f] ||
                    (
                      {
                        ORDER: "充值",
                        CHAT: "对话",
                        REFUND: "退回",
                        ADMIN: "运营",
                        WELCOME: "注册",
                      } as Record<string, string>
                    )[f] ||
                    f}
                </button>
              ))}
            </div>
            {resource !== "requests" && (
              <form
                className="admin-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSearch(q.trim());
                  setCursors([]);
                }}
              >
                <Search size={16} />
                <input
                  aria-label="搜索记录"
                  placeholder={
                    resource === "characters"
                      ? "角色名称 / 介绍"
                      : "邮箱 / 关联编号"
                  }
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                {q && (
                  <button
                    type="button"
                    className="icon-button"
                    title="清空搜索"
                    aria-label="清空搜索"
                    onClick={() => {
                      setQ("");
                      setSearch("");
                      setCursors([]);
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
                <button type="submit">搜索</button>
              </form>
            )}
          </div>
          <div className="admin-table-wrap" aria-busy={busy}>
            <table className="admin-table">
              <thead>
                <tr>
                  {headings[resource].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>{rows()}</tbody>
            </table>
            {!data?.items.length && (
              <div className="admin-empty">
                {busy ? (
                  <>
                    <LoaderCircle size={21} className="admin-spinning" />
                    正在加载…
                  </>
                ) : (
                  <>
                    <Search size={24} />
                    <strong>暂无匹配记录</strong>
                    {search && (
                      <button
                        className="button"
                        onClick={() => {
                          setSearch("");
                          setQ("");
                          setCursors([]);
                        }}
                      >
                        清空搜索
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          <div className="admin-pagination">
            <span>
              共 {fmt(data?.total)} 条 · 第 {cursors.length + 1} 页
            </span>
            <div>
              <button
                className="admin-action"
                title="上一页"
                aria-label="上一页"
                disabled={busy || !cursors.length}
                onClick={() => setCursors((v) => v.slice(0, -1))}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="admin-action"
                title="下一页"
                aria-label="下一页"
                disabled={busy || !data?.nextCursor}
                onClick={() => setCursors((v) => [...v, data!.nextCursor!])}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </>
      )}
      {busy &&
        ["overview", "settings"].includes(resource) &&
        !overview &&
        !settings && (
          <div className="admin-empty">
            <LoaderCircle className="admin-spinning" />
            正在读取平台数据…
          </div>
        )}
      {modal && (
        <ModalForm
          modal={modal}
          onClose={() => setModal(null)}
          onSuccess={success}
        />
      )}
    </main>
  );
}
