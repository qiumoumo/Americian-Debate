import { NextResponse } from "next/server";
import { AIProviderError } from "@debate/ai";

const rateLimitHits = new Map<string, number[]>();

export function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

export function redirectToRequestHost(request: Request, path: string, status = 303) {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Redirect target must be an internal path.");
  }

  const requestUrl = new URL(request.url);
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const host = forwardedHost ?? firstHeaderValue(request.headers.get("host"));
  const protocolCandidate = forwardedProto ?? requestUrl.protocol.replace(":", "");
  const protocol = protocolCandidate === "https" || protocolCandidate === "http"
    ? protocolCandidate
    : requestUrl.protocol.replace(":", "");
  const origin = host ? `${protocol}://${host}` : requestUrl.origin;

  return NextResponse.redirect(new URL(path, origin), status);
}

export async function readLimitedJson<T>(request: Request, maxBytes: number): Promise<{ body: T | null; response?: NextResponse }> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { body: null, response: jsonError("Request body is too large.", 413) };
  }

  const raw = await request.text().catch(() => null);
  if (raw === null) {
    return { body: null, response: jsonError("Could not read request body.", 400) };
  }

  if (new TextEncoder().encode(raw).length > maxBytes) {
    return { body: null, response: jsonError("Request body is too large.", 413) };
  }

  try {
    return { body: raw ? JSON.parse(raw) as T : null };
  } catch {
    return { body: null, response: jsonError("Request body must be valid JSON.", 400) };
  }
}

export function checkRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const recentHits = (rateLimitHits.get(key) ?? []).filter((hit) => now - hit < windowMs);
  if (recentHits.length >= limit) {
    rateLimitHits.set(key, recentHits);
    return false;
  }
  recentHits.push(now);
  rateLimitHits.set(key, recentHits);
  return true;
}

export function limitString(value: unknown, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

export function routeErrorResponse(error: unknown, fallback = "Request failed.") {
  if (error instanceof AIProviderError) {
    const status = error.code === "configuration" ? 503 : 502;
    return jsonError(error.message, status);
  }

  console.error(error);
  return jsonError(fallback, 500);
}
