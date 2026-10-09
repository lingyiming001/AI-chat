"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, ArrowLeft, Sparkles } from "lucide-react";
import { Nav } from "@/components/Nav";
import { api, fallbackAvatar, useSession } from "@/components/Session";
export default function Create() {
  const { user, loading } = useSession();
  const router = useRouter();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [greeting, setGreeting] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="shell">
      <Nav />
      <main className="main">
        <Link className="back" href="/characters">
          <ArrowLeft size={16} />
          我的角色
        </Link>
        <h1 className="page-title">让你的想象，有自己的声音。</h1>
        <p className="muted">你的角色，仅你可见。</p>
        {!loading && !user ? (
          <div className="empty">
            <h2>登录后开始创作</h2>
            <Link href="/login" className="button primary">
              登录 / 注册
            </Link>
          </div>
        ) : (
          <div className="create-layout">
            <form
              className="form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                const f = new FormData(e.currentTarget);
                try {
                  const d = await api<{ id: string }>("/api/characters", {
                    method: "POST",
                    body: JSON.stringify({
                      name,
                      title,
                      greeting,
                      systemPrompt: f.get("prompt"),
                      tags: String(f.get("tags"))
                        .split(/[,，]/)
                        .map((v) => v.trim())
                        .filter(Boolean),
                    }),
                  });
                  router.push("/chat/" + d.id);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="form-section-title">
                <span>01</span>角色档案
              </div>
              <label className="field">
                角色名称
                <input
                  required
                  maxLength={30}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="为你的角色起个名字"
                />
              </label>
              <label className="field">
                一句话介绍
                <input
                  required
                  maxLength={80}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：穿行于星际的旅行作家"
                />
              </label>
              <label className="field">
                兴趣标签
                <input
                  name="tags"
                  placeholder="旅行，科幻，故事"
                  maxLength={75}
                />
              </label>
              <div className="form-section-title">
                <span>02</span>性格与世界
              </div>
              <label className="field">
                角色设定
                <textarea
                  name="prompt"
                  required
                  minLength={10}
                  maxLength={4000}
                  placeholder="TA 来自哪里？如何说话？有什么独特的经历和个性？"
                />
              </label>
              <label className="field">
                开场白
                <textarea
                  required
                  maxLength={500}
                  value={greeting}
                  onChange={(e) => setGreeting(e.target.value)}
                  placeholder="TA 会如何开启第一段对话？"
                />
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button
                type="submit"
                className="button primary"
                disabled={busy || loading}
              >
                <Plus size={18} />
                {busy ? "正在创建…" : "创建并开始对话"}
              </button>
            </form>
            <aside className="preview">
              <span className="eyebrow">角色预览</span>
              <img src={fallbackAvatar} alt="星空角色封面" />
              <h2>{name || "等待一个名字"}</h2>
              <p className="accent">{title || "属于你的独特角色"}</p>
              <p>{greeting || "第一句话，将从这里开始。"}</p>
              <div className="preview-footer">
                <Sparkles size={16} />
                私密角色 · 1 星币 / 条
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
