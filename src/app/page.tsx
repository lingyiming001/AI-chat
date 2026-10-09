"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Search,
  SlidersHorizontal,
  Sparkles,
  MessageCircle,
  Plus,
} from "lucide-react";
import { Nav } from "@/components/Nav";
import { api, fallbackAvatar, RoleCard } from "@/components/Session";
export default function Home() {
  const [characters, setCharacters] = useState<RoleCard[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [sort, setSort] = useState("recommended");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api<{ characters: RoleCard[] }>("/api/characters")
      .then((d) => setCharacters(d.characters))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  const categories: Record<string, string[]> = {
    全部: [],
    日常陪伴: ["陪伴", "生活"],
    创意写作: ["小说", "角色", "世界观"],
    学习成长: ["学习", "考试", "解释", "英语"],
    工作效率: ["创业", "代码", "架构", "增长", "PRD"],
    幻想世界: ["冒险", "科幻"],
  };
  const filtered = characters.filter(
    (c) =>
      (category === "全部" ||
        c.tags.some((t) => categories[category].includes(t))) &&
      (c.name + c.title + c.tags.join(" "))
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  if (sort === "price")
    filtered.sort((a, b) => a.pricePerMessage - b.pricePerMessage);
  return (
    <div className="shell">
      <Nav />
      <main className="main">
        <header className="topbar">
          <span>
            发现 <span className="breadcrumb">/ 角色广场</span>
          </span>
          <Link href="/create">
            成为创作者 <ArrowUpRight size={15} />
          </Link>
        </header>
        <section className="discovery-header">
          <div className="eyebrow">
            <span /> MEET YOUR NEXT CONVERSATION
          </div>
          <h1>
            每一种想象，都有回响<span>。</span>
          </h1>
          <p>一个好奇的问题，一段未完的故事。找到与你同频的 AI 角色。</p>
        </section>
        <section className="editorial-banner">
          <img
            src="https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1600&q=85"
            alt="云雾之间的高山"
          />
          <div className="banner-shade" />
          <div className="banner-content">
            <span className="banner-kicker">
              <Sparkles size={14} /> 本周灵感精选
            </span>
            <h2>
              世界很大，
              <br />
              从一场对话开始。
            </h2>
            <Link href="/chat/mira-story">
              和 Mira 写一个新故事 <ArrowUpRight size={17} />
            </Link>
          </div>
          <span className="banner-index">本周精选 · 灵感不设限</span>
        </section>
        <section className="catalog">
          <div className="section-heading">
            <h2>
              找到你的聊天搭子 <span>{characters.length}</span>
            </h2>
            <div className="search">
              <Search size={17} />
              <input
                aria-label="搜索角色"
                placeholder="搜索名字、兴趣或灵感"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="filters">
            <div className="category-tabs" role="tablist" aria-label="角色分类">
              {Object.keys(categories).map((c) => (
                <button
                  key={c}
                  role="tab"
                  aria-selected={category === c}
                  className={category === c ? "selected" : ""}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <label className="sort">
              <SlidersHorizontal size={15} />
              <select
                aria-label="排序"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="recommended">精选推荐</option>
                <option value="price">星币从低到高</option>
              </select>
            </label>
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {loading && <div className="empty">正在寻找有趣的灵魂…</div>}
          <div className="role-grid">
            {filtered.map((c, i) => (
              <Link
                href={`/chat/${c.id}`}
                className="character-card"
                key={c.id}
              >
                <div className="card-image">
                  <img
                    src={c.avatarUrl || fallbackAvatar}
                    alt={c.name}
                    loading="lazy"
                  />
                  <span className="card-category">{c.tags[0]}</span>
                  <span className="card-arrow">
                    <ArrowUpRight size={19} />
                  </span>
                </div>
                <div className="character-body">
                  <div className="character-name">
                    <h3>{c.name}</h3>
                    <span
                      className={i % 2 ? "status-dot mint" : "status-dot"}
                    />
                  </div>
                  <div className="character-title">{c.title}</div>
                  <p>{c.greeting}</p>
                  <div className="tags">
                    {c.tags.map((t) => (
                      <span key={t}># {t}</span>
                    ))}
                  </div>
                  <div className="card-footer">
                    <span>
                      <MessageCircle size={14} /> 开启对话
                    </span>
                    <span>{c.pricePerMessage} 星币 / 条</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          {!loading && !filtered.length && !error && (
            <div className="empty">
              <Search />
              <h3>暂时没有匹配的角色</h3>
              <button
                className="button"
                onClick={() => {
                  setQuery("");
                  setCategory("全部");
                }}
              >
                查看全部角色
              </button>
            </div>
          )}
        </section>
        <footer className="page-footer">
          <span>每一段对话，都是新的可能。</span>
          <Link href="/create">
            <Plus size={15} />
            创造你的独特角色
          </Link>
        </footer>
      </main>
    </div>
  );
}
