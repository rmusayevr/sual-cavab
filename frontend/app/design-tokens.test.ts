import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The colours are tokens in app/globals.css, one set for light and one for dark. These tests read
// that file, so a colour changed there is checked again (#53): both themes complete, text readable
// (4.5:1), borders of controls and focus rings visible (3:1), and the CSS cascade still right.

// Vitest runs from frontend/ (npm test); import.meta.url is not a file URL under jsdom.
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6});/g)].map((m) => [m[1], m[2].toLowerCase()]));
}

const lightBlock = css.match(/:root\s*\{([^}]*)\}/)![1];
const darkBlock = css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/)![1];
const themes = { light: tokens(lightBlock), dark: tokens(darkBlock) };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("design tokens", () => {
  it("defines every token in both themes", () => {
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort());
    expect(Object.keys(themes.light).length).toBeGreaterThanOrEqual(18);
  });

  for (const [name, t] of Object.entries(themes)) {
    describe(`${name} theme`, () => {
      const text: Array<[string, string]> = [
        ["text", "bg"],
        ["text", "surface"],
        ["muted", "bg"],
        ["muted", "surface"],
        ["on-primary", "primary"],
        ["primary", "surface"],
        ["open-fg", "open-bg"],
        ["asked-fg", "asked-bg"],
        ["answered-fg", "answered-bg"],
        ["dropped-fg", "dropped-bg"],
        ["error-fg", "error-bg"],
      ];
      for (const [fg, bg] of text) {
        it(`${fg} on ${bg} is readable (4.5:1)`, () => {
          expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
        });
      }

      const controls: Array<[string, string]> = [
        ["control-border", "surface"],
        ["control-border", "bg"],
        ["primary", "bg"], // the focus ring
      ];
      for (const [fg, bg] of controls) {
        it(`${fg} against ${bg} is visible (3:1)`, () => {
          expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(3);
        });
      }
    });
  }
});

describe("globals.css cascade", () => {
  it("does not import Tailwind's reset: the screens still rely on browser defaults", () => {
    expect(css).not.toMatch(/@import[^;]*preflight/);
    expect(css).not.toMatch(/@import\s+["']tailwindcss["']/);
  });

  it("keeps its own base rules in a layer, or they would beat every utility class", () => {
    const outsideLayers = css.replace(/@layer base\s*\{[\s\S]*\n\}\n?$/, "");
    expect(outsideLayers).not.toMatch(/^\s*\*\s*\{/m);
    expect(outsideLayers).not.toMatch(/^\s*body\s*\{/m);
  });

  it("makes keyboard focus visible", () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline/);
  });
});
