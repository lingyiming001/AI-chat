"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, ArrowUpRight, Send } from "lucide-react";
import { Nav } from "@/components/Nav";
import {
  api,
  RoleCard,
  fallbackAvatar,
  useSession,
} from "@/components/Session";
export default function Characters() {
  const { user, loading } = useSession();
  const [items, setItems] = useState<RoleCard[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState("");
  useEffect(() => {
    if (user)
      api<{ characters: RoleCard[] }>("/api/characters?mine=1")
        .then((d) => setItems(d.characters))
        .catch((e) => setError(e.message));
  }, [user]);
  return (
    <div className="shell">
      <Nav />
      <main className="main">
        <div className="section-heading">
          <div>
            <div className="eyebrow">YOUR CHARACTERS</div>
            <h1 className="page-title">我的角色</h1>
          </div>
          <Link href="/create" className="button primary">
            <Plus size={17} />
            创建角色
          </Link>
        </div>
        <p className="muted">那些只属于你的个性与故事。</p>
        {error && <p className="error">{error}</p>}
        <div className="role-grid">
          {items.map((c) => (
            <article className="character-card" key={c.id}>
              <Link href={"/chat/" + c.id}>
                <div className="card-image">
                  <img src={c.avatarUrl || fallbackAvatar} alt={c.name} />
                  <span className="card-category">
                    {
                      (
                        {
                          DRAFT: "私密角色",
                          REVIEWING: "审核中",
                          PUBLISHED: "已公开",
                          REJECTED: "未通过审核",
                          ARCHIVED: "已下架",
                        } as Record<string, string>
                      )[c.status]
                    }
                  </span>
                </div>
                <div className="character-body">
                  <h3>{c.name}</h3>
                  <p>{c.title}</p>
                  <span className="inline-link">
                    开始对话 <ArrowUpRight size={16} />
                  </span>
                </div>
              </Link>
              {["DRAFT", "REJECTED"].includes(c.status) && (
                <button
                  className="button"
                  style={{ margin: "0 14px 14px", fontSize: 12 }}
                  disabled={!!submitting}
                  onClick={async () => {
                    setSubmitting(c.id);
                    setError("");
                    try {
                      await api("/api/characters/" + c.id + "/submit", {
                        method: "POST",
                      });
                      setItems((v) =>
                        v.map((item) =>
                          item.id === c.id
                            ? { ...item, status: "REVIEWING" }
                            : item,
                        ),
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setSubmitting("");
                    }
                  }}
                >
                  <Send size={14} />
                  {submitting === c.id ? "提交中…" : "申请公开发布"}
                </button>
              )}
            </article>
          ))}
        </div>
        {!items.length && (
          <div className="empty">
            <h2>
              {!loading && !user
                ? "登录后查看你的角色"
                : "你的第一个角色，正等待诞生"}
            </h2>
            <Link className="button" href={user ? "/create" : "/login"}>
              {user ? "创建角色" : "登录 / 注册"}
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
