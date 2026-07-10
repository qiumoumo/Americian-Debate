import type { ProviderConfigStatus } from "@debate/ai";

interface ProviderHealthCardProps {
  status: ProviderConfigStatus;
}

export function ProviderHealthCard({ status }: ProviderHealthCardProps) {
  return (
    <div className="provider-health">
      <div className="evidence-meta">
        <span className="pill">{status.providerId}</span>
        <span className="pill">{status.configured ? "configured" : "missing config"}</span>
        <span className="pill">{status.model || "no model"}</span>
      </div>
      <p>
        AI 接入信息填写位置：<strong>{status.keyLocation}</strong>。这个页面只展示状态，不会显示 API key。
      </p>
      {status.missingEnv.length ? (
        <div className="warning-box">
          <strong>缺少变量</strong>
          <ul>
            {status.missingEnv.map((name) => <li key={name}>{name}</li>)}
          </ul>
        </div>
      ) : (
        <p className="success-text">当前 provider 可以用于 MVP。mock 模式不需要真实 key。</p>
      )}
      <div className="table-like provider-table">
        <div className="table-row header"><div>Capability</div><div>Status</div><div>Note</div></div>
        <div className="table-row"><div>JSON draft</div><div>{status.capabilities.supportsJsonSchema ? "yes" : "limited"}</div><div>仍会做运行时校验</div></div>
        <div className="table-row"><div>Long context</div><div>{status.capabilities.supportsLongContext ? "yes" : "no"}</div><div>{status.capabilities.maxInputTokens ?? "not reported"}</div></div>
        <div className="table-row"><div>Vision</div><div>{status.capabilities.supportsVision ? "yes" : "no"}</div><div>本 MVP 暂未启用图片输入</div></div>
      </div>
    </div>
  );
}
