"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, MessageCircle, Trash2, Eraser } from "lucide-react";
import { Nav } from "@/components/Nav";
import { api, fallbackAvatar, useSession } from "@/components/Session";
type Conversation = {
  id: string;
  updatedAt: string;
  character: {
    id: string;
    name: string;
    avatarUrl: string | null;
    title: string;
  };
  messages: { content: string }[];
};
export default function Conversations() {
  const { user } = useSession();
  const [items, setItems] = useState<Conversation[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function manage(s: Conversation, action: "clear" | "delete") {
    if (busy || !window.confirm(action === "delete" ? `删除与 ${s.character.name} 的对话及全部消息？无法撤销，已消费星币不会退回。` : `清空与 ${s.character.name} 的全部消息？无法撤销，会话入口保留，已消费星币不会退回。`)) return;
    setBusy(true); setError("");
    try {
      await api("/api/conversations", { method: "POST", body: JSON.stringify({ characterId: s.character.id, action }) });
      setItems((current) => action === "delete" ? current.filter((item) => item.id !== s.id) : current.map((item) => item.id === s.id ? { ...item, messages: [] } : item));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (user)
      api<{ sessions: Conversation[] }>("/api/conversations")
        .then((d) => setItems(d.sessions))
        .catch((e) => setError(e.message));
  }, [user]);
  return (
    <div className="shell">
      <Nav />
      <main className="main">
        <div className="eyebrow">KEEP THE CONVERSATION GOING</div>
        <h1 className="page-title">我的对话</h1>
        <p className="muted">故事未完，随时回来。</p>
        {error && <p className="error">{error}</p>}
        <div className="conversation-list">
          {items.map((s) => (
            <div className="conversation-row" key={s.id}>
            <Link href={"/chat/" + s.character.id}>
              <img
                className="avatar"
                src={s.character.avatarUrl || fallbackAvatar}
                alt={s.character.name}
              />
              <div>
                <h3>{s.character.name}</h3>
                <p>{s.messages[0]?.content || s.character.title}</p>
              </div>
              <time>{new Date(s.updatedAt).toLocaleDateString("zh-CN")}</time>
              <ArrowUpRight size={19} />
            </Link>
            <button className="icon-button" title="清空消息" aria-label={"清空与" + s.character.name + "的消息"} disabled={busy} onClick={() => void manage(s, "clear")}><Eraser size={18} /></button>
            <button className="icon-button" title="删除对话" aria-label={"删除与" + s.character.name + "的对话"} disabled={busy} onClick={() => void manage(s, "delete")}><Trash2 size={18} /></button>
            </div>
          ))}
        </div>
        {!items.length && (
          <div className="empty">
            <MessageCircle />
            <h2>{user ? "还没有对话" : "登录后继续你的对话"}</h2>
            <Link className="button primary" href={user ? "/" : "/login"}>
              {user ? "发现角色" : "登录 / 注册"}
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
