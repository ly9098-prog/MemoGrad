import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MemoGrad · 学习账号",
  description: "用一个 MemoGrad 账号连接邮箱、GitHub 与微信学习身份。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
