"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, MessageCircle } from "lucide-react";
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
            <Link href={"/chat/" + s.character.id} key={s.id}>
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
