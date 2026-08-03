"use client";

import { useEffect, useState, useTransition } from "react";
import {
  languageModes,
  languageScopes,
  type LanguageMode,
  type LanguageOverrides
} from "@debate/shared";
import { useLanguage } from "@/components/language-provider";
import { modeLabels, scopeLabels } from "@/lib/language-messages";

export function LanguageSettings() {
  const { preferences, activeMode, savePreferences } = useLanguage();
  const [globalMode, setGlobalMode] = useState(preferences.globalMode);
  const [overrides, setOverrides] = useState<LanguageOverrides>(preferences.overrides);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const english = activeMode === "en";

  useEffect(() => {
    setGlobalMode(preferences.globalMode);
    setOverrides(preferences.overrides);
  }, [preferences]);

  function setOverride(scope: (typeof languageScopes)[number], value: string) {
    setSaved(false);
    setOverrides((current) => {
      const next = { ...current };
      if (value === "inherit") delete next[scope];
      else next[scope] = value as LanguageMode;
      return next;
    });
  }

  return (
    <div className="language-settings" data-language-ignore lang={english ? "en" : "zh-CN"}>
      <div className="language-settings-global">
        <label htmlFor="global-language"><strong>{english ? "Global language" : "全局语言"}</strong></label>
        <select id="global-language" value={globalMode} onChange={(event) => { setSaved(false); setGlobalMode(event.target.value as LanguageMode); }}>
          {languageModes.map((mode) => <option key={mode} value={mode}>{modeLabels[mode].label}</option>)}
        </select>
      </div>
      <div className="language-scope-list">
        {languageScopes.map((scope) => (
          <label className="language-scope-row" key={scope}>
            <span><strong>{english ? scopeLabels[scope].en : scopeLabels[scope].zh}</strong><small>{scope}</small></span>
            <select value={overrides[scope] ?? "inherit"} onChange={(event) => setOverride(scope, event.target.value)}>
              <option value="inherit">{english ? "Follow global" : "跟随全局"}</option>
              {languageModes.map((mode) => <option key={mode} value={mode}>{modeLabels[mode].label}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className="actions">
        <button className="button primary" type="button" disabled={pending} onClick={() => startTransition(async () => {
          setError(false);
          try {
            await savePreferences(globalMode, overrides);
            setSaved(true);
          } catch {
            setError(true);
          }
        })}>
          {pending ? (english ? "Saving..." : "保存中...") : (english ? "Save language settings" : "保存语言设置")}
        </button>
        {saved ? <span className="success-text">{english ? "Language settings saved." : "语言设置已保存。"}</span> : null}
        {error ? <span className="error-text">{english ? "Could not save language settings." : "语言设置保存失败。"}</span> : null}
      </div>
    </div>
  );
}
