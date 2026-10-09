import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "@/components/Session";

export const metadata: Metadata = {
  title: "星聊 AI 角色平台",
  description: "角色卡、AI 聊天、创作者和充值一体化平台",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
