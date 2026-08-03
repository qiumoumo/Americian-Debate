"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  languageModes,
  type LanguageMode,
  type LanguageOverrides,
  type LanguageScope
} from "@debate/shared";
import { setGlobalLanguageAction, saveLanguagePreferencesAction } from "@/app/actions/language";
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

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used inside LanguageProvider");
  return value;
}

function translateDocument(mode: LanguageMode, globalMode: LanguageMode) {
  document.documentElement.lang = languageHtmlTag(globalMode);
  document.querySelectorAll<HTMLElement>("main.main, main.login-shell").forEach((element) => {
    element.lang = languageHtmlTag(mode);
  });
  document.querySelectorAll<HTMLElement>("aside.sidebar").forEach((element) => {
    element.lang = languageHtmlTag(globalMode);
  });

  const translateElement = (element: Element, targetMode: LanguageMode) => {
    if (element.closest("[data-language-ignore], [data-language-raw], pre, code, [contenteditable='true']")) return;
    for (const attribute of ["placeholder", "title", "aria-label"]) {
      translateAttribute(element, attribute, targetMode);
    }
  };

  const walk = (root: Node, targetMode: LanguageMode) => {
    if (root.nodeType === Node.TEXT_NODE) {
      const parent = root.parentElement;
      if (!parent || parent.closest("[data-language-ignore], [data-language-raw], pre, code, textarea, [contenteditable='true']")) return;
      translateTextNode(root, targetMode);
      return;
    }
    if (!(root instanceof Element)) return;
    translateElement(root, targetMode);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const next = walker.nextNode();
      walk(node, targetMode);
      node = next;
    }
    root.querySelectorAll("[placeholder], [title], [aria-label]").forEach((element) => translateElement(element, targetMode));
  };

  document.querySelectorAll<HTMLElement>("aside.sidebar").forEach((element) => walk(element, globalMode));
  document.querySelectorAll<HTMLElement>("main.main, main.login-shell").forEach((element) => walk(element, mode));
  document.title = translateSystemText(document.title, globalMode);
}

type TranslationState = { source: string; rendered: string };
const textTranslationState = new WeakMap<Node, TranslationState>();
const attributeTranslationState = new WeakMap<Element, Map<string, TranslationState>>();

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
  const router = useRouter();
  const [preferences, setPreferences] = useState(initialPreferences);
  const [pending, startTransition] = useTransition();
  const scope = scopeForPathname(pathname);
  const activeMode = effectiveLanguage(preferences, scope);

  useEffect(() => setPreferences(initialPreferences), [initialPreferences]);

  useEffect(() => {
    translateDocument(activeMode, preferences.globalMode);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          const node = mutation.target;
          if (node.parentElement?.closest("[data-language-ignore], [data-language-raw], pre, code, textarea, [contenteditable='true']")) continue;
          const nodeMode = node.parentElement?.closest("main.main, main.login-shell") ? activeMode : preferences.globalMode;
          translateTextNode(node, nodeMode);
          continue;
        }
        mutation.addedNodes.forEach((node) => {
          if (node.parentElement?.closest("[data-language-ignore], [data-language-raw]")) return;
          if (node.nodeType === Node.TEXT_NODE) {
            const nodeMode = node.parentElement?.closest("main.main, main.login-shell") ? activeMode : preferences.globalMode;
            translateTextNode(node, nodeMode);
          } else if (node instanceof Element) {
            translateDocument(activeMode, preferences.globalMode);
          }
        });
      }
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });

    const originalConfirm = window.confirm.bind(window);
    window.confirm = (message?: string) => originalConfirm(translateSystemText(String(message ?? ""), activeMode));
    return () => {
      observer.disconnect();
      window.confirm = originalConfirm;
    };
  }, [activeMode, preferences.globalMode, pathname]);

  const setGlobalMode = useCallback((mode: LanguageMode) => {
    const previous = preferences;
    setPreferences((current) => ({ ...current, globalMode: mode, source: current.source === "account" ? "account" : "cookie" }));
    startTransition(async () => {
      try {
        await setGlobalLanguageAction(mode, scope);
        router.refresh();
      } catch {
        setPreferences(previous);
      }
    });
  }, [preferences, router, scope]);

  const savePreferences = useCallback(async (globalMode: LanguageMode, overrides: LanguageOverrides) => {
    const previous = preferences;
    setPreferences({ globalMode, overrides, source: "account" });
    try {
      await saveLanguagePreferencesAction({ globalMode, overrides, currentScope: scope });
      router.refresh();
    } catch (error) {
      setPreferences(previous);
      throw error;
    }
  }, [preferences, router, scope]);

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
        <span className="language-utility-label">{preferences.globalMode === "en" ? "Language" : "语言"}</span>
        <div className="language-segments" role="group" aria-label="Language">
          {languageModes.map((mode) => (
            <button
              key={mode}
              type="button"
              className="language-segment"
              data-active={preferences.globalMode === mode}
              disabled={pending}
              title={modeLabels[mode].label}
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
      {children}
    </LanguageContext.Provider>
  );
}
