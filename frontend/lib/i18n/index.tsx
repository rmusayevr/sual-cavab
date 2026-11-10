"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";

import { az } from "./az";
import { en, type Key } from "./en";

/**
 * The language layer (#71): two dictionaries, no dependency. English is the default and is what
 * the first paint always shows (the server cannot know the choice, and the markup must match);
 * a person who chose Azerbaijani gets it as soon as the page has loaded, so a brief English flash
 * is expected. The choice lives in local storage, read through useSyncExternalStore, so no
 * provider is needed and no state is set inside an effect.
 */
export type Language = "en" | "az";
export type { Key };

export const dictionaries: Record<Language, Record<Key, string>> = { en, az };

const STORAGE_KEY = "sual-cavab-language";
const listeners = new Set<() => void>();
let remembered: Language = "en"; // used when local storage is blocked (private window)

function read(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "az" || stored === "en") return stored;
  } catch {
    return remembered;
  }
  return "en";
}

export function setLanguage(language: Language) {
  remembered = language;
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // blocked storage: the choice lasts until the page is closed
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLanguage(): Language {
  return useSyncExternalStore(subscribe, read, () => "en");
}

export function translate(language: Language, key: Key, values?: Record<string, string | number>): string {
  const text = dictionaries[language][key];
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

/** `const t = useT(); t("session.signOut")`. With no choice made it is English. */
export function useT() {
  const language = useLanguage();
  return (key: Key, values?: Record<string, string | number>) => translate(language, key, values);
}

/** For a spot in JSX: `<T k="draft.copy" />`. */
export function T({ k, values }: { k: Key; values?: Record<string, string | number> }): ReactNode {
  return useT()(k, values);
}

/** The `EN | AZ` switch. Marks the page's language for browsers and screen readers. */
export function LanguageSwitch({ className }: { className?: string }) {
  const language = useLanguage();
  const t = useT();
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return (
    <div role="group" aria-label={t("lang.label")} className={className}>
      {(["en", "az"] as const).map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={language === l}
          onClick={() => setLanguage(l)}
          className="m-0 min-h-11 min-w-11 cursor-pointer border-0 bg-transparent px-2 font-mono text-xs uppercase tracking-widest text-inherit underline-offset-4 aria-pressed:font-bold aria-pressed:underline"
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
