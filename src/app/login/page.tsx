"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";
import { Nav } from "@/components/Nav";
import { api, useSession } from "@/components/Session";
export default function Login() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const { refresh } = useSession();
  return (
    <div className="shell">
      <Nav />
      <main className="main auth-main">
        <section className="auth-form">
          <Sparkles size={30} className="accent" />
          <div className="eyebrow">YOUR NEXT CHAPTER</div>
          <h1>
            {mode === "login" ? "好久不见，欢迎回来。" : "从这里，遇见新可能。"}
          </h1>
          <p className="muted">
            {mode === "login"
              ? "继续那些值得聊下去的对话。"
              : "注册即可获得 30 星币，开始你的第一段对话。"}
          </p>
          <div className="segmented">
            <button
              className={mode === "login" ? "selected" : ""}
              onClick={() => {
                setMode("login");
                setError("");
              }}
            >
              登录
            </button>
            <button
              className={mode === "register" ? "selected" : ""}
              onClick={() => {
                setMode("register");
                setError("");
              }}
            >
              注册
            </button>
          </div>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                await api("/api/auth", {
                  method: "POST",
                  body: JSON.stringify({
                    mode,
                    email: f.get("email"),
                    password: f.get("password"),
                    ...(mode === "register"
                      ? { nickname: f.get("nickname") }
                      : {}),
                  }),
                });
                await refresh();
                router.push("/");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {mode === "register" && (
              <label className="field">
                昵称
                <input
                  name="nickname"
                  required
                  maxLength={30}
                  autoComplete="nickname"
                  placeholder="你希望被怎样称呼"
                />
              </label>
            )}
            <label className="field">
              邮箱
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </label>
            <label className="field">
              密码
              <input
                name="password"
                type="password"
                required
                minLength={10}
                maxLength={72}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                placeholder="至少 10 位字符"
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button disabled={busy} className="button primary" type="submit">
              {busy ? "请稍候…" : mode === "login" ? "登录星聊" : "创建账户"}
              <ArrowRight size={17} />
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
