import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { az } from "./az";
import { en } from "./en";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";

import { PageShell } from "@/components/ui/PageShell";
import { Wordmark } from "@/components/ui/Wordmark";

import { LanguageSwitch, LanguageSync, T, setLanguage, translate, useT } from "./index";

afterEach(() => {
  act(() => setLanguage("en"));
  localStorage.clear();
  document.documentElement.lang = "en";
});

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the dictionaries", () => {
  it("have exactly the same keys", () => {
    expect(Object.keys(az).sort()).toEqual(Object.keys(en).sort());
  });

  it("fill the same {placeholders} in every key, so no language drops a value", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(az[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("have no empty text", () => {
    for (const dictionary of [en, az]) for (const [key, text] of Object.entries(dictionary)) expect(text.trim(), key).not.toBe("");
  });

  it("use the example's words for the four statuses", () => {
    expect([az["status.open"], az["status.asked"], az["status.answered"], az["status.dropped"]]).toEqual([
      "Açıq",
      "Soruşulub",
      "Cavablanıb",
      "Ləğv",
    ]);
  });
});

describe("translate", () => {
  it("fills named values", () => {
    expect(translate("en", "session.signedInAs", { who: "Ada" })).toBe("Signed in as Ada.");
    expect(translate("az", "session.signedInAs", { who: "Ada" })).toBe("Ada kimi daxil olmusunuz.");
  });

  it("leaves an unknown {name} visible instead of printing undefined", () => {
    expect(translate("en", "workspace.pick", {})).toBe("Pick {label}");
  });
});

function Probe() {
  const t = useT();
  return (
    <p>
      {t("session.signOut")} / <T k="draft.copy" />
    </p>
  );
}

describe("the language in use", () => {
  it("is English until a person chooses", () => {
    render(<Probe />);

    expect(screen.getByText("Sign out / Copy")).toBeInTheDocument();
  });

  it("switches to Azerbaijani with the EN | AZ buttons and says which is on", () => {
    render(
      <>
        <LanguageSwitch />
        <Probe />
      </>,
    );
    expect(screen.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "AZ" }));

    expect(screen.getByText("Çıxış / Kopyala")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AZ" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("group", { name: "Dil" })).toBeInTheDocument();
  });

  it("marks the page's language on <html>, wherever the switch is (or is not) on screen", () => {
    render(
      <>
        <LanguageSync />
        <LanguageSwitch />
      </>,
    );
    expect(document.documentElement.lang).toBe("en");

    fireEvent.click(screen.getByRole("button", { name: "AZ" }));

    expect(document.documentElement.lang).toBe("az");
  });

  it("names the home link in the chosen language, the same on every page", () => {
    render(<Wordmark />);
    expect(screen.getByRole("link", { name: en["nav.home"] })).toHaveAttribute("href", "/");

    act(() => setLanguage("az"));

    expect(screen.getByRole("link", { name: az["nav.home"] })).toBeInTheDocument();
  });

  it("puts the switch on pages that have no header of their own", () => {
    render(<PageShell>text</PageShell>);

    expect(screen.getByRole("group", { name: en["lang.label"] })).toBeInTheDocument();
  });

  it("remembers the choice in local storage, and a page that loads later reads it", () => {
    setLanguage("az");
    expect(localStorage.getItem("sual-cavab-language")).toBe("az");

    render(<Probe />);

    expect(screen.getByText("Çıxış / Kopyala")).toBeInTheDocument();
  });

  it("ignores a stored value it does not know", () => {
    localStorage.setItem("sual-cavab-language", "tr");

    render(<Probe />);

    expect(screen.getByText("Sign out / Copy")).toBeInTheDocument();
  });

  it("changes every part of the page at once, not only the one that was clicked", () => {
    render(
      <>
        <LanguageSwitch />
        <Probe />
        <Probe />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "AZ" }));

    expect(screen.getAllByText("Çıxış / Kopyala")).toHaveLength(2);
  });

  // The first paint must be English even for a person who chose Azerbaijani: the server cannot know
  // the choice, and a different first render would be a hydration mismatch (review of #80).
  it("renders English on the server and hydrates an Azerbaijani choice without a mismatch", async () => {
    setLanguage("az");
    const html = renderToString(<Probe />);
    expect(html).toContain("Sign out");
    expect(html).not.toContain("Çıxış");

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const problems: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, <Probe />, { onRecoverableError: (e) => problems.push(e) });
    });

    expect(problems).toEqual([]);
    expect(container.textContent).toContain("Çıxış");
    act(() => root.unmount());
    container.remove();
  });
});
