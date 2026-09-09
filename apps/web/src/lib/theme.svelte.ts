/**
 * Light, dark, or whatever the system says.
 *
 * Three states rather than two, because "dark" and "not dark" cannot express
 * "follow the machine" — and a parts desk that goes dark at dusk with the rest
 * of the OS is the behaviour most people expect without asking for it.
 *
 * The choice is written to `data-theme` on the root element, and the stylesheet
 * reads it. `auto` writes *nothing*: the bare `:root` block is the light
 * palette and the `prefers-color-scheme` block overrides it, so the absence of
 * the attribute is itself the auto state. Writing `data-theme="auto"` would
 * mean the CSS had to know about a third value it cannot evaluate.
 */

export type ThemeChoice = "auto" | "light" | "dark";

const KEY = "masax.theme.v1";
/** The three states, in the order the cycle and the settings list use. */
export const THEME_CHOICES: readonly ThemeChoice[] = ["auto", "light", "dark"];
const CHOICES = THEME_CHOICES;

const isChoice = (value: unknown): value is ThemeChoice =>
  typeof value === "string" && (CHOICES as string[]).includes(value);

function stored(): ThemeChoice {
  try {
    const raw = localStorage.getItem(KEY);
    return isChoice(raw) ? raw : "auto";
  } catch {
    // Private-mode Safari throws rather than returning null.
    return "auto";
  }
}

/** The dark end of each palette, for painting the drawings. See `Drawing.svelte`. */
export interface Surface {
  /** The lines of a drawing. */
  ink: [number, number, number];
  /** The paper they sit on. */
  paper: [number, number, number];
}

const SURFACES: Record<"light" | "dark", Surface> = {
  light: { ink: [28, 28, 30], paper: [255, 255, 255] },
  // Not a straight inversion: pure white lines on pure black vibrate. The ink
  // is the light palette's paper pulled down a little and the paper is a step
  // above the panel, so a plate still reads as a sheet laid on the desk.
  dark: { ink: [222, 226, 231], paper: [23, 25, 28] },
};

class Theme {
  choice = $state<ThemeChoice>("auto");
  /** What the system prefers, tracked so `auto` can resolve without guessing. */
  private systemDark = $state(false);

  /** `light` or `dark` — never `auto`. What is actually on screen. */
  readonly resolved = $derived<"light" | "dark">(
    this.choice === "auto" ? (this.systemDark ? "dark" : "light") : this.choice,
  );

  /** Ink and paper for the current theme. */
  readonly surface = $derived<Surface>(SURFACES[this.resolved]);

  constructor() {
    this.choice = stored();
    const query = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
    if (query) {
      this.systemDark = query.matches;
      // `auto` has to keep following the system *after* boot, or a desk that
      // switches at sunset stays light until the next reload.
      query.addEventListener("change", (event) => (this.systemDark = event.matches));
    }
    this.apply();
  }

  /** Advance auto → light → dark → auto. */
  cycle(): void {
    const at = CHOICES.indexOf(this.choice);
    this.set(CHOICES[(at + 1) % CHOICES.length]!);
  }

  set(choice: ThemeChoice): void {
    this.choice = choice;
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      // Storage blocked: the theme still applies, it just will not be remembered.
    }
    this.apply();
  }

  private apply(): void {
    const root = document.documentElement;
    if (this.choice === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", this.choice);
  }
}

export const theme = new Theme();

/*
 * The label for the current state used to live here as a record of English
 * strings. It is a translation key now — `theme.current.<choice>` — so the
 * three states name themselves in whatever language the interface is in.
 */
