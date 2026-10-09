"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, ArrowRight, ArrowLeft, Sparkles } from "lucide-react";
import { api, useSession } from "@/components/Session";
export default function AdminLogin() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { refresh } = useSession();
  const router = useRouter();
  return (
    <main className="admin-login">
      <Link href="/" className="admin-login-brand">
        <Sparkles size={23} />
        星聊<span>运营管理</span>
      </Link>
      <section>
        <ShieldCheck size={32} className="accent" />
        <p className="admin-eyebrow">XINGLIAO CONSOLE</p>
        <h1>欢迎回来，管理员。</h1>
        <p className="muted">进入平台运营工作台</p>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              await api("/api/admin/login", {
                method: "POST",
                body: JSON.stringify({
                  username: f.get("username"),
                  password: f.get("password"),
                }),
              });
              await refresh();
              router.push("/admin");
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            管理员用户名
            <input
              name="username"
              type="text"
              minLength={3}
              maxLength={32}
              autoComplete="username"
              required
              placeholder="输入管理员用户名"
            />
          </label>
          <label className="field">
            密码
            <input
              name="password"
              type="password"
              minLength={10}
              maxLength={72}
              autoComplete="current-password"
              required
              placeholder="输入管理员密码"
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? "正在登录…" : "进入管理后台"}
            <ArrowRight size={16} />
          </button>
        </form>
        <Link href="/" className="admin-return">
          <ArrowLeft size={14} />
          返回星聊
        </Link>
      </section>
    </main>
  );
}
