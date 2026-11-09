import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The colours are tokens in app/globals.css (oklch, as in the owner's design example). These tests
// read that file, so a colour changed there is checked again (#68): every token present, text
// readable (4.5:1), borders of controls and focus rings visible (3:1), no hardcoded colour in a
// component, and the CSS cascade still right.

// Vitest runs from frontend/ (npm test); import.meta.url is not a file URL under jsdom.
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

const rootBlock = css.match(/:root\s*\{([^}]*)\}/)![1];

/** `--name: oklch(L C H);` for every colour token in the :root block. */
function oklchTokens(block: string): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  for (const m of block.matchAll(/--([a-z-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\);/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

/** oklch to linear sRGB, clipped (the standard OKLab matrices). */
function toLinearSrgb([L, C, h]: [number, number, number]): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map((v) => Math.max(0, Math.min(1, v)));
  return rgb as [number, number, number];
}

const tokens = oklchTokens(rootBlock);
const rgb = (name: string) => {
  expect(tokens[name], `token --${name} is missing`).toBeDefined();
  return toLinearSrgb(tokens[name]);
};

function ratio(a: [number, number, number], b: [number, number, number]): number {
  const lum = ([r, g, bl]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The selector or at-rule of every block at the top level of a stylesheet (comments and statements skipped). */
function topLevelRules(source: string): string[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: string[] = [];
  let depth = 0;
  let prelude = "";
  for (const ch of text) {
    if (ch === "{") {
      if (depth === 0) rules.push(prelude.trim().replace(/\s+/g, " "));
      depth++;
      prelude = "";
    } else if (ch === "}") {
      depth--;
    } else if (depth === 0) {
      if (ch === ";") prelude = "";
      else prelude += ch;
    }
  }
  return rules;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === ".next") return [];
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

describe("design tokens", () => {
  it("defines every token of the design, and the one extra", () => {
    const wanted = [
      "background", "foreground", "card", "card-foreground", "primary", "primary-foreground", "secondary",
      "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive",
      "destructive-foreground", "border", "input", "ring", "navy", "navy-foreground", "saffron", "pomegranate",
      "status-open", "status-asked", "status-answered", "status-dropped",
      "control-border", // not in the example: the hairline border is too faint for a form field
    ];
    for (const name of wanted) expect(tokens[name], `--${name}`).toBeDefined();
  });

  it("gives the four statuses and nothing else a status colour", () => {
    expect(Object.keys(tokens).filter((n) => n.startsWith("status-")).sort()).toEqual([
      "status-answered",
      "status-asked",
      "status-dropped",
      "status-open",
    ]);
  });

  const text: Array<[string, string, string?]> = [
    ["foreground", "background"],
    ["foreground", "card"],
    ["card-foreground", "card"],
    ["muted-foreground", "background"],
    ["muted-foreground", "card"],
    ["muted-foreground", "muted"], // the caption inside an answer block
    ["primary-foreground", "primary"], // the red button
    ["primary", "background"], // red text: ids and error messages
    ["primary", "card"],
    ["destructive-foreground", "destructive"], // dropping a question
    ["navy-foreground", "navy"], // the rail and the bands
    ["saffron", "navy"], // eyebrows and counts, only ever on navy
    ["accent-foreground", "saffron"], // the count chip
  ];
  for (const [fg, bg] of text) {
    it(`${fg} on ${bg} is readable (4.5:1)`, () => {
      expect(ratio(rgb(fg), rgb(bg))).toBeGreaterThanOrEqual(4.5);
    });
  }

  const nonText: Array<[string, string]> = [
    ["control-border", "card"], // the border of an input
    ["control-border", "background"],
    ["ring", "background"], // the focus ring on paper
    ["ring", "card"],
    ["saffron", "navy"], // the focus ring on the navy rail
    ["status-open", "card"], // a status dot
    ["status-answered", "card"],
    ["status-dropped", "card"],
  ];
  for (const [a, b] of nonText) {
    it(`${a} against ${b} is visible (3:1)`, () => {
      expect(ratio(rgb(a), rgb(b))).toBeGreaterThanOrEqual(3);
    });
  }

  it("the amber 'asked' dot is below 3:1 on a card, which is why the word always sits beside it", () => {
    // Measured, not hidden: the example's amber is 2.62:1. StatusChip always shows the word.
    expect(ratio(rgb("status-asked"), rgb("card"))).toBeLessThan(3);
  });

  it("saffron is not used as text on a light surface (2.0:1), only on navy", () => {
    expect(ratio(rgb("saffron"), rgb("card"))).toBeLessThan(4.5);
    const offenders = sourceFiles(join(process.cwd(), "components"))
      .concat(sourceFiles(join(process.cwd(), "app")))
      .filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f))
      .filter((f) => /text-saffron/.test(readFileSync(f, "utf8")) && !/bg-navy/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("components use tokens only", () => {
  const files = sourceFiles(join(process.cwd(), "components"))
    .concat(sourceFiles(join(process.cwd(), "app")))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));

  it("has no hardcoded colour: no hex, rgb(), oklch(), white or black utility", () => {
    const bad = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\boklch\(|\b(?:bg|text|border|ring|fill|stroke)-(?:white|black)\b|\[#/;
    const offenders = files.filter((f) => bad.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
    expect(offenders).toEqual([]);
  });

  it("has no inline style (everything is a class)", () => {
    expect(files.filter((f) => /style=\{\{/.test(readFileSync(f, "utf8")))).toEqual([]);
  });

  it("scanned the components and the pages", () => {
    expect(files.length).toBeGreaterThan(15);
  });
});

describe("globals.css cascade", () => {
  it("does not import Tailwind's reset: the screens still rely on browser defaults", () => {
    expect(css).not.toMatch(/@import[^;]*preflight/);
    expect(css).not.toMatch(/@import\s+["']tailwindcss["']/);
  });

  it("has nothing at the top level except tokens, the theme, the utilities and the base layer", () => {
    // Unlayered CSS beats every utility class, so a stray `body {}` or `* {}` anywhere is refused.
    const allowed = [
      "@layer base",
      "@theme inline",
      ":root",
      "@utility pattern-carpet",
      "@utility pattern-lattice",
      "@utility shadow-card",
      "@utility btn-primary",
      "@utility btn-ghost",
      "@utility btn-danger",
    ];
    expect(topLevelRules(css).filter((rule) => !allowed.includes(rule))).toEqual([]);
  });

  it("the check above does catch an unlayered rule, wherever it sits", () => {
    const inLayer = "@layer base { a { color: red } }";
    expect(topLevelRules([inLayer, "body { color: red }"].join("\n"))).toEqual(["@layer base", "body"]);
    expect(topLevelRules(["body { color: red }", inLayer].join("\n"))).toEqual(["body", "@layer base"]);
    expect(topLevelRules([inLayer, "* { margin: 0 }", inLayer].join("\n"))).toEqual(["@layer base", "*", "@layer base"]);
  });

  it("makes keyboard focus visible, in saffron on the navy surfaces", () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline/);
    expect(css).toMatch(/\.bg-navy :focus-visible\s*\{[^}]*saffron/);
  });

  it("keeps patterns to the two the example allows", () => {
    expect([...css.matchAll(/@utility (pattern-[a-z]+)/g)].map((m) => m[1]).sort()).toEqual(["pattern-carpet", "pattern-lattice"]);
  });
});
