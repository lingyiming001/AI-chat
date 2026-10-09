"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass,
  MessageCircle,
  Plus,
  Wallet,
  Sparkles,
  LogOut,
  ArrowUpRight,
  UserRound,
  ShieldCheck,
  ChevronDown,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, useSession } from "./Session";
export function Nav() {
  const path = usePathname();
  const { user, demo, refresh } = useSession();
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const items = [
    { href: "/", icon: Compass, label: "发现角色" },
    { href: "/conversations", icon: MessageCircle, label: "我的对话" },
    { href: "/characters", icon: UserRound, label: "我的角色" },
    { href: "/recharge", icon: Wallet, label: "星币钱包" },
  ];
  return (
    <aside className="sidebar">
      <Link href="/" className="brand">
        <span className="brand-mark">
          <Sparkles size={23} />
        </span>
        <span>
          星聊<span className="brand-en">XINGLIAO</span>
        </span>
      </Link>
      <div className="side-caption">你的灵感，在这里相遇</div>
      <nav className="side-links">
        {items.map(({ href, icon: Icon, label }) => (
          <Link
            className={path === href ? "active" : ""}
            href={href}
            key={href}
          >
            <Icon size={19} />
            {label}
            {path === href && <span className="active-dot" />}
          </Link>
        ))}
      </nav>
      <Link href="/create" className="button primary create-link">
        <Plus size={18} />
        创建角色
      </Link>
      <div className="sidebar-bottom">
        {user?.role === "ADMIN" && (
          <Link href="/admin" className="button account-login">
            <ShieldCheck size={16} />
            管理后台
          </Link>
        )}
        <div className="side-note">
          <Sparkles size={20} />
          <strong>给想象一个回应</strong>
          <p>遇见新视角，开启新故事。</p>
          <Link href="/">
            探索角色 <ArrowUpRight size={14} />
          </Link>
        </div>
        {demo && <div className="demo-label">演示环境 · 模拟 AI 与充值</div>}
        {user ? (
          <details className="account-menu" key={path} ref={menu}>
            <summary className="account" aria-label="账户信息菜单">
              <span className="user-avatar">{user.nickname.slice(0, 1)}</span>
              <div>
                <strong>{user.nickname}</strong>
                <small>{user.balance} 星币</small>
              </div>
              <ChevronDown size={16} />
            </summary>
            <div className="account-panel">
              <h3>账户信息</h3>
              <dl>
                <dt>昵称</dt>
                <dd>{user.nickname}</dd>
                <dt>邮箱</dt>
                <dd>{user.email}</dd>
                <dt>余额</dt>
                <dd>{user.balance} 星币</dd>
              </dl>
              {logoutError && (
                <p className="error" role="alert">
                  {logoutError}
                </p>
              )}
              <button
                className="account-logout"
                disabled={logoutBusy}
                onClick={async () => {
                  setLogoutBusy(true);
                  setLogoutError("");
                  try {
                    await api("/api/auth", { method: "DELETE" });
                    await refresh();
                    location.assign("/");
                  } catch (error) {
                    setLogoutError((error as Error).message);
                    setLogoutBusy(false);
                  }
                }}
              >
                <LogOut size={17} />
                {logoutBusy ? "正在退出…" : "退出登录"}
              </button>
            </div>
          </details>
        ) : (
          <Link href="/login" className="button account-login">
            <UserRound size={17} />
            登录 / 注册
          </Link>
        )}
      </div>
    </aside>
  );
}
