import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_AUTH_TARGET,
  pathWithAuthTarget,
  sanitizeInternalRedirectTarget
} from "./auth-redirect.ts";

test("sanitizeInternalRedirectTarget preserves internal paths, queries, and hashes", () => {
  assert.equal(
    sanitizeInternalRedirectTarget("/app/documents?doc=case-1#evidence"),
    "/app/documents?doc=case-1#evidence"
  );
});

test("sanitizeInternalRedirectTarget rejects external and protocol-relative targets", () => {
  assert.equal(sanitizeInternalRedirectTarget("https://example.com/app"), DEFAULT_AUTH_TARGET);
  assert.equal(sanitizeInternalRedirectTarget("//example.com/app"), DEFAULT_AUTH_TARGET);
});

test("pathWithAuthTarget appends an encoded, sanitized target", () => {
  assert.equal(
    pathWithAuthTarget("/login", "/app/history?view=rounds"),
    "/login?target=%2Fapp%2Fhistory%3Fview%3Drounds"
  );
  assert.equal(
    pathWithAuthTarget("/register?invite=abc", "https://example.com"),
    `/register?invite=abc&target=${encodeURIComponent(DEFAULT_AUTH_TARGET)}`
  );
});
