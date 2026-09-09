/**
 * The translations, checked structurally.
 *
 * Two failure modes here are silent. A key present in English and missing in
 * Polish falls back to English, so the interface half-translates and nothing
 * complains. And a counted string missing its Polish `_few` or `_many` renders
 * the wrong word for most numbers — `5 wiersze` instead of `5 wierszy` — which
 * only a Polish reader would catch. Both are cheap to assert.
 */
import { describe, expect, it } from "vitest";
import i18next from "i18next";
import en from "./en.json";
import pl from "./pl.json";
import { segments, slot } from "./slots.js";

type Tree = { [key: string]: string | Tree };

/** Every leaf, as a dotted path. */
function leaves(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [path] : leaves(value, path);
  });
}

function at(tree: Tree, path: string): string {
  const value = path.split(".").reduce<string | Tree | undefined>((node, key) => {
    return node && typeof node !== "string" ? node[key] : undefined;
  }, tree);
  if (typeof value !== "string") throw new Error(`${path} is not a string`);
  return value;
}

/** `{{name}}` placeholders, as a set, so order does not matter. */
const placeholders = (text: string): Set<string> =>
  new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!));

/** A counted key, without its plural suffix. */
const stem = (path: string): string | undefined => {
  const match = /^(.*)_(one|two|few|many|other)$/.exec(path);
  return match?.[1];
};

const EN = en as Tree;
const PL = pl as Tree;

describe("translations", () => {
  const enLeaves = leaves(EN);
  const plLeaves = leaves(PL);

  it("has the same non-counted keys in both languages", () => {
    const plain = (list: string[]) => new Set(list.filter((p) => !stem(p)));
    const a = plain(enLeaves);
    const b = plain(plLeaves);
    expect(
      [...a].filter((k) => !b.has(k)),
      "missing from pl",
    ).toEqual([]);
    expect(
      [...b].filter((k) => !a.has(k)),
      "missing from en",
    ).toEqual([]);
  });

  it("has the same counted strings in both languages", () => {
    const stems = (list: string[]) => new Set(list.map(stem).filter(Boolean) as string[]);
    expect([...stems(enLeaves)].sort()).toEqual([...stems(plLeaves)].sort());
  });

  /**
   * i18next v4 keys plurals off `Intl.PluralRules`, so the required suffixes
   * are the language's own categories — not a choice.
   */
  it("carries every plural category each language needs", () => {
    const required = {
      en: [...new Intl.PluralRules("en").resolvedOptions().pluralCategories],
      pl: [...new Intl.PluralRules("pl").resolvedOptions().pluralCategories],
    };
    for (const [lang, list, tree] of [
      ["en", enLeaves, EN],
      ["pl", plLeaves, PL],
    ] as const) {
      const stems = new Set(list.map(stem).filter(Boolean) as string[]);
      for (const base of stems) {
        for (const category of required[lang]) {
          expect(
            () => at(tree, `${base}_${category}`),
            `${lang}: ${base} needs _${category}`,
          ).not.toThrow();
        }
      }
    }
  });

  it("uses the same placeholders in both languages", () => {
    for (const path of enLeaves) {
      const base = stem(path);
      // A plural form need not exist in the other language under the same
      // suffix; compare the `other` form, which both always have.
      const compare = base ? `${base}_other` : path;
      let plText: string;
      try {
        plText = at(PL, compare);
      } catch {
        continue;
      }
      expect(placeholders(at(EN, compare)), `${compare} placeholders`).toEqual(
        placeholders(plText),
      );
    }
  });

  it("renders Polish plurals as one, few and many", async () => {
    const instance = i18next.createInstance();
    await instance.init({
      lng: "pl",
      resources: { pl: { translation: pl } },
      interpolation: { escapeValue: false },
    });
    const rows = (count: number) => instance.t("parts.rows", { count });
    // one; few for 2–4; many for 5 and up, and again for 12–14; few once more
    // at 22. A hand-rolled `count === 1` gets four of these five wrong.
    expect(rows(1)).toBe("1 wiersz");
    expect(rows(3)).toBe("3 wiersze");
    expect(rows(5)).toBe("5 wierszy");
    expect(rows(13)).toBe("13 wierszy");
    expect(rows(22)).toBe("22 wiersze");
  });

  it("renders English plurals", async () => {
    const instance = i18next.createInstance();
    await instance.init({
      lng: "en",
      resources: { en: { translation: en } },
      interpolation: { escapeValue: false },
    });
    expect(instance.t("parts.rows", { count: 1 })).toBe("1 row");
    expect(instance.t("parts.rows", { count: 8 })).toBe("8 rows");
  });
});

describe("segments", () => {
  it("splits a sentence at its styled slots", () => {
    expect(segments(`opened ${slot("catalogue")} from model`)).toEqual([
      { text: "opened " },
      { slot: "catalogue" },
      { text: " from model" },
    ]);
  });

  /** Polish moves the slot, which is the whole reason for this mechanism. */
  it("handles a slot anywhere in the sentence", () => {
    expect(segments(`${slot("command")} writes one.`)).toEqual([
      { slot: "command" },
      { text: " writes one." },
    ]);
    expect(segments(`ends with ${slot("command")}`)).toEqual([
      { text: "ends with " },
      { slot: "command" },
    ]);
    expect(segments(`${slot("a")}${slot("b")}`)).toEqual([{ slot: "a" }, { slot: "b" }]);
  });

  it("leaves a sentence without slots alone", () => {
    expect(segments("nothing to split")).toEqual([{ text: "nothing to split" }]);
  });
});
