export const DEFAULT_AUTH_TARGET = "/app/documents";
export const AUTH_RETURN_TO_HEADER = "x-debate-return-to";

export function sanitizeInternalRedirectTarget(target: string | null | undefined) {
  const value = String(target ?? DEFAULT_AUTH_TARGET).trim();
  if (!value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_AUTH_TARGET;
  }

  try {
    const parsed = new URL(value, "http://debate.local");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_AUTH_TARGET;
  }
}

export function pathWithAuthTarget(path: string, target: string | null | undefined) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}target=${encodeURIComponent(sanitizeInternalRedirectTarget(target))}`;
}
