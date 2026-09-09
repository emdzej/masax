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

  const ready = $derived(discs.some((d) => d.survey.modules.some((m) => m.has.epc)));
  const partial = $derived(discs.length === 1 && ready);
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
    <button class="backdrop" onclick={onClose} aria-label="Close settings" tabindex="-1"
    ></button>
  {/if}
  <div class="panel" role="dialog" aria-modal="true" aria-label="Data location" tabindex="-1">
    <header>
      <Diamond size={11} />
      <h2>Data location</h2>
      {#if !firstRun}
        <button class="icon" onclick={onClose} aria-label="Close"><X size={15} /></button>
      {/if}
    </header>

    <div class="body">
      {#if firstRun}
        <p class="lede">
          masax reads a Mitsubishi ASA catalogue from your own copy. Mount the discs
          and point it at them — nothing is uploaded, extracted or converted.
        </p>
      {/if}

      {#if folderSupported}
        <section>
          <div class="head">
            <span class="label">Discs and folders</span>
            {#if needsPermission}
              <button class="text-btn" onclick={onReopen}>
                <RotateCcw size={12} /> Reopen {saved?.kind === "folders"
                  ? saved.names.join(", ")
                  : ""}
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
                    aria-label={`Remove ${disc.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              {/each}
            </ul>
          {/if}

          <button class="add" onclick={onAddFolder} disabled={Boolean(busy)}>
            {#if discs.length === 0}
              <FolderOpen size={14} /> Choose a disc or folder
            {:else}
              <Plus size={14} /> Add another disc
            {/if}
          </button>

          {#if partial}
            <p class="note">
              One disc is part of the catalogue: disc A carries 30 of the 52 catalogues
              and one half of the vehicle index, disc B the rest. Add the second for a
              complete set, or carry on with this one.
            </p>
          {/if}
          {#if conflicts.length > 0}
            <p class="warn">
              <TriangleAlert size={13} />
              {conflicts.length} files differ between these discs, so one would be
              shadowed. First: <span class="code">{conflicts[0]}</span>
            </p>
          {/if}
        </section>
      {:else}
        <p class="warn">
          <TriangleAlert size={13} />
          This browser cannot open a local folder — the File System Access API is
          Chromium-only. Chrome and Edge can; Firefox and Safari cannot. Use a hosted
          tree instead.
        </p>
      {/if}

      <section>
        <span class="label">Hosted tree</span>
        <div class="row">
          <div class="field">
            <Link size={13} />
            <input
              bind:value={url}
              placeholder="https://example.org/asa/M60/"
              spellcheck="false"
              onkeydown={(e) => e.key === "Enter" && url && onOpenUrl(url)}
            />
          </div>
          <button onclick={() => onOpenUrl(url)} disabled={!url || Boolean(busy)}>Open</button>
        </div>
        <p class="note">
          A hosted tree carries a <span class="code">csfs-manifest.json</span>, because
          HTTP cannot list a directory. <span class="code">masax import</span> writes one.
        </p>
      </section>

      {#if languages.length > 1 && onLanguage}
        <section>
          <span class="label">Language</span>
          <div class="langs">
            {#each languages as code (code)}
              <button class:on={code === language} onclick={() => onLanguage(code)}>
                {code}
              </button>
            {/each}
          </div>
        </section>
      {/if}
    </div>

    <footer>
      {#if error}
        <p class="warn"><TriangleAlert size={13} />{error}</p>
      {:else if busy}
        <p class="note">{busy}</p>
      {/if}
      <div class="spacer"></div>
      {#if saved && !firstRun}
        <button class="text-btn" onclick={onForget}><Trash2 size={12} /> Forget</button>
      {/if}
      {#if folderSupported}
        <button class="primary" onclick={onOpen} disabled={!ready || Boolean(busy)}>
          Open catalogue
        </button>
      {/if}
    </footer>
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
