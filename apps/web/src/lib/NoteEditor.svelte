<script lang="ts">
  /**
   * Write a note about one part number.
   *
   * Small and modal rather than an inline field. Editing in place inside a
   * ninety-row table means either a permanent input on every row or a layout
   * that jumps when one appears, and this is a thing you do occasionally and
   * deliberately.
   *
   * The part number and name are shown, because the note is being attached to a
   * number that will be read back somewhere else entirely — the bin, a printed
   * pick list — and it should be clear which one.
   */
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import X from "@lucide/svelte/icons/x";
  import Diamond from "./Diamond.svelte";
  import { NOTE_LIMIT, notes } from "./notes.svelte";
  import { i18n } from "./i18n/index.svelte";

  let {
    partNumber,
    name,
    onClose,
  }: { partNumber: string; name?: string; onClose: () => void } = $props();

  const t = $derived(i18n.t);

  let text = $state("");
  let field = $state<HTMLTextAreaElement | undefined>(undefined);
  /** Which part `text` was seeded from, so a switch re-seeds rather than sticks. */
  let seeded = $state("");

  const left = $derived(NOTE_LIMIT - text.length);

  /**
   * Seeded from the stored note, once per part.
   *
   * Reading the note into `$state` at initialisation would capture only the
   * first part this component was mounted for; if the parent ever reuses it for
   * another number, the field would still hold the previous note. Keying the
   * seed on `partNumber` is what makes that safe.
   */
  $effect(() => {
    if (seeded === partNumber) return;
    seeded = partNumber;
    text = notes.get(partNumber) ?? "";
    // Caret at the end, so an existing note is appended to rather than replaced.
    field?.focus();
    field?.setSelectionRange(text.length, text.length);
  });

  function save(): void {
    notes.set(partNumber, text);
    onClose();
  }

  function remove(): void {
    notes.remove(partNumber);
    onClose();
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="scrim" role="presentation">
  <button class="backdrop" onclick={onClose} aria-label={t("settings.close")} tabindex="-1"
  ></button>
  <div
    class="panel"
    role="dialog"
    aria-modal="true"
    aria-label={t("note.edit", { value: partNumber })}
    tabindex="-1"
  >
    <header>
      <Diamond size={11} />
      <h2>{t("note.title")}</h2>
      <span class="part code">{partNumber}</span>
      {#if name}<span class="name">{name}</span>{/if}
      <div class="spacer"></div>
      <button class="icon" onclick={onClose} aria-label={t("settings.close")}>
        <X size={15} />
      </button>
    </header>

    <div class="body">
      <!--
        Enter inserts a newline; Ctrl/Cmd-Enter saves. A note is often one line
        but sometimes three, and losing the second line to a stray Enter would
        be worse than needing a modifier.
      -->
      <textarea
        bind:this={field}
        bind:value={text}
        maxlength={NOTE_LIMIT}
        rows="3"
        placeholder={t("note.placeholder")}
        onkeydown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
      ></textarea>
      <span class="fine">{t("note.limit", { count: left })}</span>
    </div>

    <footer>
      {#if notes.get(partNumber)}
        <button class="text-btn" onclick={remove}>
          <Trash2 size={12} /> {t("note.delete")}
        </button>
      {/if}
      <div class="spacer"></div>
      <button class="primary" onclick={save}>{t("note.save")}</button>
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
    grid-template-rows: minmax(0, 1fr);
    padding: 1.5rem;
    z-index: 70;
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
    width: min(30rem, 100%);
    max-height: 100%;
    overflow: auto;
    background: var(--sheet);
    border: 1px solid var(--rule);
    border-top: 2px solid var(--red);
    border-radius: var(--r-lg);
    box-shadow: 0 12px 40px -12px var(--drop);
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    padding: 0.7rem 0.85rem;
    border-bottom: 1px solid var(--rule);
  }
  header h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.055em;
  }
  .part {
    font-size: 12.5px;
    font-weight: 600;
  }
  .name {
    font-size: 11px;
    color: var(--steel);
  }
  .spacer {
    flex: 1;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.85rem;
  }
  textarea {
    width: 100%;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--rule);
    border-radius: var(--r);
    background: var(--sheet);
    font: inherit;
    font-size: 12.5px;
    line-height: 1.45;
    resize: vertical;
  }
  textarea:focus {
    outline: none;
    border-color: var(--red);
  }
  .fine {
    align-self: flex-end;
    font-size: 10.5px;
    color: var(--steel-light);
  }
  .icon {
    display: flex;
    align-self: center;
    padding: 0.15rem;
    border: 0;
    background: none;
    color: var(--steel);
  }
  .icon:hover {
    color: var(--red);
  }
  footer {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 0.85rem;
    border-top: 1px solid var(--rule);
    background: var(--shade);
    border-radius: 0 0 var(--r-lg) var(--r-lg);
  }
  .text-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0;
    border: 0;
    background: none;
    color: var(--steel);
    font-size: 11.5px;
  }
  .text-btn:hover {
    color: var(--red);
  }
  .primary {
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--red);
    border-radius: var(--r);
    background: var(--red);
    color: var(--on-red);
    font-size: 12px;
    font-weight: 600;
  }
  .primary:hover {
    background: var(--red-deep);
    border-color: var(--red-deep);
  }
</style>
