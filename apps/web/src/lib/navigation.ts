export const userNavigation = [
  { href: "/app/documents", label: "共享文档", badge: "Docs" },
  { href: "/app/matches", label: "比赛页面", badge: "Flow" },
  { href: "/app/history", label: "赛事记录", badge: "Stats" },
  { href: "/app/practice", label: "Practice Debate", badge: "AI" },
  { href: "/app/library", label: "素材库", badge: "Film" },
  { href: "/app/settings", label: "用户设置", badge: "Key" }
] as const;

export const adminNavigation = [
  { href: "/admin", label: "概览", badge: "Home" },
  { href: "/admin/rooms", label: "比赛房间", badge: "Live" },
  { href: "/admin/members", label: "成员", badge: "Team" },
  { href: "/admin/analytics", label: "数据分析", badge: "Stats" },
  { href: "/admin/ai", label: "AI 配置", badge: "AI" },
  { href: "/admin/workspaces", label: "工作区", badge: "WS" },
  { href: "/admin/settings", label: "公告与设置", badge: "Set" },
  { href: "/admin/audit", label: "审计日志", badge: "Log" },
  { href: "/admin/data", label: "数据管理", badge: "Data" }
] as const;
