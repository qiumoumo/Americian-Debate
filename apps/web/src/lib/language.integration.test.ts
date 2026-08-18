import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  browserDefaultLanguage,
  effectiveLanguage,
  languageSurfaceForRequest,
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

  it("derives the account surface from the browser-facing host", () => {
    const headers = new Headers({
      host: "127.0.0.1:3000",
      referer: "http://127.0.0.1:3000/app/documents"
    });
    assert.equal(languageSurfaceForRequest({ url: "http://localhost:3000/api/language", headers }), "user");

    headers.set("referer", "http://127.0.0.1:3000/admin/settings");
    assert.equal(languageSurfaceForRequest({ url: "http://localhost:3000/api/language", headers }), "admin");

    headers.set("referer", "http://untrusted.local/app/documents");
    assert.equal(languageSurfaceForRequest({ url: "http://localhost:3000/api/language", headers }), null);

    headers.set("host", "web.internal:3000");
    headers.set("x-forwarded-host", "debate.example");
    headers.set("x-forwarded-proto", "https");
    headers.set("referer", "https://debate.example/admin/settings");
    assert.equal(languageSurfaceForRequest({ url: "http://web.internal:3000/api/language", headers }), "admin");
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
    assert.equal(translateSystemText("No date", "zh-CN"), "无日期");
    assert.equal(translateSystemText("Provider", "zh-CN"), "服务商");
    assert.equal(translateSystemText("当前 AI", "en"), "Current AI");
    assert.equal(translateSystemText("切换中…", "en"), "Switching...");
    assert.equal(translateSystemText("3 场待复盘", "en"), "3 pending review");
    assert.equal(translateSystemText("已判定 4 / 6 场", "en"), "4 / 6 decided");
    assert.equal(translateSystemText("2 场已提交 · 1 场已判定", "en"), "2 submitted · 1 decided");
    assert.equal(translateSystemText("1 场比赛尚未提交赛后数据", "en"), "1 match pending review");
    assert.equal(translateSystemText("2 matches pending review", "zh-CN"), "2 场比赛尚未提交赛后数据");
    assert.equal(translateSystemText("3 论点 · 4 evidence", "zh-CN"), "3 个论点 · 4 条证据");
    assert.equal(translateSystemText("赛后报告 · 第 7 版", "en"), "Post-round report · version 7");
    assert.equal(translateSystemText("已导入 2 张 evidence", "zh-terms-en"), "已导入 2 张 Evidence");
    assert.equal(translateSystemText("2 条笔记", "en"), "2 notes");
    assert.equal(translateSystemText("1 note", "zh-CN"), "1 条笔记");
    assert.equal(translateSystemText("4 条已判定论点", "en"), "4 decided arguments");
    assert.equal(translateSystemText("3 条结构化记录", "en"), "3 structured records");
    assert.equal(translateSystemText("2 条已选 evidence", "en"), "2 selected Evidence");
    assert.equal(translateSystemText("2 轮发言", "en"), "2 speaking turns");
    assert.equal(translateSystemText("分数 82", "en"), "Score 82");
    assert.equal(translateSystemText("5 次 · in 10 / out 20 · 0.3¢", "en"), "5 calls · in 10 / out 20 · 0.3¢");
    assert.equal(translateSystemText("未命名论点", "en"), "Untitled argument");
    assert.equal(translateSystemText("Unknown publication", "zh-CN"), "未知刊物");
    assert.equal(translateSystemText("上传者：", "en"), "Uploader:");
    assert.equal(translateSystemText("只看有问题", "en"), "Show issues only");
    assert.equal(translateSystemText("打开原始来源", "en"), "Open original source");
    assert.equal(translateSystemText("创建文档后会直接进入编辑界面；从列表可随时打开任意一份文档继续编辑。", "en"), "New documents open directly in the editor; open any document from the list to continue editing.");
    assert.equal(translateSystemText("填入示例", "en"), "Fill example");
    assert.equal(translateSystemText("已填入示例，点「解析预览」。", "en"), "Example filled in. Select Parse preview.");
  });
});
