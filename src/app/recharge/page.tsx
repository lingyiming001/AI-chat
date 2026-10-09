"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Coins, ArrowUpRight, Check, Wallet } from "lucide-react";
import { Nav } from "@/components/Nav";
import { api, useSession } from "@/components/Session";
type WalletData = {
  balance: number;
  demo: boolean;
  plans: { id: string; name: string; coins: number; amountCents: number }[];
  records: { id: string; reason: string; amount: number; createdAt: string }[];
  orders: { id: string; status: string; amountCents: number; coins: number }[];
};
export default function Recharge() {
  const { user, refresh, loading } = useSession();
  const [data, setData] = useState<WalletData | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const d = await api<WalletData>("/api/wallet");
    setData(d);
  }, []);
  useEffect(() => {
    if (user) void load().catch((e) => setError(e.message));
  }, [user, load]);
  useEffect(() => {
    if (new URLSearchParams(location.search).get("payment") === "returned")
      setNotice("已返回钱包。充值以支付确认到账为准，请刷新余额查看。");
  }, []);
  async function recharge(planId: string) {
    setBusy(planId);
    setError("");
    setNotice("");
    try {
      const result = await api<{
        url?: string;
        demo?: boolean;
        paid?: boolean;
      }>("/api/orders", {
        method: "POST",
        body: JSON.stringify({ planId, requestId: crypto.randomUUID() }),
      });
      if (result.url) location.assign(result.url);
      else {
        setNotice(
          result.demo ? "模拟充值成功，未产生真实扣款。" : "充值已到账",
        );
        await refresh();
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="shell">
      <Nav />
      <main className="main">
        <div className="eyebrow">A LITTLE MORE POSSIBILITY</div>
        <h1 className="page-title">让好对话，继续发生。</h1>
        <p className="muted">星币钱包</p>
        {!loading && !user ? (
          <div className="empty">
            <Wallet />
            <h2>登录后查看余额与账单</h2>
            <Link href="/login" className="button primary">
              登录 / 注册
            </Link>
          </div>
        ) : (
          <>
            <section className="wallet-summary">
              <div>
                <span>可用星币</span>
                <h2>
                  <Coins size={30} />
                  {data?.balance ?? "—"}
                  <small>星币</small>
                </h2>
              </div>
              <button
                className="button"
                onClick={async () => {
                  try {
                    await load();
                    await refresh();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                刷新余额
              </button>
            </section>
            {data?.demo && (
              <p className="notice">
                当前为演示钱包，充值不扣真实款项，星币仅用于本地体验。
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            <div className="plans">
              {data?.plans.map((p, i) => (
                <article
                  className={"plan " + (i === 1 ? "recommended" : "")}
                  key={p.id}
                >
                  {i === 1 && <span className="plan-badge">畅聊之选</span>}
                  <span className="eyebrow">0{i + 1}</span>
                  <h3>{p.name}</h3>
                  <div className="plan-coins">
                    {p.coins}
                    <span> 星币</span>
                  </div>
                  <p className="plan-price">
                    ¥ {(p.amountCents / 100).toFixed(2)}
                  </p>
                  <p className="muted">
                    <Check size={15} />
                    所有角色通用
                  </p>
                  <button
                    className={"button " + (i === 1 ? "primary" : "")}
                    disabled={!!busy}
                    onClick={() => void recharge(p.id)}
                  >
                    {busy === p.id
                      ? "正在处理…"
                      : data.demo
                        ? "模拟充值"
                        : "前往支付"}
                    <ArrowUpRight size={16} />
                  </button>
                </article>
              ))}
            </div>
            <h2 className="section-title">星币明细</h2>
            <div className="ledger">
              {data?.records.map((r) => (
                <div key={r.id}>
                  <div>
                    <strong>{r.reason}</strong>
                    <small>
                      {new Date(r.createdAt).toLocaleString("zh-CN")}
                    </small>
                  </div>
                  <span className={r.amount > 0 ? "positive" : ""}>
                    {r.amount > 0 ? "+" : ""}
                    {r.amount}
                  </span>
                </div>
              ))}
              {!data?.records.length && <p className="muted">暂无账单记录</p>}
            </div>
            {!!data?.orders.length && (
              <>
                <h2 className="section-title">充值订单</h2>
                <div className="ledger">
                  {data.orders.map((o) => (
                    <div key={o.id}>
                      <div>
                        <strong>
                          {o.coins} 星币 · ¥{(o.amountCents / 100).toFixed(2)}
                        </strong>
                        <small>{o.id}</small>
                      </div>
                      <span>
                        {
                          (
                            {
                              PAID: "已到账",
                              PENDING: "待支付",
                              FAILED: "已失败",
                              REFUNDED: "已退款",
                            } as Record<string, string>
                          )[o.status]
                        }
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
