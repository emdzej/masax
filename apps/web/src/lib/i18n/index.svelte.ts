/**
 * Interface language.
 *
 * This is **not** the catalogue's language. The data carries its own text in
 * four languages through `Desc`, chosen on the Data location tab; this is the
 * language of masax's own words. Keeping them apart matters because they are
 * genuinely independent: a Polish-speaking parts desk reading an English-only
 * catalogue is the normal case, since `DESC_D` translates a quarter of the
 * strings and `DESC_F` a third.
 *
 * i18next is here for one reason worth stating: **Polish plurals**. The
 * interface counts things — rows, codes, callouts, records — and Polish needs
 * one/few/many where English needs one/other. `4 wiersze` and `5 wierszy` are
 * different words, and 12–14 go back to *many* while 22–24 return to *few*.
 * That is `Intl.PluralRules` territory, which i18next wraps; a hand-rolled
 * `n === 1 ? a : b` is wrong for most Polish numbers.
 *
 * i18next is not reactive, so `languageChanged` bumps a rune and `t` is read
 * through it. Without that the strings change in the instance and nothing
 * re-renders.
 */
import i18next, { type TFunction } from "i18next";
import en from "./en.json";
import pl from "./pl.json";

export const LOCALES = ["en", "pl"] as const;
export type Locale = (typeof LOCALES)[number];
/** `auto` follows the browser and keeps following it. */
export type LocaleChoice = "auto" | Locale;

const KEY = "masax.locale.v1";
const FALLBACK: Locale = "en";

const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/**
 * What the browser asks for, as one of ours.
 *
 * `navigator.languages` is in preference order and its entries are tags like
 * `pl-PL`, so each is cut at the subtag. A user whose first choice is
 * unsupported but whose second is Polish gets Polish rather than the fallback.
 */
function fromBrowser(): Locale {
  const asked = globalThis.navigator?.languages ?? [];
  for (const tag of asked) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return FALLBACK;
}

function stored(): LocaleChoice {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === "auto" || isLocale(raw) ? raw : "auto";
  } catch {
    // Private-mode Safari throws rather than returning null.
    return "auto";
  }
}

function initial(): Locale {
  const choice = stored();
  return choice === "auto" ? fromBrowser() : choice;
}

// Not awaited: with resources inline there is no backend to wait for, and
// i18next initialises synchronously. A top-level await here would make this
// module async and force every importer to become async with it.
i18next.init({
  lng: initial(),
  fallbackLng: FALLBACK,
  resources: { en: { translation: en }, pl: { translation: pl } },
  interpolation: {
    // Svelte escapes on output already, and i18next's own escaping would
    // double-encode a quote in a part name.
    escapeValue: false,
  },
  // A missing key should be loud in development and inert in a build, never a
  // raw dotted path shown to a user.
  returnNull: false,
});

class I18n {
  choice = $state<LocaleChoice>("auto");
  /** Bumped on every language change; `t` depends on it. */
  private version = $state(0);
  private browser = $state<Locale>(FALLBACK);

  /** The language actually in use — never `auto`. */
  readonly locale = $derived<Locale>(this.choice === "auto" ? this.browser : this.choice);

  /**
   * Translate. Reading `version` is what makes a component re-render on a
   * language change, so it is read deliberately rather than by accident.
   */
  readonly t = $derived.by<TFunction>(() => {
    void this.version;
    return i18next.t.bind(i18next) as TFunction;
  });

  constructor() {
    this.choice = stored();
    this.browser = fromBrowser();
    i18next.on("languageChanged", () => {
      this.version += 1;
      document.documentElement.lang = i18next.resolvedLanguage ?? FALLBACK;
    });
    document.documentElement.lang = i18next.resolvedLanguage ?? FALLBACK;
  }

  async set(choice: LocaleChoice): Promise<void> {
    this.choice = choice;
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      // Storage blocked: the language still applies, it just is not remembered.
    }
    await i18next.changeLanguage(choice === "auto" ? this.browser : choice);
  }
}

export const i18n = new I18n();

// Re-exported so a component has one place to import i18n from.
export { segments, slot } from "./slots.js";
