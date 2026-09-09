<script lang="ts">
  /**
   * Where the data comes from, and how to change it.
   *
   * One panel, two jobs: reached from the gear it is settings, and on a first
   * run — nothing remembered — it is the thing that opens the catalogue at all.
   * That is why it has no dismiss on a first run: with no source there is
   * nothing behind it to go back to.
   *
   * A folder is the primary way in and is listed first. The data is read where
   * it lies, so there is nothing to upload and no server to run; HTTP is here
   * for browsers without the File System Access API and for a hosted tree.
   */
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import HardDrive from "@lucide/svelte/icons/hard-drive";
  import Link from "@lucide/svelte/icons/link";
  import Plus from "@lucide/svelte/icons/plus";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import X from "@lucide/svelte/icons/x";
  import Diamond from "./Diamond.svelte";
  import type { Disc } from "./sources.svelte";
  import type { SavedSource } from "./settings";
  import { LOCALES, i18n, segments, slot, type LocaleChoice } from "./i18n/index.svelte";
  import { THEME_CHOICES, theme } from "./theme.svelte";

  let {
    saved,
    discs,
    conflicts,
    needsPermission,
    firstRun,
    folderSupported,
    busy,
    error,
    languages = [],
    language,
    onAddFolder,
    onRemoveDisc,
    onOpen,
    onOpenUrl,
    onReopen,
    onForget,
    onLanguage,
    onClose,
  }: {
    saved: SavedSource | undefined;
    discs: Disc[];
    conflicts: string[];
    needsPermission: boolean;
    firstRun: boolean;
    folderSupported: boolean;
    busy: string;
    error: string;
    languages?: string[];
    language?: string;
    onAddFolder: () => void;
    onRemoveDisc: (name: string) => void;
    onOpen: () => void;
    onOpenUrl: (url: string) => void;
    onReopen: () => void;
    onForget: () => void;
    onLanguage?: (code: string) => void;
    onClose: () => void;
  } = $props();

  // Seeded once from what was remembered. Reading a prop in a state
  // initialiser would capture only its first value, so it is done in an effect
  // that runs a single time.
  let url = $state("");
  let seeded = false;
  $effect(() => {
    if (seeded) return;
    seeded = true;
    if (saved?.kind === "http") url = saved.url;
  });

  const t = $derived(i18n.t);

  const ready = $derived(discs.some((d) => d.survey.modules.some((m) => m.has.epc)));
  const partial = $derived(discs.length === 1 && ready);

  /**
   * Two tabs, because the panel now holds two unrelated things.
   *
   * On a first run the tab strip is not shown at all: there is exactly one
   * thing to do then, which is point masax at some data, and offering a
   * preferences tab first would be an invitation to the wrong job.
   */
  type Tab = "data" | "ui";
  let tab = $state<Tab>("data");
  const TABS: Tab[] = ["data", "ui"];

  const hostedNote = $derived(
    segments(t("settings.hostedNote", { manifest: slot("manifest"), command: slot("command") })),
  );
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && !firstRun) onClose();
  }}
/>

<div class="scrim" role="presentation">
  <!-- A real button, so dismissing by clicking away is reachable from the
       keyboard too. On a first run there is nothing behind to go back to, so it
       is not rendered at all. -->
  {#if !firstRun}
    <button class="backdrop" onclick={onClose} aria-label={t("settings.closeSettings")} tabindex="-1"
    ></button>
  {/if}
  <div
    class="panel"
    role="dialog"
    aria-modal="true"
    aria-label={firstRun ? t("settings.tab.data") : t("settings.title")}
    tabindex="-1"
  >
    <header>
      <Diamond size={11} />
      <h2>{firstRun ? t("settings.tab.data") : t("settings.title")}</h2>
      {#if !firstRun}
        <button class="icon" onclick={onClose} aria-label={t("settings.close")}>
          <X size={15} />
        </button>
      {/if}
    </header>

    {#if !firstRun}
      <div class="tabs" role="tablist">
        {#each TABS as name (name)}
          <button
            role="tab"
            class="tab"
            class:on={tab === name}
            aria-selected={tab === name}
            onclick={() => (tab = name)}
          >
            {t(`settings.tab.${name}`)}
          </button>
        {/each}
      </div>
    {/if}

    <div class="body" class:hidden={tab !== "data"}>
      {#if firstRun}
        <p class="lede">{t("settings.lede")}</p>
      {/if}

      {#if folderSupported}
        <section>
          <div class="head">
            <span class="label">{t("settings.discs")}</span>
            {#if needsPermission}
              <button class="text-btn" onclick={onReopen}>
                <RotateCcw size={12} />
                {t("settings.reopen", {
                  names: saved?.kind === "folders" ? saved.names.join(", ") : "",
                })}
              </button>
            {/if}
          </div>

          {#if discs.length > 0}
            <ul class="discs">
              {#each discs as disc (disc.name)}
                <li>
                  <HardDrive size={14} />
                  <div>
                    <strong>{disc.name}</strong>
                    <span class="code">{disc.summary}</span>
                  </div>
                  <button
                    class="icon"
                    onclick={() => onRemoveDisc(disc.name)}
                    aria-label={t("settings.removeDisc", { name: disc.name })}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              {/each}
            </ul>
          {/if}

          <button class="add" onclick={onAddFolder} disabled={Boolean(busy)}>
            {#if discs.length === 0}
              <FolderOpen size={14} /> {t("settings.choose")}
            {:else}
              <Plus size={14} /> {t("settings.addAnother")}
            {/if}
          </button>

          {#if partial}
            <p class="note">{t("settings.partial")}</p>
          {/if}
          {#if conflicts.length > 0}
            <p class="warn">
              <TriangleAlert size={13} />
              {t("settings.conflicts", { count: conflicts.length })}
              <span class="code">{conflicts[0]}</span>
            </p>
          {/if}
        </section>
      {:else}
        <p class="warn">
          <TriangleAlert size={13} />
          {t("settings.noFolderApi")}
        </p>
      {/if}

      <section>
        <span class="label">{t("settings.hosted")}</span>
        <div class="row">
          <div class="field">
            <Link size={13} />
            <input
              bind:value={url}
              placeholder={t("settings.urlPlaceholder")}
              spellcheck="false"
              onkeydown={(e) => e.key === "Enter" && url && onOpenUrl(url)}
            />
          </div>
          <button onclick={() => onOpenUrl(url)} disabled={!url || Boolean(busy)}>
            {t("settings.open")}
          </button>
        </div>
        <p class="note">
          {#each hostedNote as part, i (i)}
            {#if "slot" in part}
              <span class="code">
                {part.slot === "manifest" ? "csfs-manifest.json" : "masax import"}
              </span>
            {:else}{part.text}{/if}
          {/each}
        </p>
      </section>

      {#if languages.length > 1 && onLanguage}
        <section>
          <!--
            The *catalogue's* language, not the interface's. It stays on this tab
            because it is a property of the data being read, and it is named so
            the two are not mistaken for each other.
          -->
          <span class="label">{t("settings.catalogueLanguage")}</span>
          <div class="langs">
            {#each languages as code (code)}
              <button class:on={code === language} onclick={() => onLanguage(code)}>
                {code}
              </button>
            {/each}
          </div>
          <p class="note">{t("settings.catalogueLanguageNote")}</p>
        </section>
      {/if}
    </div>

    <div class="body" class:hidden={tab !== "ui"}>
      <section>
        <span class="label">{t("settings.interfaceLanguage")}</span>
        <div class="choices">
          <button
            class:on={i18n.choice === "auto"}
            onclick={() => void i18n.set("auto")}
          >
            {t("language.auto")}
          </button>
          {#each LOCALES as code (code)}
            <button class:on={i18n.choice === code} onclick={() => void i18n.set(code)}>
              {t(`language.${code}`)}
            </button>
          {/each}
        </div>
      </section>

      <section>
        <!--
          The same three states as the toolbar control, spelled out. The toolbar
          button is quicker but cycles blind; here they are all visible, which
          is what a settings panel is for.
        -->
        <span class="label">{t("theme.label")}</span>
        <div class="choices">
          {#each THEME_CHOICES as choice (choice)}
            <button class:on={theme.choice === choice} onclick={() => theme.set(choice)}>
              {t(`theme.${choice}`)}
            </button>
          {/each}
        </div>
      </section>
    </div>

    <!--
      The footer follows the tab. Forget and Open catalogue act on the data, so
      they have no meaning beside a theme picker.
    -->
    {#if tab === "data"}
      <footer>
        {#if error}
          <p class="warn"><TriangleAlert size={13} />{error}</p>
        {:else if busy}
          <p class="note">{busy}</p>
        {/if}
        <div class="spacer"></div>
        {#if saved && !firstRun}
          <button class="text-btn" onclick={onForget}>
            <Trash2 size={12} /> {t("settings.forget")}
          </button>
        {/if}
        {#if folderSupported}
          <button class="primary" onclick={onOpen} disabled={!ready || Boolean(busy)}>
            {t("settings.openCatalogue")}
          </button>
        {/if}
      </footer>
    {:else}
      <!--
        Done, not Save and Cancel. Language and theme take effect on the click
        that sets them — you can watch the theme change behind this panel — so
        there is no pending state for Save to commit, and Cancel would have to
        undo something already visible. Saying so out loud beats leaving the
        reader to wonder whether their choice stuck.
      -->
      <footer>
        <p class="note">{t("settings.appliesAtOnce")}</p>
        <div class="spacer"></div>
        <button class="primary" onclick={onClose}>{t("settings.done")}</button>
      </footer>
    {/if}
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    display: grid;
    place-items: center;
    /*
     * A definite row, so the panel's `max-height: 100%` has something to
     * resolve against. With the default `auto` row, 100% is 100% of the
     * content — the panel grows past the viewport and the scroll container
     * inside it never engages.
     */
    grid-template-rows: minmax(0, 1fr);
    padding: 1.5rem;
    z-index: 50;
  }
  .backdrop {
    position: absolute;
    inset: 0;
    border: 0;
    background: none;
    cursor: default;
  }
  .tabs {
    flex: none;
    display: flex;
    gap: 0.15rem;
    padding: 0 0.6rem;
    border-bottom: 1px solid var(--rule);
    background: var(--shade);
  }
  .tab {
    padding: 0.4rem 0.55rem;
    border: 0;
    /* The selected tab is marked on the edge it shares with its pane, which is
       what makes a tab strip read as one. */
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--steel);
    font: 600 10px/1.4 var(--ui);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .tab:hover {
    color: var(--ink);
  }
  .tab.on {
    border-bottom-color: var(--red);
    color: var(--red);
  }
  /*
   * Both panes stay mounted. The URL field holds unsaved text and a disc list
   * costs a survey to rebuild, so switching tabs must not discard either.
   */
  .body.hidden {
    display: none;
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .choices button {
    padding: 0.3rem 0.55rem;
    border: 1px solid var(--rule);
    border-radius: var(--r);
    background: var(--sheet);
    color: var(--steel);
    font-size: 12px;
  }
  .choices button:hover {
    border-color: var(--red);
    color: var(--red);
  }
  .choices button.on {
    border-color: var(--red);
    background: var(--red-wash);
    color: var(--red);
    font-weight: 600;
  }

  .panel {
    position: relative;
    width: min(37rem, 100%);
    max-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--sheet);
    border: 1px solid var(--rule);
    border-top: 2px solid var(--red);
    border-radius: var(--r-lg);
    box-shadow: 0 12px 40px -12px var(--drop);
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.7rem 0.85rem;
    border-bottom: 1px solid var(--rule);
  }
  header h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.01em;
    flex: 1;
  }

  .body {
    padding: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    overflow-y: auto;
  }
  .lede {
    margin: 0;
    color: var(--steel);
    font-size: 12.5px;
    line-height: 1.5;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .discs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--rule-soft);
    border: 1px solid var(--rule-soft);
    border-radius: var(--r);
  }
  .discs li {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.45rem 0.55rem;
    background: var(--shade);
    color: var(--steel);
  }
  .discs div {
    flex: 1;
    min-width: 0;
  }
  .discs strong {
    display: block;
    color: var(--ink);
    font-size: 12.5px;
    font-weight: 600;
  }
  .discs span {
    display: block;
    font-size: 10.5px;
    color: var(--steel);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .add {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.5rem;
    border: 1px dashed var(--rule);
    border-radius: var(--r);
    background: none;
    color: var(--steel);
    font-size: 12.5px;
  }
  .add:hover:not(:disabled) {
    border-color: var(--red);
    border-style: solid;
    color: var(--red-deep);
  }

  .row {
    display: flex;
    gap: 0.4rem;
  }
  .field {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--rule);
    border-radius: var(--r);
    background: var(--sheet);
    color: var(--steel-light);
  }
  .field:focus-within {
    border-color: var(--red);
    color: var(--red);
  }
  .field input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    padding: 0;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--ink);
  }
  .field input:focus {
    outline: none;
  }

  .langs {
    display: flex;
    gap: 0.3rem;
  }
  .langs button {
    padding: 0.25rem 0.55rem;
    border: 1px solid var(--rule);
    border-radius: var(--r);
    background: var(--sheet);
    font-family: var(--mono);
    font-size: 11.5px;
  }
  .langs button.on {
    border-color: var(--red);
    background: var(--red-wash);
    color: var(--red-deep);
    font-weight: 600;
  }

  .note {
    margin: 0;
    font-size: 11px;
    line-height: 1.45;
    color: var(--steel);
  }
  .warn {
    display: flex;
    align-items: flex-start;
    gap: 0.35rem;
    margin: 0;
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--red-deep);
  }

  footer {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.65rem 0.85rem;
    border-top: 1px solid var(--rule);
    background: var(--shade);
    border-radius: 0 0 var(--r-lg) var(--r-lg);
  }
  .spacer {
    flex: 1;
  }

  button {
    border: 1px solid var(--rule);
    border-radius: var(--r);
    background: var(--sheet);
    padding: 0.35rem 0.7rem;
    font-size: 12.5px;
  }
  button:hover:not(:disabled) {
    border-color: var(--steel);
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .primary {
    border-color: var(--red);
    background: var(--red);
    color: var(--on-red);
    font-weight: 600;
  }
  .primary:hover:not(:disabled) {
    background: var(--red-deep);
    border-color: var(--red-deep);
  }
  /*
   * Neutral rather than a dimmed accent. The generic `opacity: 0.45` over a
   * filled red leaves dark-on-dim-salmon, which is unreadable on the dark
   * panel; a flat grey says "not available" in both themes.
   */
  .primary:disabled {
    opacity: 1;
    border-color: var(--rule);
    background: var(--rule-soft);
    color: var(--steel-light);
    font-weight: 600;
  }
  .primary:disabled {
    background: var(--rule-soft);
    border-color: var(--rule);
    color: var(--steel-light);
    opacity: 1;
  }
  .icon,
  .text-btn {
    border: 0;
    background: none;
    padding: 0.15rem;
    color: var(--steel);
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 11.5px;
  }
  .icon:hover,
  .text-btn:hover {
    color: var(--red-deep);
  }
</style>
