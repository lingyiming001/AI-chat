"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  ContactRound,
  Receipt,
  Wallet,
  ScrollText,
  Settings,
  Sparkles,
  ArrowUpRight,
  LogOut,
  AlertCircle,
  Network,
} from "lucide-react";
import { api } from "../Session";
const navigation = [
  { path: "", label: "运营概览", icon: LayoutDashboard },
  { path: "users", label: "用户管理", icon: Users },
  { path: "characters", label: "角色管理", icon: ContactRound },
  { path: "orders", label: "充值订单", icon: Receipt },
  { path: "ledger", label: "钱包流水", icon: Wallet },
  { path: "requests", label: "异常对账", icon: AlertCircle },
  { path: "audit", label: "操作日志", icon: ScrollText },
  { path: "models", label: "模型与路由", icon: Network },
  { path: "settings", label: "系统状态", icon: Settings },
];
export function AdminShell({
  children,
  nickname,
}: {
  children: React.ReactNode;
  nickname: string;
}) {
  const pathname = usePathname();
  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <Link className="admin-brand" href="/admin">
          <span>
            <Sparkles size={23} />
          </span>
          <div>
            星聊<small>运营工作台</small>
          </div>
        </Link>
        <div className="admin-nav-caption">平台管理</div>
        <nav>
          {navigation.map((n) => (
            <Link
              key={n.path}
              className={
                pathname === "/admin" + (n.path ? "/" + n.path : "")
                  ? "active"
                  : ""
              }
              href={"/admin" + (n.path ? "/" + n.path : "")}
            >
              <n.icon size={18} />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <Link href="/">
            <ArrowUpRight size={17} />
            前往用户端
          </Link>
          <div className="admin-identity">
            <span>{nickname.slice(0, 1)}</span>
            <div>
              <strong>{nickname}</strong>
              <small>管理员</small>
            </div>
            <button
              className="icon-button"
              title="退出后台"
              aria-label="退出后台"
              onClick={async () => {
                await api("/api/auth", { method: "DELETE" });
                location.assign("/admin/login");
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <span>
            管理后台 <i>/</i>{" "}
            {navigation.find(
              (n) => pathname === "/admin" + (n.path ? "/" + n.path : ""),
            )?.label || "运营概览"}
          </span>
          <span className="admin-security">
            <span />
            管理员会话
          </span>
        </header>
        {children}
        <footer className="admin-footer">
          <span>星聊 · 平台运营</span>
          <span>Asia / Shanghai</span>
        </footer>
      </div>
    </div>
  );
}
