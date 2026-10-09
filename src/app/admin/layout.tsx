import type { Metadata } from "next";
import "./admin.css";
export const metadata: Metadata = { title: "星聊 · 管理后台", robots: { index: false, follow: false } };
export default function Layout({children}:{children:React.ReactNode}) { return children; }
