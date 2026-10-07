import type { Metadata } from "next";
import { Suspense } from "react";
import "@xyflow/react/dist/style.css";
import "@xterm/xterm/css/xterm.css";
import "./globals.css";
import "./styles/live-session-preview.css";
import { RouteNavigationFeedback } from "./components/route-navigation-feedback";

export const metadata: Metadata = {
  title: "HumanThread 工作台",
  description: "HumanThread 当前任务、团队状态与工作流时间线工作台",
  icons: {
    icon: [{ url: "/brand/humanthread-mark.svg", type: "image/svg+xml" }],
    shortcut: "/brand/humanthread-mark.svg",
    apple: "/brand/humanthread-mark.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">
        <Suspense fallback={null}>
          <RouteNavigationFeedback />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
