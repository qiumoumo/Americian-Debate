import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { SectionCard } from "@/components/section-card";

const modules = [
  { title: "共享文档 / Evidence", body: "可编辑的共享文档与结构化 evidence library。Evidence 从第一天起结构化保存，方便比赛、AI 引用和统计复用。" },
  { title: "比赛页面", body: "创建比赛、记录 flow、计时并生成 AI 草稿。AI 只生成草稿，用户确认后才会保存。" },
  { title: "赛事记录", body: "每场比赛保存笔记、tag、反思与 argument outcomes；统计数字来自 SQLite 聚合而非 AI 凭空总结。" },
  { title: "Practice Debate", body: "文字版 AI 对手训练和教练反馈。记录完整 transcript，结束后按 rubric 给出评分与改进建议。" },
  { title: "管理端 Admin", body: "队伍、权限、资料库与 AI 使用审计；仅 OWNER / COACH 角色可进入，拥有独立登录入口。" }
];

const platform = [
  "本地优先：数据存于本机 SQLite，API key 只在服务器端读取，绝不进入前端。",
  "局域网可访问：开发服务器绑定 0.0.0.0，同网段设备可通过 http://<本机IP>:3000 访问。",
  "生产级登录：账号 + 密码（bcrypt）+ 自助注册；会话以随机 token 存库，用户端与管理端入口分离。",
  "可替换 AI provider：mock / openai-compatible（中转站）/ openclaw / anthropic，通过 .env.local 切换。"
];

export default function AboutPage() {
  return (
    <AppShell activeHref="/about">
      <section className="hero">
        <div className="eyebrow">功能说明</div>
        <h1>关于美辩</h1>
        <p>美辩是一个本地优先的美式辩论工作台：资料、比赛、训练与复盘，配合可替换的 AI 与网站管理端。</p>
        <div className="actions">
          <Link className="button primary" href="/app/documents">进入用户端</Link>
          <Link className="button" href="/login">登录</Link>
          <Link className="button" href="/register">注册</Link>
        </div>
      </section>

      <SectionCard title="模块" description="用户端与管理端的主要功能。">
        <div className="timeline">
          {modules.map((item) => (
            <div className="timeline-item" key={item.title}>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      <div style={{ height: 18 }} />

      <SectionCard title="平台特性" description="本地优先、局域网、登录与 AI。">
        <div className="timeline">
          {platform.map((line) => (
            <div className="timeline-item" key={line}>{line}</div>
          ))}
        </div>
      </SectionCard>
    </AppShell>
  );
}
