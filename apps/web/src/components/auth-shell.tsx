import { ReliableLink } from "@/components/reliable-link";
import { LetterGlitchBackground } from "@/components/letter-glitch-background";

interface AuthShellProps {
  children: React.ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}

export function AuthShell({ children, description, eyebrow, title }: AuthShellProps) {
  return (
    <main className="auth-page">
      <LetterGlitchBackground />
      <ReliableLink href="/" className="auth-brand" aria-label="美辩首页">
        <span className="brand-mark">美</span>
        <span>
          <strong>美辩</strong>
          <small>Debate Suite</small>
        </span>
      </ReliableLink>
      <div className="auth-layout">
        <section className="auth-intro">
          <div className="eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
          <p>{description}</p>
        </section>
        <section className="auth-panel">{children}</section>
      </div>
    </main>
  );
}
