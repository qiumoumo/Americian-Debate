"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import {
  languageModes,
  type LanguageMode,
  type LanguageOverrides,
  type LanguageScope
} from "@debate/shared";
import { effectiveLanguage, languageHtmlTag, scopeForPathname, type LanguagePreferences } from "@/lib/language-core";
import { modeLabels, translateSystemText } from "@/lib/language-messages";

interface LanguageContextValue {
  preferences: LanguagePreferences;
  scope: LanguageScope;
  activeMode: LanguageMode;
  pending: boolean;
  setGlobalMode: (mode: LanguageMode) => void;
  savePreferences: (globalMode: LanguageMode, overrides: LanguageOverrides) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);
type GlobalSaveStatus = "idle" | "saving" | "saved" | "error";
const LANGUAGE_LOADING_DELAY_MS = 500;
const LANGUAGE_TOAST_DURATION_MS = 3_000;
const LANGUAGE_TRANSLATION_BATCH_SIZE = 160;

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used inside LanguageProvider");
  return value;
}

function setDocumentLanguage(mode: LanguageMode, globalMode: LanguageMode) {
  document.documentElement.lang = languageHtmlTag(globalMode);
  document.querySelectorAll<HTMLElement>("main.main, main.login-shell, main.auth-page, main.start-page").forEach((element) => {
    element.lang = languageHtmlTag(mode);
  });
  document.querySelectorAll<HTMLElement>("aside.sidebar").forEach((element) => {
    element.lang = languageHtmlTag(globalMode);
  });
}

function translateElement(element: Element, targetMode: LanguageMode) {
  if (element.closest("[data-language-ignore], [data-language-raw], pre, code, [contenteditable='true']")) return;
  for (const attribute of ["placeholder", "title", "aria-label"]) {
    translateAttribute(element, attribute, targetMode);
  }
}

function translationTasks(root: Element, targetMode: LanguageMode) {
  const tasks: Array<() => void> = [() => translateElement(root, targetMode)];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const textNode = node;
    tasks.push(() => {
      const parent = textNode.parentElement;
      if (!parent || parent.closest("[data-language-ignore], [data-language-raw], pre, code, textarea, [contenteditable='true']")) return;
      translateTextNode(textNode, targetMode);
    });
    node = walker.nextNode();
  }
  root.querySelectorAll("[placeholder], [title], [aria-label]").forEach((element) => {
    tasks.push(() => translateElement(element, targetMode));
  });
  return tasks;
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

async function translateDocument(
  mode: LanguageMode,
  globalMode: LanguageMode,
  isCurrent: () => boolean = () => true
) {
  if (!isCurrent()) return;
  setDocumentLanguage(mode, globalMode);
  const tasks = [
    ...Array.from(document.querySelectorAll<HTMLElement>("aside.sidebar"), (root) => translationTasks(root, globalMode)),
    ...Array.from(document.querySelectorAll<HTMLElement>("main.main, main.login-shell, main.auth-page, main.start-page"), (root) => translationTasks(root, mode))
  ].flat();
  for (let index = 0; index < tasks.length; index += LANGUAGE_TRANSLATION_BATCH_SIZE) {
    if (!isCurrent()) return;
    for (const task of tasks.slice(index, index + LANGUAGE_TRANSLATION_BATCH_SIZE)) task();
    if (index + LANGUAGE_TRANSLATION_BATCH_SIZE < tasks.length) await yieldToBrowser();
  }
  if (!isCurrent()) return;
  document.title = translateSystemText(document.title, globalMode);
}

function translateAddedNode(node: Node, mode: LanguageMode, globalMode: LanguageMode) {
  if (node.parentElement?.closest("[data-language-ignore], [data-language-raw]")) return;
  const targetMode = (node instanceof Element
    ? node.closest("main.main, main.login-shell, main.auth-page, main.start-page")
    : node.parentElement?.closest("main.main, main.login-shell, main.auth-page, main.start-page"))
    ? mode
    : globalMode;
  if (node.nodeType === Node.TEXT_NODE) {
    translateTextNode(node, targetMode);
  } else if (node instanceof Element) {
    for (const task of translationTasks(node, targetMode)) task();
  }
}

type TranslationState = { source: string; rendered: string };
const textTranslationState = new WeakMap<Node, TranslationState>();
const attributeTranslationState = new WeakMap<Element, Map<string, TranslationState>>();

async function persistLanguage(input: {
  globalMode: LanguageMode;
  overrides?: LanguageOverrides;
}) {
  const response = await fetch("/api/language", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error("Could not save language preference");
}

function translateTextNode(node: Node, mode: LanguageMode) {
  const current = node.nodeValue ?? "";
  const state = textTranslationState.get(node);
  const source = !state || current !== state.rendered ? current : state.source;
  const rendered = translateSystemText(source, mode);
  textTranslationState.set(node, { source, rendered });
  if (rendered !== current) node.nodeValue = rendered;
}

function translateAttribute(element: Element, attribute: string, mode: LanguageMode) {
  const current = element.getAttribute(attribute);
  if (!current) return;
  const states = attributeTranslationState.get(element) ?? new Map<string, TranslationState>();
  const state = states.get(attribute);
  const source = !state || current !== state.rendered ? current : state.source;
  const rendered = translateSystemText(source, mode);
  states.set(attribute, { source, rendered });
  attributeTranslationState.set(element, states);
  if (rendered !== current) element.setAttribute(attribute, rendered);
}

export function LanguageProvider({ initialPreferences, children }: {
  initialPreferences: LanguagePreferences;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [preferences, setPreferences] = useState(initialPreferences);
  const [pending, setPending] = useState(false);
  const [globalSaveStatus, setGlobalSaveStatus] = useState<GlobalSaveStatus>("idle");
  const [showLoading, setShowLoading] = useState(false);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const translationVersionRef = useRef(0);
  const skipEffectTranslationRef = useRef<string | null>(null);
  const scope = scopeForPathname(pathname);
  const activeMode = effectiveLanguage(preferences, scope);
  const translationKey = `${activeMode}:${preferences.globalMode}`;

  const runDocumentTranslation = useCallback((mode: LanguageMode, globalMode: LanguageMode) => {
    const version = ++translationVersionRef.current;
    return translateDocument(mode, globalMode, () => translationVersionRef.current === version);
  }, []);

  useEffect(() => {
    setPreferences(initialPreferences);
    setGlobalSaveStatus("idle");
  }, [initialPreferences]);

  useEffect(() => {
    if (globalSaveStatus !== "saved" && globalSaveStatus !== "error") return;
    const timer = window.setTimeout(() => setGlobalSaveStatus("idle"), LANGUAGE_TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [globalSaveStatus]);

  useEffect(() => () => {
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    translationVersionRef.current += 1;
  }, []);

  useEffect(() => {
    if (skipEffectTranslationRef.current === translationKey) {
      skipEffectTranslationRef.current = null;
    } else {
      void runDocumentTranslation(activeMode, preferences.globalMode);
    }
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          const node = mutation.target;
          if (node.parentElement?.closest("[data-language-ignore], [data-language-raw], pre, code, textarea, [contenteditable='true']")) continue;
          const nodeMode = node.parentElement?.closest("main.main, main.login-shell, main.auth-page, main.start-page") ? activeMode : preferences.globalMode;
          translateTextNode(node, nodeMode);
          continue;
        }
        mutation.addedNodes.forEach((node) => translateAddedNode(node, activeMode, preferences.globalMode));
      }
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });

    const originalConfirm = window.confirm.bind(window);
    window.confirm = (message?: string) => originalConfirm(translateSystemText(String(message ?? ""), activeMode));
    return () => {
      observer.disconnect();
      window.confirm = originalConfirm;
    };
  }, [activeMode, pathname, preferences.globalMode, runDocumentTranslation, translationKey]);

  const setGlobalMode = useCallback((mode: LanguageMode) => {
    if (pending || mode === preferences.globalMode) return;
    const previous = preferences;
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    setShowLoading(false);
    loadingTimerRef.current = setTimeout(() => setShowLoading(true), LANGUAGE_LOADING_DELAY_MS);
    const targetMode = preferences.overrides[scope] ?? mode;
    skipEffectTranslationRef.current = `${targetMode}:${mode}`;
    setPreferences((current) => ({ ...current, globalMode: mode, source: current.source === "account" ? "account" : "cookie" }));
    setPending(true);
    setGlobalSaveStatus("saving");
    void (async () => {
      try {
        await Promise.all([
          persistLanguage({ globalMode: mode }),
          runDocumentTranslation(targetMode, mode)
        ]);
        setGlobalSaveStatus("saved");
      } catch {
        const previousMode = effectiveLanguage(previous, scope);
        skipEffectTranslationRef.current = previousMode + ":" + previous.globalMode;
        setPreferences(previous);
        setGlobalSaveStatus("error");
        await runDocumentTranslation(previousMode, previous.globalMode);
      } finally {
        if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
        setShowLoading(false);
        setPending(false);
      }
    })();
  }, [pending, preferences, runDocumentTranslation, scope]);

  const globalSaveMessage = globalSaveStatus === "saved"
      ? (preferences.globalMode === "en" ? "Saved globally" : "全局语言已保存")
      : globalSaveStatus === "error"
        ? (preferences.globalMode === "en" ? "Save failed" : "保存失败")
        : null;
  const languageIndex = languageModes.indexOf(preferences.globalMode);

  const savePreferences = useCallback(async (globalMode: LanguageMode, overrides: LanguageOverrides) => {
    const previous = preferences;
    setPreferences({ globalMode, overrides, source: "account" });
    try {
      await persistLanguage({ globalMode, overrides });
    } catch (error) {
      setPreferences(previous);
      throw error;
    }
  }, [preferences]);

  const value = useMemo(() => ({
    preferences,
    scope,
    activeMode,
    pending,
    setGlobalMode,
    savePreferences
  }), [activeMode, pending, preferences, savePreferences, scope, setGlobalMode]);

  return (
    <LanguageContext.Provider value={value}>
      <div className="language-utility" data-language-ignore lang={languageHtmlTag(preferences.globalMode)}>
        <span className="language-utility-label">{preferences.globalMode === "en" ? "Global language" : "全局语言"}</span>
        <div
          className="language-segments"
          role="group"
          aria-label={preferences.globalMode === "en" ? "Global language" : "全局语言"}
          aria-busy={pending}
          style={{ "--language-index": languageIndex } as CSSProperties}
        >
          <span className="language-segment-slider" aria-hidden="true" />
          {languageModes.map((mode) => (
            <button
              key={mode}
              type="button"
              className="language-segment"
              data-active={preferences.globalMode === mode}
              disabled={pending}
              title={preferences.globalMode === "en" ? modeLabels[mode].enLabel : modeLabels[mode].label}
              onClick={() => setGlobalMode(mode)}
            >
              {modeLabels[mode].short}
            </button>
          ))}
        </div>
        {preferences.overrides[scope] ? (
          <span className="language-override-badge">
            {preferences.globalMode === "en" ? "This module:" : "本模块："} {modeLabels[activeMode].short}
          </span>
        ) : null}
      </div>
      {showLoading ? (
        <div className="language-loading-overlay" data-language-ignore role="status" aria-live="polite">
          <span className="language-loading-spinner" aria-hidden="true" />
          <strong>{preferences.globalMode === "en" ? "Switching language..." : "正在切换语言..."}</strong>
        </div>
      ) : null}
      {globalSaveMessage ? (
        <div className="language-toast" data-language-ignore data-status={globalSaveStatus} role="status" aria-live="polite">
          <span className="language-toast-mark" aria-hidden="true">{globalSaveStatus === "saved" ? "✓" : "!"}</span>
          {globalSaveMessage}
        </div>
      ) : null}
      {children}
    </LanguageContext.Provider>
  );
}
