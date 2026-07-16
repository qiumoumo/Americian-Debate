import * as nodeHttp from "node:http";

let appliedProxySignature = "";
let restoreGlobalProxy: (() => void) | null = null;

export function configureAIOutboundProxy() {
  const env = process.env;
  const proxy = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || "";
  if (!proxy) {
    restoreGlobalProxy?.();
    restoreGlobalProxy = null;
    appliedProxySignature = "";
    return false;
  }

  const signature = `${env.HTTP_PROXY ?? env.http_proxy ?? ""}\n${env.HTTPS_PROXY ?? env.https_proxy ?? ""}\n${env.NO_PROXY ?? env.no_proxy ?? ""}`;
  if (signature === appliedProxySignature) return true;

  const setGlobalProxyFromEnv = (nodeHttp as typeof nodeHttp & { setGlobalProxyFromEnv?: () => unknown }).setGlobalProxyFromEnv;
  if (typeof setGlobalProxyFromEnv !== "function") return false;
  restoreGlobalProxy?.();
  const restore = setGlobalProxyFromEnv();
  restoreGlobalProxy = typeof restore === "function" ? restore as () => void : null;
  appliedProxySignature = signature;
  return true;
}
