import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  browserDefaultLanguage,
  effectiveLanguage,
  parseLanguageOverrides,
  resolveLanguagePreferences,
  sanitizePreferenceUpdate,
  selectLanguageSession,
  scopeForPathname
} from "./language-core.ts";
import { catalogIntegrityIssues, translateSystemText } from "./language-messages.ts";

describe("language preference interface", () => {
  it("uses hybrid Chinese for Chinese browsers and English otherwise", () => {
    assert.equal(browserDefaultLanguage("zh-CN,zh;q=0.9,en;q=0.8"), "zh-terms-en");
    assert.equal(browserDefaultLanguage("en-US,en;q=0.9"), "en");
    assert.equal(browserDefaultLanguage(null), "en");
  });

  it("resolves account before cookie before browser", () => {
    assert.equal(resolveLanguagePreferences({ accountMode: "en", cookieMode: "zh-CN", acceptLanguage: "zh" }).globalMode, "en");
    assert.equal(resolveLanguagePreferences({ cookieMode: "zh-CN", acceptLanguage: "en" }).globalMode, "zh-CN");
    assert.equal(resolveLanguagePreferences({ acceptLanguage: "zh" }).globalMode, "zh-terms-en");
  });

  it("filters corrupt overrides and applies valid module overrides", () => {
    const overrides = parseLanguageOverrides({ matches: "en", practice: "bad", unknown: "zh-CN" });
    assert.deepEqual(overrides, { matches: "en" });
    const preferences = resolveLanguagePreferences({ accountMode: "zh-CN", accountOverrides: overrides });
    assert.equal(effectiveLanguage(preferences, "matches"), "en");
    assert.equal(effectiveLanguage(preferences, "documents"), "zh-CN");
  });

  it("maps every route to one of the eight scopes", () => {
    assert.equal(scopeForPathname("/app/documents"), "documents");
    assert.equal(scopeForPathname("/app/matches?match=1"), "matches");
    assert.equal(scopeForPathname("/app/change-password"), "settings");
    assert.equal(scopeForPathname("/admin/ai"), "admin");
    assert.equal(scopeForPathname("/login"), "common");
  });

  it("selects the account that owns the current user or admin surface", () => {
    const sessions = [
      { token: "user-token", kind: "user" as const, userId: "user-account" },
      { token: "admin-token", kind: "admin" as const, userId: "admin-account" }
    ];
    assert.equal(selectLanguageSession({ sessions, userToken: "user-token", adminToken: "admin-token", scope: "settings" })?.userId, "user-account");
    assert.equal(selectLanguageSession({ sessions, userToken: "user-token", adminToken: "admin-token", scope: "admin" })?.userId, "admin-account");
  });

  it("rejects unknown modes and scopes at the write seam", () => {
    assert.throws(() => sanitizePreferenceUpdate({ globalMode: "fr" }), /Invalid language mode/);
    assert.throws(() => sanitizePreferenceUpdate({ overrides: { unknown: "en" } }), /Invalid language scope/);
    assert.deepEqual(sanitizePreferenceUpdate({ overrides: { matches: "en", practice: "inherit" } }), {
      overrides: { matches: "en" }
    });
  });

  it("keeps the catalog valid and supports all three modes", () => {
    assert.deepEqual(catalogIntegrityIssues(), []);
    assert.equal(translateSystemText("比赛页面", "en"), "Matches");
    assert.equal(translateSystemText("Practice Debate", "zh-CN"), "辩论训练");
    assert.equal(translateSystemText("Practice Debate", "zh-terms-en"), "Practice");
    assert.equal(translateSystemText("我的私有 AI（3）", "en"), "My private AI (3)");
  });
});
