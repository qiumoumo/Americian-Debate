import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "美辩",
  description: "本地优先的辩论工作台。"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
      </head>
      <body>{children}</body>
    </html>
  );
}
